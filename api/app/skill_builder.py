"""
Shared skill-building helpers for GitScape.ai.

The end-to-end SKILL.md / references / manifest generation now lives in
`app.skillforge` (deterministic-first pipeline). This module retains only the
small, still-used utilities consumed by the converter and SkillForge:
language detection and canonical skill naming.

Author: João Machete
"""

from pathlib import Path
from typing import List
from collections import Counter

# Extension → Language display name mapping
EXT_TO_LANGUAGE: dict = {
    ".py": "Python",
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
    ".js": "JavaScript",
    ".jsx": "JavaScript",
    ".go": "Go",
    ".rs": "Rust",
    ".java": "Java",
    ".cs": "C#",
    ".cpp": "C++",
    ".c": "C",
    ".rb": "Ruby",
    ".php": "PHP",
    ".swift": "Swift",
    ".kt": "Kotlin",
    ".scala": "Scala",
    ".r": "R",
    ".sql": "SQL",
    ".sh": "Shell",
    ".bash": "Shell",
    ".zsh": "Shell",
    ".ps1": "PowerShell",
    ".html": "HTML",
    ".css": "CSS",
    ".scss": "CSS",
    ".vue": "Vue",
    ".svelte": "Svelte",
    ".dart": "Dart",
    ".ex": "Elixir",
    ".exs": "Elixir",
    ".erl": "Erlang",
    ".lua": "Lua",
    ".tf": "Terraform",
    ".graphql": "GraphQL",
    ".sol": "Solidity",
}


def detect_primary_languages(files: List[Path], top_n: int = 3) -> List[str]:
    """
    Detect the primary programming languages from a list of file paths.
    Returns the top N languages sorted by file count, descending.
    """
    lang_counter: Counter = Counter()
    for f in files:
        lang = EXT_TO_LANGUAGE.get(f.suffix.lower())
        if lang:
            lang_counter[lang] += 1

    return [lang for lang, _ in lang_counter.most_common(top_n)]


def generate_skill_name(owner: str, repo: str) -> str:
    """
    Generate a canonical skill name: lowercase-with-hyphens, per AgentSkills standard.

    The spec only allows [letters, digits, hyphens] — underscores (common in GitHub
    owner/repo names) are replaced with hyphens to pass `skills-ref validate`.
    """
    name = f"{owner.lower()}-{repo.lower()}"
    return name.replace("_", "-")
