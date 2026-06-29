# Git Scape AI — API

**The FastAPI backend for [Git Scape AI](https://gitscape.ai/).**

![Python](https://img.shields.io/badge/Python-3776AB.svg?style=for-the-badge&logo=Python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688.svg?style=for-the-badge&logo=FastAPI&logoColor=white)
![Google Cloud](https://img.shields.io/badge/Google%20Cloud-4285F4.svg?style=for-the-badge&logo=Google-Cloud&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED.svg?style=for-the-badge&logo=Docker&logoColor=white)

> Part of the [GitScape monorepo](../README.md). See also: [`web/`](../web/README.md).

---

## 🚀 Overview

The `api/` workspace is the backend service that powers Git Scape AI. It clones any public or private GitHub repository, analyzes its structure, streams a Markdown digest back to the client, and packages the repo into a downloadable **Agent Skill** via the **SkillForge** pipeline.

### Key Features

- **REST endpoint** — HTTP digest generation that also returns the skill preview (`GET /converter`).
- **WebSocket endpoint** — Real-time streaming with live progress (`WS /ws/converter`).
- **SkillForge** — Deterministic Agent Skill generation (tree-sitter), with an optional Gemini "HD" prose tier. See [SkillForge](#-skillforge--agent-skill-generation).
- **Security scanner** — Pure-Python, zero-LLM gate over every generated skill (prompt injection, exfiltration, hidden text). `FAIL` blocks export.
- **Rate limiting** — Per-IP throttling via SlowAPI to protect the service.
- **Request timing** — `X-Process-Time-Sec` header on every response for observability.
- **Cloud Run ready** — Listens on the `PORT` env variable, defaults to `8080`.

---

## 🏗️ Architecture

```
api/
├── main.py               # FastAPI entrypoint: middleware, rate limiter, router mounting
├── app/
│   ├── api.py            # App factory (CORS), all HTTP & WebSocket routes
│   ├── converter.py      # Core logic: clone → analyze → build digest
│   ├── config.py         # Pydantic Settings (env-based configuration)
│   ├── skill_builder.py  # Shared helpers: language detection, skill naming
│   └── skillforge/       # Agent Skill pipeline (see below)
│       ├── parse.py      #   digest/clone → ContentUnit[]
│       ├── classify.py   #   docs | source | config | test | other
│       ├── extract/      #   tree-sitter symbols, import graph, setup, examples
│       ├── assemble.py   #   token-budgeted SKILL.md + references/
│       ├── scan.py       #   deterministic security gate (PASS/WARN/FAIL)
│       ├── hd.py         #   optional Gemini Flash prose
│       ├── exporters.py  #   Google ADK + Agno wrappers
│       └── package.py    #   zip the package, enforce the gate
├── tests/                # pytest suite (parser, extractor, scanner, API)
├── pyproject.toml        # Project metadata & dependencies
├── requirements.txt      # Pinned pip requirements
├── Dockerfile            # Production container (Python + uvicorn)
└── .env.example          # Environment variable template
```

### Request Flow

```
Client
  │
  ├─ GET /converter?repo_url=...
  │      └─ converter.py → digest  ┐
  │         skillforge.build_skill ┴→ digest + skill_md + references + scan_report + manifest
  │         (skill build is try/except-wrapped — a skill failure never breaks the digest)
  │
  ├─ WS /ws/converter?repo_url=...
  │      └─ converter.py → streaming progress + final digest
  │
  ├─ POST /skill-zip          → cached/rebuilt skill .zip  (422 + report if scan FAILs)
  ├─ POST /skill/hd-prose     → skill rebuilt with Gemini prose (503 if no key)
  └─ GET  /export/{framework} → ADK / Agno wrapper (.py)
```

### Technology Stack

| Layer | Technology |
|---|---|
| Framework | FastAPI |
| Language | Python 3.10 |
| Package Manager | [`uv`](https://github.com/astral-sh/uv) |
| ASGI Server | Uvicorn |
| Code parsing | tree-sitter (Python, TS/TSX, JS/JSX, Go) |
| HD prose (optional) | Gemini Flash via REST (server-side key) |
| Rate Limiting | SlowAPI |
| Deployment | Docker → Google Cloud Run |

---

## 🏁 Quick Start

### Prerequisites

- Python 3.10+
- [`uv`](https://github.com/astral-sh/uv) — fast Python package manager

**Install `uv`:**
```bash
# macOS / Linux
curl -LsSf https://astral.sh/uv/install.sh | sh

# or via pip
pip install uv
```

### 1. Create Environment & Install Dependencies

```bash
cd api
uv venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
uv sync
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env as needed
```

`.env.example` template:
```env
ENVIRONMENT=development
APP_NAME="GitScape API"
APP_DESCRIPTION="The official API for GitScape, a tool for generating digests from any git repositories."
APP_VERSION="0.1.0"

# HD skill prose (optional). Server-side Gemini key — never exposed to the browser.
# Leave blank to disable HD mode; the deterministic Standard tier needs no key.
GEMINI_API_KEY=""
HD_MODEL="gemini-3.1-flash-lite"
```

> **HD mode** is optional. With no `GEMINI_API_KEY`, `POST /skill/hd-prose` returns `503`
> and the deterministic Standard skill is unaffected.

### 3. Run the API

```bash
# Development (with hot reload)
uvicorn main:app --host 0.0.0.0 --port 8080 --reload
# or
fastapi dev

# Production
uvicorn main:app --host 0.0.0.0 --port 8080 --workers 4
```

> Use port **8080** locally so the frontend's `VITE_API_HOST=localhost:8080` lines up
> (see [`web/README.md`](../web/README.md)).

### 4. Explore the Docs

| Interface | URL |
|---|---|
| Swagger UI | http://localhost:8080/docs |
| ReDoc | http://localhost:8080/redoc |

### 5. Run the Tests

```bash
uv run pytest -q          # parser, classifier, extractor, assembler, scanner, API
```

---

## 📡 API Reference

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Health check — returns service name & status |
| `GET` | `/converter` | Clone a repo → digest **+** skill preview (`skill_md`, `references`, `scan_report`, `manifest`) |
| `WS` | `/ws/converter` | Real-time streaming digest with live progress events |
| `POST` | `/skill-zip` | Build/return the skill `.zip` from a digest. **`422` + scan report if the scan FAILs** |
| `POST` | `/skill/hd-prose` | Rebuild the skill with Gemini-written prose. `503` if no server key |
| `GET` | `/export/{framework}` | Download an `adk` or `agno` framework wrapper (`.py`) |

`GET`/`WS` take query strings; `POST` bodies are JSON. See `/docs` for the full schema.

---

## 🧠 SkillForge — Agent Skill generation

SkillForge (`app/skillforge/`) converts a repository into a progressively-disclosed
[Agent Skill](https://agentskills.io). Core principle: **invert the labor** — do ~90%
deterministically, use an LLM only for short prose glue.

```
ingest → parse → classify → extract → sanitize → assemble → scan (GATE) → package
```

- **extract** (the quality lever, zero-LLM): tree-sitter builds a public API/symbol index
  (signatures + one-line purpose), an import/dependency graph, mined setup commands, and
  deduped code examples.
- **assemble**: a slim, token-budgeted `SKILL.md` + a `references/` folder
  (`api.md`, `architecture.md`, `examples.md`, `setup.md`, `config.md`), each chunk stamped
  with its source path. The full digest is **not** bundled.
- **package**: zips `SKILL.md` + `references/` + ADK/Agno `exporters/` + a provenance-stamped
  `manifest.json` (digest hash + per-chunk provenance + scan status).

**Caching:** keyed on the digest's SHA-256 + builder version. `GET /converter` populates the
cache; `POST /skill-zip` reuses it, so an identical digest never recomputes.

### Tiers

| Tier | Behavior | Key |
|---|---|---|
| **Standard** (default) | Complete, valid skill built deterministically — zero LLM calls | none |
| **HD** | Adds Gemini Flash prose (the "what / when / description") over the same structure | `GEMINI_API_KEY` |

### 🛡️ Security scanner (`scan.py`)

Pure-Python, deterministic, **no LLM**. Runs over `SKILL.md` + `references/*.md` (+ any shipped
script) and detects prompt injection, exfiltration patterns, hidden/invisible unicode, and
high-entropy blobs. Findings are attributed back to the originating repo file.

- **PASS** → export allowed · **WARN** → needs explicit acceptance · **FAIL** → export blocked.
- The gate is enforced in `package.py`; `POST /skill-zip` surfaces a `FAIL` as HTTP `422` with the report.

> Adding a language: install the `tree-sitter-<lang>` grammar and extend `SUFFIX_TO_LANG` in
> `app/skillforge/extract/symbols.py`. (Use the individual grammar packages, **not**
> `tree-sitter-language-pack`, which has an ABI mismatch with the installed core.)

---

## 🐳 Docker

```bash
# Build
docker build -t git_scape_api .

# Run locally
docker run -d -p 8080:8080 --name git_scape_api_local git_scape_api
# → http://localhost:8080/docs

# Cleanup
docker stop git_scape_api_local && docker rm git_scape_api_local && docker rmi git_scape_api
```

### Deploy to Google Cloud Run

```bash
# 1. Enable required APIs
gcloud services enable run.googleapis.com artifactregistry.googleapis.com

# 2. Build & push via Cloud Build
gcloud beta builds submit \
  --tag REGION-docker.pkg.dev/PROJECT_ID/REPO/git_scape_api:latest .

# 3. Deploy
gcloud run deploy git-scape-api \
  --image REGION-docker.pkg.dev/PROJECT_ID/REPO/git_scape_api:latest \
  --platform managed \
  --region REGION \
  --allow-unauthenticated \
  --project PROJECT_ID
```

> **Cloud Run note:** The container reads the `PORT` env variable injected by Cloud Run and defaults to `8080` if absent. Keep your service stateless — any persistent state should live in Cloud SQL, Firestore, or Cloud Storage.

---

## 🧑‍💻 Contributing

1. Fork the repo and create a feature branch.
2. Make your changes inside `api/`.
3. Ensure code is formatted (`black`) and type-checked.
4. Open a Pull Request with a clear description.
5. For bugs or feature requests, open a [GitHub Issue](https://github.com/jmxt3/Git-Scape-API/issues).

**Code style:** PEP8, `black` formatting, type hints + docstrings on all public functions. Keep API routing (`api.py`) and business logic (`converter.py`) separate.

---

## 📚 Resources

- [Git Scape AI Website](https://gitscape.ai/)
- [FastAPI Docs](https://fastapi.tiangolo.com/)
- [uv Docs](https://docs.astral.sh/uv/)
- [Google Cloud Run Docs](https://cloud.google.com/run/docs)
- [Git Scape Web (Frontend)](../web/README.md)

---

## 📝 License

This project is licensed under the [MIT License](LICENSE).

---

## 🙏 Acknowledgements

Created by [João Machete](https://github.com/jmxt3) and contributors.

If you like this project, please ⭐️ the repo and share your feedback!
