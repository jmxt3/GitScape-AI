"""
Typed artifacts that flow between SkillForge pipeline stages.

Every stage reads/writes these pydantic models so each step is independently
testable and the boundaries stay explicit:

    ingest → parse → classify → extract → sanitize → assemble → scan → package

Author: GitScape.ai
"""
from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


# ─── Source units ──────────────────────────────────────────────────────────


class FileKind(str, Enum):
    """How a ContentUnit is treated downstream."""

    DOCS = "docs"
    SOURCE = "source"
    CONFIG = "config"
    TEST = "test"
    OTHER = "other"


class ContentUnit(BaseModel):
    """One file's worth of content, source-agnostic.

    Produced either from a live clone (`units_from_clone`) or by re-parsing a
    digest (`parse_digest`); everything downstream consumes only this shape.
    """

    path: str  # repo-relative path, POSIX separators
    content: str
    language: Optional[str] = None  # display language ("Python"), None if unknown
    kind: FileKind = FileKind.OTHER
    size: int = 0  # byte length of content


class RepoMeta(BaseModel):
    """Repository-level facts carried alongside the units."""

    owner: str = "unknown"
    repo: str = "repo"
    repo_url: str = ""
    primary_languages: list[str] = Field(default_factory=list)
    files_analyzed: int = 0
    readme: str = ""
    structure_overview: str = ""  # shallow, dirs-only tree
    file_structure: str = ""  # full tree
    generated_at: str = ""


class DigestDoc(BaseModel):
    """Result of parsing a digest text stream."""

    repo_url: str = ""
    files_analyzed: int = 0
    tree: str = ""
    units: list[ContentUnit] = Field(default_factory=list)


# ─── Structural extract (Phase 2) ──────────────────────────────────────────


class Symbol(BaseModel):
    name: str
    kind: str  # "function" | "class" | "method"
    signature: str
    summary: str = ""  # one-line purpose from docstring / leading comment
    source_path: str
    line: int = 0  # 1-based


class ApiIndex(BaseModel):
    # symbols grouped by source path, preserving discovery order
    modules: dict[str, list[Symbol]] = Field(default_factory=dict)

    @property
    def total(self) -> int:
        return sum(len(v) for v in self.modules.values())


class ExternalDep(BaseModel):
    name: str
    source_path: str  # which manifest declared it


class ImportGraph(BaseModel):
    # internal edges: importer path -> imported module strings
    internal: dict[str, list[str]] = Field(default_factory=dict)
    external: list[ExternalDep] = Field(default_factory=list)


class CodeExample(BaseModel):
    language: str
    code: str
    source_path: str
    score: int = 0


class SetupInfo(BaseModel):
    quickstart: str = ""  # markdown body
    commands: list[str] = Field(default_factory=list)


class Extract(BaseModel):
    api_index: ApiIndex = Field(default_factory=ApiIndex)
    import_graph: ImportGraph = Field(default_factory=ImportGraph)
    setup: SetupInfo = Field(default_factory=SetupInfo)
    examples: list[CodeExample] = Field(default_factory=list)


class ProseFields(BaseModel):
    """Optional LLM-written prose (HD tier) that overrides deterministic prose."""

    what_this_is: Optional[str] = None
    when_to_use: list[str] = Field(default_factory=list)
    description: Optional[str] = None


class FrameworkProcessStep(BaseModel):
    """One step in the Core Process section of a framework skill."""

    title: str
    content: str


class FrameworkRationalization(BaseModel):
    """One row in the Common Rationalizations table."""

    excuse: str
    reality: str


class FrameworkProseFields(BaseModel):
    """LLM-written content for the canonical 6-section engineering skill anatomy (HD only).

    Each field maps to one load-bearing section. None fields fall back to
    the deterministic Code Skill renderer — they should not be trimmed.
    """

    description: Optional[str] = None
    summary_title: Optional[str] = None
    summary_bullets: list[str] = Field(default_factory=list)
    overview: Optional[str] = None

    when_to_use: list[str] = Field(default_factory=list)
    when_not_to_use: Optional[str] = None
    core_process: list[FrameworkProcessStep] = Field(default_factory=list)
    common_rationalizations: list[FrameworkRationalization] = Field(default_factory=list)
    red_flags: list[str] = Field(default_factory=list)
    verification: list[str] = Field(default_factory=list)


# ─── Scan (Phase 4) ────────────────────────────────────────────────────────


class ScanStatus(str, Enum):
    PASS = "PASS"
    WARN = "WARN"
    FAIL = "FAIL"


class Severity(str, Enum):
    INFO = "info"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class ScanFinding(BaseModel):
    rule: str
    severity: Severity
    file: str  # skill file the finding lives in, e.g. "SKILL.md"
    line: int = 0
    source_path: Optional[str] = None  # originating repo path, if resolvable
    snippet: str = ""
    message: str = ""


class ScanReport(BaseModel):
    status: ScanStatus = ScanStatus.PASS
    findings: list[ScanFinding] = Field(default_factory=list)


# ─── Package / manifest (Phase 3+) ─────────────────────────────────────────


class ProvenanceEntry(BaseModel):
    chunk: str  # skill file the content landed in
    source_paths: list[str] = Field(default_factory=list)


class Manifest(BaseModel):
    schema_version: str = "2.0"
    name: str
    display_name: str
    description: str
    version: str = "1.0.0"
    builder_version: str
    digest_hash: str
    files: list[str] = Field(default_factory=list)
    provenance: list[ProvenanceEntry] = Field(default_factory=list)
    scan_status: ScanStatus = ScanStatus.PASS
    framework_compatibility: list[str] = Field(default_factory=list)
    metadata: dict = Field(default_factory=dict)


class SkillPackage(BaseModel):
    name: str  # kebab-case == skill dir name
    skill_md: str
    references: dict[str, str] = Field(default_factory=dict)  # filename -> content
    manifest: Manifest
    scan_report: ScanReport = Field(default_factory=ScanReport)
    exporters: dict[str, str] = Field(default_factory=dict)  # filename -> content
