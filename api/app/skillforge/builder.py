"""
Build orchestrator: ContentUnits + RepoMeta -> SkillPackage.

Runs the deterministic pipeline end to end (extract → assemble → scan → manifest)
with **zero LLM calls**. The scan report travels with the package; it never raises
on FAIL here — the export/zip step (package.py) enforces the gate so the UI can
still render the report and block the download.

Author: GitScape.ai
"""
from __future__ import annotations

from datetime import datetime, timezone

from .assemble import FRAMEWORK_TOKEN_BUDGET, TOKEN_BUDGET, assemble
from .exporters import render_exporters
from .extract import build_extract
from .ingest import BUILDER_VERSION
from .models import FrameworkProseFields, Manifest, ProseFields, RepoMeta, ScanReport, SkillPackage
from .scan import scan_skill

_FRAMEWORKS = ["claude-skills", "google-adk", "agno", "openai-agents", "langchain", "langgraph"]


def build_skill(
    units,
    meta: RepoMeta,
    *,
    digest_hash: str = "",
    token_budget: int = TOKEN_BUDGET,
    enable_semgrep: bool = False,
    prose: ProseFields | None = None,
    framework_prose: FrameworkProseFields | None = None,
    hd: bool = False,
    skill_type: str = "code",
) -> SkillPackage:
    """Build a SkillPackage from content units and repo metadata.

    skill_type="framework" triggers the HD-only Engineering Skill path:
      - Calls generate_framework_prose() to get all 6 canonical sections from Gemini.
      - Uses FRAMEWORK_TOKEN_BUDGET (10 000 tokens) with no section trimming.
      - Falls back to the Code Skill path if Gemini is unavailable.

    skill_type="code" (default) preserves the existing deterministic path with
    optional LLM prose glue when hd=True.
    """
    extract = build_extract(units, readme=meta.readme)

    if skill_type == "framework":
        # Engineering Skill path — HD only; Gemini generates all 6 sections.
        if framework_prose is None:
            from .hd import generate_framework_prose  # lazy: keeps deterministic path network-free
            framework_prose = generate_framework_prose(meta, extract)
        assembled = assemble(
            meta, extract, units,
            token_budget=FRAMEWORK_TOKEN_BUDGET,
            framework_prose=framework_prose,
        )
    else:
        # Code Skill path — deterministic + optional prose glue.
        if prose is None and hd:
            from .hd import generate_prose  # lazy
            prose = generate_prose(meta, extract)
        assembled = assemble(meta, extract, units, token_budget=token_budget, prose=prose)
    scan_report: ScanReport = scan_skill(
        assembled.skill_md, assembled.references, units=units,
        enable_semgrep=enable_semgrep,
        is_framework_skill=(skill_type == "framework"),
    )

    generated_at = meta.generated_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    exporters = render_exporters(meta.owner, meta.repo)

    manifest = Manifest(
        name=assembled.name,
        display_name=f"{meta.owner}/{meta.repo}",
        description=assembled.description,
        builder_version=BUILDER_VERSION,
        digest_hash=digest_hash,
        files=["SKILL.md", *assembled.references.keys(), "manifest.json", *exporters.keys()],
        provenance=assembled.provenance,
        scan_status=scan_report.status,
        framework_compatibility=_FRAMEWORKS,
        metadata={
            "source_repo": meta.repo_url,
            "generated_by": "GitScape.ai",
            "generated_by_url": "https://gitscape.ai",
            "generated_at": generated_at,
            "files_analyzed": meta.files_analyzed,
            "primary_languages": meta.primary_languages,
            "symbols_indexed": extract.api_index.total,
            "modules_indexed": len(extract.api_index.modules),
            "summary_title": (
                framework_prose.summary_title
                if (framework_prose and getattr(framework_prose, "summary_title", None))
                else assembled.description
            ),
            "summary_bullets": (
                framework_prose.summary_bullets
                if (framework_prose and getattr(framework_prose, "summary_bullets", []))
                else [
                    f"Specialist guidelines for working with the {meta.repo} codebase.",
                    f"Understanding modules and symbols across {meta.files_analyzed} source files.",
                    f"Adherence to repository setup, structure, and architecture patterns.",
                    "Executing automated tests and verifying codebase changes."
                ]
            ),
        },
    )

    return SkillPackage(
        name=assembled.name,
        skill_md=assembled.skill_md,
        references=assembled.references,
        manifest=manifest,
        scan_report=scan_report,
        exporters=exporters,
    )
