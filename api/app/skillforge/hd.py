"""
HD mode — optional LLM prose via Gemini Flash.

The deterministic build is the default and makes ZERO LLM calls. HD only rewrites
short natural-language glue (the "what this is" paragraph, the "when to use"
bullets, and the description) from the already-structured Extract — never from the
raw digest. The key is held server-side (config.GEMINI_API_KEY); if it's absent or
the call fails, generate_prose returns None and the caller falls back to the
deterministic prose.

Author: GitScape.ai
"""
from __future__ import annotations

import json
import logging

import requests

from app.config import settings

from .models import Extract, FrameworkProcessStep, FrameworkProseFields, FrameworkRationalization, ProseFields, RepoMeta

logger = logging.getLogger(__name__)

_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
_TIMEOUT = 20


def hd_available() -> bool:
    return bool(settings.GEMINI_API_KEY)


def _structured_context(meta: RepoMeta, extract: Extract) -> str:
    langs = ", ".join(meta.primary_languages) or "multiple languages"
    lines = [f"Repository: {meta.owner}/{meta.repo}", f"Languages: {langs}"]

    syms = [s for module in extract.api_index.modules.values() for s in module]
    if syms:
        lines.append("Key public symbols:")
        for s in syms[:25]:
            summary = f" — {s.summary}" if s.summary else ""
            lines.append(f"  - {s.kind} {s.name}: {s.signature}{summary}")

    if extract.import_graph.external:
        deps = ", ".join(d.name for d in extract.import_graph.external[:20])
        lines.append(f"External dependencies: {deps}")

    if extract.setup.commands:
        lines.append("Setup commands: " + "; ".join(extract.setup.commands[:8]))

    if meta.readme:
        lines.append("README excerpt:\n" + meta.readme[:1500])

    return "\n".join(lines)


def _prompt(meta: RepoMeta, extract: Extract) -> str:
    return (
        "You are a technical writer producing prose for an Anthropic Agent Skill "
        "(SKILL.md) that describes a code repository. Use ONLY the structured "
        "context below — never invent files, APIs, or facts not present.\n\n"
        "Return STRICT JSON with exactly these keys:\n"
        '  "description": one or two sentences, intent-first, starting with how an '
        "agent should use this skill (max 1024 chars).\n"
        '  "what_this_is": a single plain paragraph (3-5 sentences) describing the '
        "project, its purpose, architecture, and stack.\n"
        '  "when_to_use": an array of 3-5 short bullet strings.\n\n'
        "No markdown, no code fences, no commentary — JSON only.\n\n"
        "=== STRUCTURED CONTEXT ===\n" + _structured_context(meta, extract)
    )


