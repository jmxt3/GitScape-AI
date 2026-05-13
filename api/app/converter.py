#!/usr/bin/env python3
"""
Handles Git repository cloning, analysis, and Markdown digest generation.
Provides functionality to walk repository files, filter text-based files,
and generate a structured Markdown output of the repository's content.
Includes progress reporting capabilities for long-running operations.

Author: João Machete
"""
import os
import sys
import tempfile
import shutil
import subprocess
import gc
import logging
import fnmatch
import urllib.parse
from pathlib import Path
from typing import Optional, Callable, List, Set, Tuple
from app.skill_builder import detect_primary_languages

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

MAX_FILE_SIZE = 500 * 1024       # 500 KB per file — keeps individual reads fast
MAX_DIRECTORY_DEPTH = 30         # Maximum depth of directory traversal
MAX_TOTAL_SIZE_BYTES = 150 * 1024 * 1024  # 150 MB total repo size (RAM-backed /tmp on Cloud Run)
MAX_DIGEST_BYTES = 10 * 1024 * 1024       # 10 MB response cap (Cloud Run HTTP limit)
CHUNK_SIZE = 1024 * 1024  # 1 MB

# Ensure IGNORED_FILES is defined only once and at the top-level scope
IGNORED_DIRS = {
    ".git", "__pycache__", "node_modules", "packages", "package-locks", ".pnpm", ".yarn", ".npm", ".rush",
    ".next", "build", "dist", ".out", "coverage", ".nyc_output", ".vscode", ".idea"
}
IGNORED_FILES = {
    ".DS_Store",
    ".db",
    "CHANGELOG.md",
    "Zone.Identifier",
    ".jpeg",
    ".jpg",
    ".png",
    ".gif",
    ".bmp",
    ".tiff",
    ".tif",
    ".webp",
    ".heif",
    ".heic",
    ".avif",
    ".svg",
    ".psd",
    ".raw",
    ".eps",
    ".pdf",
    ".ico",
    ".csv",
    ".xls",
    ".xlsx",
    ".exr",
    ".tga",
    ".dds",
    ".wdp",
    ".dng",
    ".ppm",
    ".local",
    ".log",
    ".yaml",
    ".json",
    ".lockb",
    ".lock",
    ".sublime-workspace"
}

TEXT_EXTS = {
  ".ada",   # Ada
  ".adb",   # Ada (body)
  ".ads",   # Ada (specification)
  ".asp",   # Active Server Pages (Classic)
  ".aspx",  # Active Server Pages .NET
  ".asm",   # Assembly Language
  ".astro", # Astro Component
  ".bash", # Bash Script
  ".bib",   # BibTeX Bibliography
  ".build", # Build File (generic)
  ".c", # C
  ".cbl",   # COBOL
  ".cfg",   # Configuration File (generic)
  ".clj", # Clojure
  ".cls",   # LaTeX Class File
  ".cob",   # COBOL (alternative)
  ".conf",  # Configuration File (generic)
  ".cpp", # C++
  ".cql",   # Cassandra Query Language
  ".cr",    # Crystal
  ".cs", # C#
  ".cshtml", # C# HTML (Razor)
  ".csproj",# C# Project
  ".css", # CSS
  ".cypher",# Cypher Query Language (Neo4j)
  ".d",     # D
  ".dart", # Dart
  ".dockerfile", # Dockerfile
  ".ejs",   # Embedded JavaScript templates
  ".elm", # Elm
  ".env",   # Environment Variables
  ".erb",   # Embedded Ruby (Rails templates)
  ".erl",   # Erlang
  ".ex", # Elixir
  ".exs", # Elixir Script
  ".f",     # Fortran
  ".f90",   # Fortran 90
  ".f95",   # Fortran 95
  ".fs", # F#
  ".fsi", # F# Interface
  ".fsproj",# F# Project
  ".gitattributes", # Git Attributes
  ".gitignore", # Git Ignore Rules
  ".go", # Go
  ".gradle",# Gradle Script
  ".graphql", # GraphQL Schema/Query
  ".groovy", # Groovy
  ".h", # C/C++ Header
  ".handlebars", # Handlebars templates (alternative)
  ".hbs", # Handlebars templates
  ".hcl",   # HashiCorp Configuration Language (Terraform, Packer)
  ".hpp", # C++ Header (alternative)
  ".hrl",   # Erlang Header
  ".hs",    # Haskell
  ".htm", # HTML (alternative)
  ".html", # HTML
  ".idr",   # Idris
  ".ini",   # INI Configuration
  ".java", # Java (source)
  ".jinja", # Jinja templates
  ".js", # JavaScript
  ".json", # JSON
  ".jsp",   # JavaServer Pages
  ".jsx", # JavaScript XML (React)
  ".kt", # Kotlin
  ".less", # LESS
  ".lhs",   # Literate Haskell
  ".lidr",  # Literate Idris
  ".liquid",# Liquid templates (Jekyll, Shopify)
  ".lua", # Lua
  ".m", # Objective-C / MATLAB script
  ".markdown", # Markdown (alternative)
  ".md", # Markdown
  ".ml",    # OCaml
  ".mli",   # OCaml Interface
  ".mustache", # Mustache templates
  ".nim",   # Nim
  ".p"     # Pascal (alternative)
  ".pas",   # Pascal
  ".php", # PHP
  ".pl", # Perl
  ".plist", # Property List (Apple)
  ".plsql", # Oracle PL/SQL
  ".pom",   # Project Object Model (Maven)
  ".pp",    # Pascal (alternative for Free Pascal)
  ".properties", # Java Properties
  ".ps1", # PowerShell Script
  ".psm1", # PowerShell Module
  ".psql",  # PostgreSQL procedural language
  ".pug",   # Pug templates (formerly Jade)
  ".py", # Python
  ".r", # R
  ".rb", # Ruby
  ".re",    # Reason
  ".rei",   # Reason Interface
  ".Rmd",   # R Markdown
  ".rs", # Rust
  ".rst",   # reStructuredText
  ".S",     # Assembly Language (often for Unix-like systems)
  ".sass", # Sass (indented syntax)
  ".scala", # Scala
  ".scss", # SCSS (Sass)
  ".sh", # Shell Script (generic)
  ".slim",  # Slim templates
  ".sln",   # Visual Studio Solution
  ".sol",   # Solidity (for Ethereum)
  ".sql", # SQL Queries
  ".strings", # Resource Strings (Apple)
  ".sty",   # LaTeX Style File
  ".svelte",# Svelte Component
  ".svg",   # Scalable Vector Graphics (XML-based)
  ".swift", # Swift
  ".tcl", # TCL
  ".tex",   # LaTeX
  ".tf",    # Terraform Configuration
  ".tfvars",# Terraform Variables
  ".ts", # TypeScript
  ".tsql",  # Transact-SQL (Microsoft SQL Server)
  ".tsx", # TypeScript XML (React)
  ".txt", # Plain Text
  ".v",     # Verilog
  ".vbhtml", # VB.NET HTML (Razor)
  ".vbcsproj",# Visual Basic .NET Project
  ".vcxproj",# Visual C++ Project
  ".vhd",   # VHDL
  ".vhdl",  # VHDL (alternative)
  ".vim",   # Vim Script
  ".vimrc", # Vim Configuration
  ".vue", # Vue.js Single File Components
  ".zig",   # Zig
  ".zsh", # Zsh Script
}


