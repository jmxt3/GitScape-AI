"""
Assemble stage.

Renders the slim, token-budgeted SKILL.md plus the deterministic references/*.md,
every chunk stamped with the repo paths it came from. SKILL.md links into
references/ for detail (progressive disclosure); the full digest is not bundled.

Author: GitScape.ai
"""
from __future__ import annotations

import re
from urllib.parse import quote
from dataclasses import dataclass, field

from app.skill_builder import generate_skill_name

from .errors import BuildError
from .models import (
    ContentUnit,
    Extract,
    FileKind,
    FrameworkProseFields,
    ProseFields,
    ProvenanceEntry,
    RepoMeta,
    Symbol,
)
from .sanitize import sanitize_prose

TOKEN_BUDGET = 5000  # SKILL.md hard cap for Code Skills
FRAMEWORK_TOKEN_BUDGET = 10_000  # Engineering Skills — all 6 sections are load-bearing, never trim
_MAX_QUICKREF = 40  # starting number of quick-reference rows


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


@dataclass
class AssembledSkill:
    name: str
    description: str
    skill_md: str
    references: dict[str, str] = field(default_factory=dict)
    provenance: list[ProvenanceEntry] = field(default_factory=list)


# ─── description + prose ───────────────────────────────────────────────────


def _description(meta: RepoMeta, extract: Extract) -> str:
    langs = ", ".join(meta.primary_languages) or "multiple languages"
    n_sym = extract.api_index.total
    n_mod = len(extract.api_index.modules)
    desc = (
        f"Specialist knowledge of the {meta.owner}/{meta.repo} codebase ({langs}). "
        f"Use when working with, extending, or debugging {meta.repo}: navigating its modules, "
        f"calling its {n_sym} documented public symbols across {n_mod} source files, and "
        f"understanding its architecture, setup, and configuration. "
        f"Not for general {langs} questions unrelated to {meta.repo}."
    )
    return sanitize_prose(desc)[:1024]


_BADGE = re.compile(r"^\s*(\[!\[|!\[|<img|<p|<a|=+\s*$|-+\s*$)")


def _readme_intro(readme: str) -> str:
    if not readme:
        return ""
    para: list[str] = []
    for line in readme.splitlines():
        s = line.strip()
        if not s:
            if para:
                break
            continue
        if s.startswith("#") or _BADGE.match(s):
            if para:
                break
            continue
        para.append(s)
    return " ".join(para)[:600]


def _what_this_is(meta: RepoMeta, extract: Extract) -> str:
    intro = sanitize_prose(_readme_intro(meta.readme))
    if intro:
        return intro
    langs = ", ".join(meta.primary_languages) or "multiple languages"
    return (
        f"{meta.owner}/{meta.repo} is a {langs} project with "
        f"{extract.api_index.total} public symbols across "
        f"{len(extract.api_index.modules)} source files."
    )


_TOP_DIR = re.compile(r"^(?:├── |└── )([\w.\-]+)/\s*$")


def _top_dirs(meta: RepoMeta) -> list[str]:
    """Top-level directories only (depth-0 entries of the shallow tree)."""
    seen: set[str] = set()
    out: list[str] = []
    for line in meta.structure_overview.splitlines():
        m = _TOP_DIR.match(line)
        if m and m.group(1) not in seen:
            seen.add(m.group(1))
            out.append(m.group(1))
    return out[:8]


# ─── references ────────────────────────────────────────────────────────────


def _fmt_symbol(sym: Symbol) -> str:
    line = f"- **`{sym.name}`** — `{sym.signature}`"
    if sym.summary:
        line += f"\n  {sym.summary}"
    return line


def _render_api_md(extract: Extract) -> str:
    if not extract.api_index.modules:
        return ""
    out = ["# API Reference", "", "Generated from parsed symbols — names, signatures, and the one-line purpose from each docstring/comment.", ""]
    for path, syms in extract.api_index.modules.items():
        out.append(f"## `{path}`")
        out.append(f"*source: {path}*")
        out.append("")
        for s in syms:
            out.append(_fmt_symbol(s))
        out.append("")
    return "\n".join(out).strip() + "\n"