def _extract_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```", 2)[1] if "```" in text[3:] else text.strip("`")
        text = text.lstrip("json").strip()
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end != -1:
        text = text[start : end + 1]
    # strict=False tolerates literal newlines/tabs inside JSON strings, which
    # Gemini commonly emits for multi-line prose values.
    return json.loads(text, strict=False)


def generate_prose(meta: RepoMeta, extract: Extract) -> ProseFields | None:
    """Return HD prose, or None when unavailable / on any failure."""
    key = settings.GEMINI_API_KEY
    if not key:
        return None

    url = _ENDPOINT.format(model=settings.HD_MODEL)
    body = {
        "contents": [{"parts": [{"text": _prompt(meta, extract)}]}],
        "generationConfig": {
            "temperature": 0.3,
            "maxOutputTokens": 1024,
            "responseMimeType": "application/json",
            # Disable "thinking" — 2.5-flash otherwise spends the output budget on
            # reasoning tokens and truncates the JSON. Short prose needs none.
            "thinkingConfig": {"thinkingBudget": 0},
        },
    }
    try:
        resp = requests.post(url, params={"key": key}, json=body, timeout=_TIMEOUT)
        resp.raise_for_status()
        text = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
        data = _extract_json(text)
        return ProseFields(
            description=data.get("description"),
            what_this_is=data.get("what_this_is"),
            when_to_use=[str(x) for x in (data.get("when_to_use") or [])][:6],
        )
    except Exception:
        logger.exception("HD prose generation failed; falling back to deterministic prose")
        return None


def _framework_prompt(meta: RepoMeta, extract: Extract) -> str:
    """Build the Gemini prompt that generates all 6 canonical engineering skill sections."""
    return (
        "You are a senior engineering skills author producing a Production-grade Engineering Skill "
        "(SKILL.md) for an AI coding agent working in this repository. "
        "Your goal is to teach the agent HOW TO ACT in this codebase — not just what it contains.\n\n"
        "Use ONLY the structured context below. Do not invent files, APIs, or facts not present.\n\n"
        "Return STRICT JSON with exactly these keys:\n"
        '  "description": One sentence, trigger-first (max 256 chars). Example: "Use when implementing features or fixing bugs in {repo} to follow established patterns."\n'
        '  "summary_title": One sentence capturing the essence/vision/design philosophy of this codebase (max 150 chars). Example: "Distinctive, production-grade frontend interfaces that reject generic AI aesthetics through intentional design choices."\n'
        '  "summary_bullets": Array of exactly 4 concise, high-impact bullet points summarizing the core engineering rules/philosophy of this repository.\n'
        '  "overview": 2-3 paragraphs. What this skill is for, why it matters for THIS specific '
        "repo, and what an agent must understand before touching the codebase.\n"
        '  "when_to_use": Array of 4-6 short strings. Each is a concrete trigger scenario '
        '("Implementing a new API endpoint", "Debugging a failing test").\n'
        '  "when_not_to_use": One sentence. The counter-indicator.\n'
        '  "core_process": Array of {"title": string, "content": string} objects. '
        "3-5 numbered steps that define the workflow. Each step should have a descriptive title "
        "and 2-4 sentences of content. Include code examples in the content where relevant.\n"
        '  "common_rationalizations": Array of {"excuse": string, "reality": string} objects. '
        "3-5 rows of shortcuts engineers take and why they fail in this codebase.\n"
        '  "red_flags": Array of 5-7 short strings. Observable warning signs that the agent '
        "is going off track (e.g. \"Modifying files without reading their callers first\").\n"
        '  "verification": Array of 6-8 strings. Checklist items an agent checks before declaring '
        'work done (do NOT include leading "- [ ] ").\n\n'
        "No markdown, no code fences, no commentary — JSON only.\n\n"
        "=== STRUCTURED CONTEXT ===\n" + _structured_context(meta, extract)
    )


def generate_framework_prose(meta: RepoMeta, extract: Extract) -> FrameworkProseFields | None:
    """Return all 6 framework skill sections from Gemini, or None on any failure.

    This is the HD path for Engineering Skills. It uses a higher token budget
    (2048) and a richer prompt than the Code Skill prose path.
    """
    key = settings.GEMINI_API_KEY
    if not key:
        return None

    url = _ENDPOINT.format(model=settings.HD_MODEL)
    body = {
        "contents": [{"parts": [{"text": _framework_prompt(meta, extract)}]}],
        "generationConfig": {
            "temperature": 0.4,
            "maxOutputTokens": 2048,
            "responseMimeType": "application/json",
            "thinkingConfig": {"thinkingBudget": 0},
        },
    }
    try:
        resp = requests.post(url, params={"key": key}, json=body, timeout=_TIMEOUT)
        resp.raise_for_status()
        text = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
        data = _extract_json(text)

        core_process = [
            FrameworkProcessStep(title=s.get("title", ""), content=s.get("content", ""))
            for s in (data.get("core_process") or [])
            if isinstance(s, dict)
        ]
        rationalizations = [
            FrameworkRationalization(excuse=r.get("excuse", ""), reality=r.get("reality", ""))
            for r in (data.get("common_rationalizations") or [])
            if isinstance(r, dict)
        ]

        return FrameworkProseFields(
            description=data.get("description"),
            summary_title=data.get("summary_title"),
            summary_bullets=[str(x) for x in (data.get("summary_bullets") or [])][:4],
            overview=data.get("overview"),
            when_to_use=[str(x) for x in (data.get("when_to_use") or [])][:7],
            when_not_to_use=data.get("when_not_to_use"),
            core_process=core_process,
            common_rationalizations=rationalizations,
            red_flags=[str(x) for x in (data.get("red_flags") or [])][:8],
            verification=[str(x) for x in (data.get("verification") or [])][:10],
        )
    except Exception:
        logger.exception("Framework prose generation failed; caller should handle None")
        return None
