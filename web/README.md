# Git Scape AI — Web

**The React frontend for [Git Scape AI](https://gitscape.ai/).**

![React](https://img.shields.io/badge/React-61DAFB.svg?style=for-the-badge&logo=React&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6.svg?style=for-the-badge&logo=TypeScript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-06B6D4.svg?style=for-the-badge&logo=Tailwind-CSS&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF.svg?style=for-the-badge&logo=Vite&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED.svg?style=for-the-badge&logo=Docker&logoColor=white)

> Part of the [GitScape monorepo](../README.md). See also: [`api/`](../api/README.md).

---

## 🚀 Overview

![GitScape](https://ik.imagekit.io/lmewht1ww/Git%20Scape%20AI/Screenshot_12.png?updatedAt=1748956392835)

The `web/` workspace is the browser-based interface for Git Scape AI. It lets you analyze any public or private GitHub repository, read a Markdown digest, visualize its structure as an interactive diagram, and export the repo as a downloadable **Agent Skill** — with a visible security report.

### Key Features

- **Code Digest** — A complete, AI-ready text digest of any GitHub repo via the backend API.
- **Interactive Diagram** — D3-powered tree visualization of the repository file structure.
- **Agent Skill Export** — Preview the generated `SKILL.md` + `references/`, switch between **Standard** (deterministic) and **HD** (LLM prose) tiers, and download the packaged `.zip`.
- **Scanned & Safe badge** — Every skill shows a PASS / WARN / FAIL scan result; download is blocked on FAIL and requires acceptance on WARN.
- **URL Converter** — Transforms a GitHub URL into API-compatible repo parameters.
- **Privacy First** — Your GitHub PAT is stored only in the browser; the HD model key lives server-side, never in the bundle.

> **Note:** the old in-browser **WebLLM** skill writer (`@mlc-ai/web-llm`, ~700 MB model download) has been **removed**. Skill generation is now deterministic on the server, and HD prose runs through the API — so there's nothing heavy to download and the Standard tier needs no GPU/WebGPU.

---

## 🏗️ Architecture

```
web/
├── App.tsx                 # Root orchestrator — state, routing, data flow
├── index.tsx               # React entry point
├── index.html              # HTML shell (Vite)
├── types.ts                # Shared TypeScript interfaces
├── constants.ts            # API base URLs, config values
├── components/
│   ├── Header.tsx          # Top navigation bar
│   ├── RepoInput.tsx       # GitHub URL input & repo resolver
│   ├── DigestOutput.tsx    # Markdown digest renderer
│   ├── Diagram.tsx         # D3 interactive file-tree diagram
│   ├── DiagramFullscreenModal.tsx
│   ├── OutputTabs.tsx      # Lays out Digest / Visualization / Agent Skill
│   ├── SkillExport.tsx     # Agent Skill preview, scan badge, Standard/HD toggle, download
│   ├── UrlConverter.tsx    # GitHub URL → path converter utility
│   ├── GithubTokenModal.tsx
│   ├── LoadingSpinner.tsx
│   └── diagramUtils.ts     # D3 tree layout helpers
├── services/               # External integrations (GitHub API, repo cache)
├── public/                 # Static assets
├── vite.config.ts
├── tailwind.config.js
└── Dockerfile              # Nginx-based production container
```

### Technology Stack

| Layer | Technology |
|---|---|
| Framework | React 19 |
| Language | TypeScript 5.7 |
| Bundler | Vite 6 |
| Styling | Tailwind CSS 4 |
| Diagrams | D3.js 7 |
| Skill generation | Backend SkillForge API (no client model) |
| Deployment | Docker + Nginx → Google Cloud Run |

---

## 🏁 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) v18+

### 1. Install Dependencies

```bash
cd web
npm install
```

### 2. Configure Environment

By default the app talks to the **production** API at `api.gitscape.ai`. To develop
against a **local** backend (required to use the new skill endpoints such as
`/skill-zip` and `/skill/hd-prose`), create a `.env.local` file in `web/`:

```env
# Point the frontend at your locally-running api/ service
VITE_API_HOST=localhost:8080
```

- Run the backend on the matching port — see [`api/README.md`](../api/README.md) (`uvicorn main:app --port 8080`).
- Your **GitHub Personal Access Token** (PAT) for private repos is entered directly in the app UI — no `.env` needed.
- **No Gemini key is needed here** — HD skill prose is generated server-side by the API.

> **Seeing `api.gitscape.ai/skill/hd-prose 404`?** Your frontend is hitting production
> (which may not have the latest routes yet). Set `VITE_API_HOST=localhost:8080` and run
> the local backend to test the new features end-to-end.

### 3. Run the Dev Server

```bash
npm run dev
# → http://localhost:5173
```

### Other Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start local dev server (HMR) |
| `npm run build` | Build production bundle |
| `npm run preview` | Preview the production build |

---

## 🧠 Agent Skill Export

The **Agent Skill** card (`SkillExport.tsx`) is the UI for the backend
[SkillForge](../api/README.md#-skillforge--agent-skill-generation) pipeline:

- **Standard / HD toggle** — *Standard* renders the deterministic skill instantly (no model).
  *HD* calls `POST /skill/hd-prose` to layer in Gemini-written prose; returns `503` (shown inline) if the server has no key.
- **Scanned & Safe badge** — shows the scan `status` and expandable findings. **FAIL disables the
  download**; **WARN requires** ticking "I accept the warnings" first.
- **File viewer** — switch between `SKILL.md` and each `references/*.md` and copy any of them.
- **Download `.zip`** — `POST /skill-zip`; a server-side `FAIL` returns `422` and the badge updates to show the blocking findings.

This card is the only part of the app that talks to the skill endpoints — the Code Digest and
Code Visualization features are unchanged.

---

## 🐳 Docker

The `web/` container serves the Vite production build via **Nginx** on port `8080`.

```bash
# Build
docker build -t git_scape_web .

# Run locally
docker run -d -p 8080:8080 --name git_scape_web_local git_scape_web
# → http://localhost:8080
```

### Deploy to Google Cloud Run

```bash
# Build & push via Cloud Build
gcloud beta builds submit --tag REGION-docker.pkg.dev/PROJECT_ID/REPO/git_scape_web:latest .

# Deploy
gcloud run deploy git-scape-web \
  --image REGION-docker.pkg.dev/PROJECT_ID/REPO/git_scape_web:latest \
  --platform managed \
  --region REGION \
  --allow-unauthenticated \
  --project PROJECT_ID
```

---

## 🛡️ Security & Privacy

- **GitHub PAT** stays in your browser and goes directly to the GitHub API — never to a GitScape server.
- **HD model key** lives **server-side** only; it is never shipped in the frontend bundle.
- **Skill safety**: every generated skill passes through a deterministic security scanner before it can be downloaded.
- **Open Source**: Audit the code, fork it, or self-host it.

---

## 🧑‍💻 Contributing

1. Fork the repo and create a feature branch.
2. Make your changes inside `web/`.
3. Test with `npm run dev`.
4. Commit, push, and open a Pull Request.

**Code style:** TypeScript + React conventions, Tailwind CSS, follow existing patterns.

---

## 📚 Resources

- [Git Scape AI Website](https://gitscape.ai/)
- [Gemini API Key Docs](https://ai.google.dev/gemini-api/docs/api-key)
- [GitHub PAT Docs](https://github.com/settings/tokens/new?scopes=repo&description=GitRepoDigestAI)
- [Git Scape API (Backend)](../api/README.md)

---

## 📝 License

This project is licensed under the [MIT License](LICENSE).

---

## 🙏 Acknowledgements

Created by [João Machete](https://github.com/jmxt3) and contributors.

If you like this project, please ⭐️ the repo and share your feedback!