def _render_architecture_md(meta: RepoMeta, extract: Extract) -> str:
    out = ["# Architecture", ""]
    tree = meta.structure_overview or meta.file_structure
    if tree.strip():
        out += ["## Directory structure", "", "```", tree.strip(), "```", ""]
    if extract.api_index.modules:
        out += ["## Modules", ""]
        for path, syms in extract.api_index.modules.items():
            out.append(f"- `{path}` — {len(syms)} public symbols")
        out.append("")
    if extract.import_graph.external:
        out += ["## External dependencies", ""]
        for dep in extract.import_graph.external:
            out.append(f"- `{dep.name}` *(declared in {dep.source_path})*")
        out.append("")
    if extract.import_graph.internal:
        out += ["## Internal imports", ""]
        for path, mods in list(extract.import_graph.internal.items())[:40]:
            out.append(f"- `{path}` → {', '.join('`%s`' % m for m in mods)}")
        out.append("")
    return "\n".join(out).strip() + "\n"


def _render_examples_md(extract: Extract) -> str:
    if not extract.examples:
        return ""
    out = ["# Examples", ""]
    for i, ex in enumerate(extract.examples, 1):
        out.append(f"## Example {i} — `{ex.source_path}`")
        out.append("")
        out.append(f"```{ex.language}")
        out.append(ex.code)
        out.append("```")
        out.append("")
    return "\n".join(out).strip() + "\n"


def _render_setup_md(extract: Extract) -> str:
    setup = extract.setup
    if not setup.quickstart and not setup.commands:
        return ""
    out = ["# Setup", ""]
    if setup.quickstart:
        out.append(sanitize_prose(setup.quickstart))
        out.append("")
    if setup.commands:
        out += ["## Commands", "", "```bash"] + setup.commands + ["```", ""]
    return "\n".join(out).strip() + "\n"


def _render_config_md(units: list[ContentUnit], extract: Extract) -> str:
    config_paths = [u.path for u in units if u.kind == FileKind.CONFIG]
    if not config_paths and not extract.import_graph.external:
        return ""
    out = ["# Configuration", ""]
    if config_paths:
        out += ["## Config & manifest files", ""]
        out += [f"- `{p}`" for p in config_paths]
        out.append("")
    if extract.import_graph.external:
        out += ["## Declared dependencies", ""]
        out += [f"- `{d.name}`" for d in extract.import_graph.external]
        out.append("")
    return "\n".join(out).strip() + "\n"


def _build_references(meta: RepoMeta, extract: Extract, units: list[ContentUnit]):
    refs: dict[str, str] = {}
    prov: list[ProvenanceEntry] = []

    api = _render_api_md(extract)
    if api:
        refs["references/api.md"] = api
        prov.append(ProvenanceEntry(chunk="references/api.md", source_paths=list(extract.api_index.modules)))

    arch = _render_architecture_md(meta, extract)
    if arch:
        refs["references/architecture.md"] = arch
        prov.append(ProvenanceEntry(
            chunk="references/architecture.md",
            source_paths=list(extract.api_index.modules) + [d.source_path for d in extract.import_graph.external],
        ))

    examples = _render_examples_md(extract)
    if examples:
        refs["references/examples.md"] = examples
        prov.append(ProvenanceEntry(chunk="references/examples.md", source_paths=[e.source_path for e in extract.examples]))

    setup = _render_setup_md(extract)
    if setup:
        refs["references/setup.md"] = setup
        prov.append(ProvenanceEntry(chunk="references/setup.md", source_paths=[u.path for u in units if u.path.lower().startswith("readme") or "readme" in u.path.lower()]))

    config = _render_config_md(units, extract)
    if config:
        refs["references/config.md"] = config
        prov.append(ProvenanceEntry(chunk="references/config.md", source_paths=[u.path for u in units if u.kind == FileKind.CONFIG]))

    return refs, prov


# ─── SKILL.md ──────────────────────────────────────────────────────────────


def _flatten_symbols(extract: Extract) -> list[Symbol]:
    flat: list[Symbol] = []
    for syms in extract.api_index.modules.values():
        flat.extend(syms)
    return flat


def _when_to_use_lines(meta: RepoMeta, prose: ProseFields | None) -> list[str]:
    if prose and prose.when_to_use:
        return [f"- {sanitize_prose(item)}" for item in prose.when_to_use]
    return [
        f"- Understanding the architecture and module layout of {meta.repo}",
        "- Locating and calling functions, classes, and methods in its public API",
        "- Extending or modifying behavior consistent with its existing patterns",
        "- Debugging by tracing through its modules",
        "- Setting up, running, or configuring the project",
    ]