def clone_repository(
    repo_url: str,
    clone_path: str,
    github_token: Optional[str] = None,
    subpath: Optional[str] = None,
):
    """
    Clone a repository using sparse checkout and blob filtering to minimize memory usage.
    """
    if os.path.exists(clone_path):
        shutil.rmtree(clone_path)
    os.makedirs(clone_path, exist_ok=True)
    env = os.environ.copy()
    if github_token:
        env["GIT_ASKPASS"] = "echo"
        env["GIT_TERMINAL_PROMPT"] = "0"
        repo_url = repo_url.replace("https://", f"https://{github_token}@")
    clone_cmd = [
        "git",
        "clone",
        "--filter=blob:none",
        "--sparse",
        "--depth=1",
        repo_url,
        clone_path,
    ]
    subprocess.run(clone_cmd, check=True, env=env)
    if subpath:
        # Enable sparse checkout for a specific subpath
        subprocess.run(
            ["git", "-C", clone_path, "sparse-checkout", "set", subpath],
            check=True,
            env=env,
        )
    else:
        # When no subpath is specified, disable sparse-checkout to get all files
        subprocess.run(
            ["git", "-C", clone_path, "sparse-checkout", "disable"],
            check=True,
            env=env,
        )


def is_ignored_file(path: Path) -> bool:
    if path.name in IGNORED_FILES:
        return True
    if path.suffix in IGNORED_FILES:
        return True
    return False


def is_ignored_dir(path: Path) -> bool:
    return path.name in IGNORED_DIRS


def is_text_file(path: Path) -> bool:
    return path.suffix.lower() in TEXT_EXTS


def scan_files(
    root: Path,
    depth: int = 0,
    max_depth: int = MAX_DIRECTORY_DEPTH,
    total_size: int = 0,
    max_total_size: int = MAX_TOTAL_SIZE_BYTES,
    files: Optional[List[Path]] = None,
) -> List[Path]:
    if files is None:
        files = []
    if depth > max_depth:
        return files
    for entry in root.iterdir():
        if entry.is_symlink():
            continue
        if entry.is_dir():
            if is_ignored_dir(entry):
                continue
            scan_files(entry, depth + 1, max_depth, total_size, max_total_size, files)
        elif entry.is_file():
            if is_ignored_file(entry):
                continue
            if not is_text_file(entry):
                continue
            size = entry.stat().st_size
            if size > MAX_FILE_SIZE:
                continue
            if total_size + size > max_total_size:
                continue
            files.append(entry)
            total_size += size
    return files