def _render_skill_md(
    meta: RepoMeta,
    extract: Extract,
    name: str,
    description: str,
    ref_files: list[str],
    quickref_n: int,
    include_concepts: bool,
    prose: ProseFields | None = None,
) -> str:
    langs = ", ".join(meta.primary_languages) or "multiple languages"
    what = sanitize_prose(prose.what_this_is) if (prose and prose.what_this_is) else _what_this_is(meta, extract)
    lines: list[str] = [
        "---",
        f"name: {name}",
        f'description: "{description}"',
        "---",
        "",
        f"# {meta.owner}/{meta.repo} — Code Skill",
        "",
        "## What this is",
        "",
        what,
        "",
        "## When to use",
        "",
        *_when_to_use_lines(meta, prose),
        "",
    ]

    if include_concepts:
        dirs = _top_dirs(meta)
        lines += ["## Key concepts", ""]
        if dirs:
            lines.append("Top-level areas: " + ", ".join(f"`{d}/`" for d in dirs) + ".")
            lines.append("")
        lines.append(
            f"Primary languages: {langs}. The skill indexes {extract.api_index.total} "
            f"public symbols across {len(extract.api_index.modules)} source files."
        )
        lines.append("")

    flat = _flatten_symbols(extract)
    if flat and quickref_n > 0:
        lines += ["## API quick-reference", ""]
        for s in flat[:quickref_n]:
            summary = f" — {s.summary}" if s.summary else ""
            lines.append(f"- **`{s.name}`** `{s.signature}`{summary}")
        if len(flat) > quickref_n:
            lines.append("")
            lines.append(f"*…and {len(flat) - quickref_n} more — see `references/api.md`.*")
        lines.append("")

    if extract.setup.commands:
        lines += ["## Quickstart", "", "```bash"] + extract.setup.commands[:6] + ["```", ""]

    if ref_files:
        lines += ["## References", ""]
        labels = {
            "references/api.md": "Full API reference",
            "references/architecture.md": "Architecture & dependencies",
            "references/examples.md": "Usage examples",
            "references/setup.md": "Setup & commands",
            "references/config.md": "Configuration",
        }
        for rf in ref_files:
            lines.append(f"- [{labels.get(rf, rf)}]({rf})")
        lines.append("")

    return "\n".join(lines).strip() + "\n"


def _render_framework_skill_md(
    meta: RepoMeta,
    name: str,
    description: str,
    fw: FrameworkProseFields,
) -> str:
    """Render the canonical 6-section engineering skill anatomy.

    Every section is load-bearing and is always included. This renderer is
    only called from the HD path — fw is guaranteed non-None.
    """
    lines: list[str] = [
        "---",
        f"name: {name}",
        f'description: "{description}"',
        "---",
        "",
        f"# {meta.owner}/{meta.repo} — Engineering Skill",
        "",
    ]

    # ─── Overview ─────────────────────────────────────────────────────────
    lines += ["## Overview", ""]
    if fw.overview:
        lines.append(sanitize_prose(fw.overview))
    else:
        lines.append(
            f"{meta.owner}/{meta.repo} is a project that requires careful, structured engineering "
            "practices. This skill guides agents through the established patterns and workflows."
        )
    lines.append("")

    # ─── When to Use ──────────────────────────────────────────────────
    lines += ["## When to Use", ""]
    if fw.when_to_use:
        for item in fw.when_to_use:
            lines.append(f"- {sanitize_prose(item)}")
    else:
        lines.append(f"- Working within the {meta.repo} codebase")
        lines.append("- Making changes that affect existing patterns or architecture")
    if fw.when_not_to_use:
        lines.append("")
        lines.append(f"**When NOT to use:** {sanitize_prose(fw.when_not_to_use)}")
    lines.append("")

    # ─── Core Process ────────────────────────────────────────────────
    lines += ["## Core Process", ""]
    if fw.core_process:
        for i, step in enumerate(fw.core_process, 1):
            lines.append(f"### Step {i}: {step.title}")
            lines.append("")
            lines.append(sanitize_prose(step.content))
            lines.append("")
    else:
        lines += [
            "### Step 1: Understand the Context",
            "",
            f"Read the existing code in {meta.repo} before making changes. "
            "Identify the patterns being extended, not invented.",
            "",
        ]

    # ─── Common Rationalizations ─────────────────────────────────────
    lines += ["## Common Rationalizations", ""]
    if fw.common_rationalizations:
        lines += ["| Rationalization | Reality |", "|---|---|"]  
        for r in fw.common_rationalizations:
            excuse = sanitize_prose(r.excuse).replace("|", "\\|")
            reality = sanitize_prose(r.reality).replace("|", "\\|")
            lines.append(f"| {excuse} | {reality} |")
    else:
        lines += [
            "| Rationalization | Reality |",
            "|---|---|",
            "| \"I know the codebase, I don't need to follow the process\" | "
            "Consistency matters more than speed. Future agents and engineers depend on predictable patterns. |",
        ]
    lines.append("")

    # ─── Red Flags ──────────────────────────────────────────────────────────
    lines += ["## Red Flags", ""]
    if fw.red_flags:
        for flag in fw.red_flags:
            lines.append(f"- {sanitize_prose(flag)}")
    else:
        lines.append("- Changes made without reading existing patterns first")
        lines.append("- No tests written before implementation")
    lines.append("")

    # ─── Verification ──────────────────────────────────────────────────────
    lines += ["## Verification", ""]
    if fw.verification:
        for item in fw.verification:
            lines.append(f"- [ ] {sanitize_prose(item)}")
    else:
        lines.append("- [ ] All tests pass")
        lines.append("- [ ] Code follows existing patterns in this repository")
        lines.append("- [ ] No regressions introduced")
    lines.append("")

    # ─── Code Access ────────────────────────────────────────────────────────────
    lines += ["## Code Access", ""]
    if meta.repo_url:
        encoded_url = quote(meta.repo_url, safe="")
        lines += [
            f"The full source digest for **{meta.owner}/{meta.repo}** is available via the GitScape API:",
            "",
            "```",
            f"GET https://api.gitscape.ai/converter?repo_url={meta.repo_url}",
            "```",
            "",
            f"Load the `digest` field from the response into your context for complete source-code access. "
            f"You can also visit [gitscape.ai](https://gitscape.ai/?repo={encoded_url}) "
            f"and download the Code Digest from the site.",
        ]
    else:
        lines.append("Visit [gitscape.ai](https://gitscape.ai) to generate the full Code Digest for this repository.")
    lines.append("")

    return "\n".join(lines).strip() + "\n"


def assemble(
    meta: RepoMeta,
    extract: Extract,
    units: list[ContentUnit],
    token_budget: int = TOKEN_BUDGET,
    prose: ProseFields | None = None,
    framework_prose: FrameworkProseFields | None = None,
) -> AssembledSkill:
    """Assemble a SkillPackage.

    When *framework_prose* is provided the output follows the canonical 6-section
    engineering skill anatomy and uses FRAMEWORK_TOKEN_BUDGET (no trimming).
    When only *prose* is provided the existing Code Skill path is used.
    """
    name = generate_skill_name(meta.owner, meta.repo)
    description = _description(meta, extract)

    if framework_prose is not None:
        # Engineering Skill path — HD only, no budget trimming
        if framework_prose.description:
            description = sanitize_prose(framework_prose.description)[:1024]
        skill_md = _render_framework_skill_md(meta, name, description, framework_prose)
        references, provenance = _build_references(meta, extract, units)
        return AssembledSkill(
            name=name,
            description=description,
            skill_md=skill_md,
            references=references,
            provenance=provenance,
        )

    # Code Skill path — deterministic + optional prose glue
    if prose and prose.description:
        description = sanitize_prose(prose.description)[:1024]
    references, provenance = _build_references(meta, extract, units)
    ref_files = list(references.keys())

    # Budget loop: trim quick-ref rows, then drop Key concepts, else fail.
    quickref_n = _MAX_QUICKREF
    include_concepts = True
    while True:
        skill_md = _render_skill_md(
            meta, extract, name, description, ref_files, quickref_n, include_concepts, prose
        )
        if estimate_tokens(skill_md) <= token_budget:
            break
        if quickref_n > 0:
            quickref_n = max(0, quickref_n - 5)
        elif include_concepts:
            include_concepts = False
        else:
            raise BuildError(
                f"SKILL.md exceeds the {token_budget}-token budget "
                f"({estimate_tokens(skill_md)} tokens) even after trimming."
            )

    return AssembledSkill(
        name=name,
        description=description,
        skill_md=skill_md,
        references=references,
        provenance=provenance,
    )