def build_directory_tree(root: Path, prefix: str = "", is_last: bool = True) -> str:
    entries = [e for e in sorted(root.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower()))
               if not (is_ignored_dir(e) if e.is_dir() else is_ignored_file(e))]
    tree_str = ""
    for idx, entry in enumerate(entries):
        connector = "└── " if idx == len(entries) - 1 else "├── "
        tree_str += f"{prefix}{connector}{entry.name}\n"
        if entry.is_dir():
            extension = "    " if idx == len(entries) - 1 else "│   "
            tree_str += build_directory_tree(entry, prefix + extension, is_last=(idx == len(entries) - 1))
    return tree_str


README_MAX_CHARS = 8_000  # cap to keep HTTP response size bounded
README_CANDIDATES = ["README.md", "readme.md", "README.rst", "README.txt", "readme.txt"]


def extract_readme(root: Path) -> str:
    """
    Return the content of the repository's root-level README file, capped at
    README_MAX_CHARS characters.  Returns an empty string when no README is found.
    """
    for name in README_CANDIDATES:
        candidate = root / name
        if candidate.is_file():
            try:
                content = candidate.read_text(encoding="utf-8", errors="replace")
                return content[:README_MAX_CHARS]
            except Exception as e:
                logger.warning(f"Could not read {candidate}: {e}")
                return ""
    return ""


def get_all_text_files(root: Path) -> list:
    files = []
    for entry in root.iterdir():
        if entry.is_symlink():
            continue
        if entry.is_dir():
            if not is_ignored_dir(entry):
                files.extend(get_all_text_files(entry))
        elif entry.is_file():
            if not is_ignored_file(entry) and entry.suffix.lower() in TEXT_EXTS:
                files.append(entry)
    return files


def generate_markdown_digest(
    repo_url: str,
    repo_path: str,
    progress_callback=None,
    return_metadata: bool = False,
) -> "str | Tuple[str, dict]":
    """
    Generate a Markdown digest for a repository.

    Args:
        repo_url: URL of the repository.
        repo_path: Local path to the cloned repository.
        progress_callback: Optional callback for progress updates.
        return_metadata: If True, returns (digest_str, metadata_dict) tuple.
                         If False (default), returns only digest_str for backward compat.

    Returns:
        str: The Markdown digest (when return_metadata=False).
        Tuple[str, dict]: (digest, metadata) when return_metadata=True.
            metadata keys: files_analyzed (int), primary_languages (List[str])
    """
    root = Path(repo_path)
    owner = "unknown"
    repo_short = root.name
    try:
        # Extract a descriptive name from the repo_url
        path_parts = urllib.parse.urlparse(repo_url).path.strip("/").split("/")
        if len(path_parts) >= 2:
            owner, repo_short = path_parts[-2], path_parts[-1]
            if repo_short.endswith(".git"):
                repo_short = repo_short[:-4]
            repo_name = f"{owner}-{repo_short}"
        else:
            # Fallback for unusual URLs
            repo_name = Path(urllib.parse.urlparse(repo_url).path).stem
    except Exception:
        repo_name = root.name  # Fallback to tmpdir name
    digest = []
    if repo_url:
        digest.append(f"Repository: {repo_url}")
    text_files = get_all_text_files(root)
    digest.append(f"Files analyzed: {len(text_files)}\n")
    digest.append("Directory structure:")
    digest.append(f"└── {repo_name}/")
    # Capture the tree string for the metadata (used by WebLLM context)
    file_structure = build_directory_tree(root, prefix="    ")
    digest.append(file_structure)
    readme = extract_readme(root)
    for file_path in text_files:
        rel_path = file_path.relative_to(root)
        digest.append("\n" + "="*48)
        digest.append(f"FILE: {rel_path}")
        digest.append("="*48)
        try:
            content = file_path.read_text(encoding="utf-8", errors="replace")
        except Exception as e:
            content = f"[Could not read file: {e}]"
        digest.append(content)
    digest_str = "\n".join(digest)

    # Guard against responses that exceed Cloud Run's HTTP body limit (~32 MB).
    # Truncate with a clear notice rather than returning a 503 or OOM-killing the instance.
    if len(digest_str.encode("utf-8")) > MAX_DIGEST_BYTES:
        truncation_notice = (
            "\n\n[DIGEST TRUNCATED: repository output exceeded the 10 MB response limit. "
            "Consider analysing a specific sub-path or a smaller repository.]"
        )
        # Binary-safe truncation — decode back to str afterwards.
        digest_bytes = digest_str.encode("utf-8")
        digest_str = digest_bytes[:MAX_DIGEST_BYTES].decode("utf-8", errors="ignore") + truncation_notice

    if return_metadata:
        languages = detect_primary_languages(text_files)
        metadata = {
            "files_analyzed": len(text_files),
            "primary_languages": languages,
            "owner": owner,
            "repo": repo_short,
            "readme": readme,
            "file_structure": file_structure,
        }
        return digest_str, metadata
    return digest_str


# If run as script, keep the CLI for backward compatibility
if __name__ == "__main__":
    import sys
    if len(sys.argv) >= 3:
        repo_url = sys.argv[1]
        clone_path = sys.argv[2]
        clone_repository(repo_url, clone_path)
        logger.info("\n--- Markdown Digest ---\n")
        logger.info(generate_markdown_digest(repo_url, clone_path))
    else:
        logger.info("Usage: python converter.py <repo_url> <clone_path>")
