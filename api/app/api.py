"""
FastAPI application creation and configuration.

Author: João Machete
"""

import os
import tempfile
import asyncio
import urllib.parse
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from fastapi import (
    FastAPI,
    APIRouter,
    Request,
    Query,
    HTTPException,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from starlette.websockets import WebSocketState
from pydantic import BaseModel
from typing import List, Optional

from app.config import settings, origins
import app.converter as converter
from app import skillforge
from app.skillforge import hd as hd_mod
from app.skillforge.errors import ScanBlocked
from app.skillforge.models import RepoMeta
from app.skillforge.exporters import render_framework_export
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

router = APIRouter()


@router.get("/")
def read_root(request: Request):
    """Root endpoint providing a welcome message."""
    return {"message": "GitScape"}

@router.get("/health")
async def health_check():
    return {"status": "OK"}

@router.get("/converter")
@limiter.limit("10/minute")
def get_digest(
    request: Request,
    repo_url: str = Query(..., description="Git repository URL to analyze"),
    github_token: str = Query(
        None,
        description="GitHub Personal Access Token for private repos or increased rate limits",
    ),
):
    """
    HTTP endpoint to clone a Git repository and generate a Markdown digest.
    Returns the digest (Code Digest + Visualization fields) plus the SkillForge
    skill preview (skill_md, references, scan_report, manifest). The skill build is
    defensively wrapped: a skill failure never affects the digest response.
    """
    try:
        repo_url = urllib.parse.unquote(repo_url)
        # The digest fields are produced first and always returned unchanged; the
        # skill is built inside the same block so the live clone is still on disk.
        skill_fields = {
            "skill_md": None,
            "references": None,
            "scan_report": None,
            "manifest": None,
        }
        with tempfile.TemporaryDirectory() as tmpdir:
            clone_path = os.path.join(tmpdir, "repo")
            converter.clone_repository(repo_url, clone_path, github_token=github_token)
            digest_str, metadata = converter.generate_markdown_digest(
                repo_url, clone_path, return_metadata=True
            )

            owner = metadata["owner"]
            repo = metadata["repo"]
            languages = metadata["primary_languages"]
            files_analyzed = metadata["files_analyzed"]
            readme = metadata.get("readme", "")
            file_structure = metadata.get("file_structure", "")
            structure_overview = metadata.get("structure_overview", "")
            generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

            try:
                meta = RepoMeta(
                    owner=owner, repo=repo, repo_url=repo_url,
                    primary_languages=languages, files_analyzed=files_analyzed,
                    readme=readme, file_structure=file_structure,
                    structure_overview=structure_overview, generated_at=generated_at,
                )
                units = skillforge.units_from_clone(Path(clone_path))
                pkg = skillforge.build_skill(
                    units, meta, digest_hash=skillforge.content_hash(digest_str)
                )
                skillforge.skill_cache.set(skillforge.cache_key(digest_str), pkg)
                skill_fields = {
                    "skill_md": pkg.skill_md,
                    "references": pkg.references,
                    "scan_report": pkg.scan_report.model_dump(mode="json"),
                    "manifest": pkg.manifest.model_dump(mode="json"),
                }
            except Exception:
                logger.exception("SkillForge build failed; returning digest only")

        return {
            "digest": digest_str,
            "primary_languages": languages,
            "files_analyzed": files_analyzed,
            "readme": readme,
            "file_structure": file_structure,
            "structure_overview": structure_overview,
            **skill_fields,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class SkillZipRequest(BaseModel):
    repo_url: str
    owner: str
    repo: str
    digest_md: str
    languages: List[str] = []
    files_analyzed: int = 0
    bypass_scan_gate: bool = False
    skill_type: str = "code"  # "code" | "framework"


def _readme_from_units(units) -> str:
    for u in units:
        if Path(u.path).name.lower().startswith("readme"):
            return u.content
    return ""


def _build_from_digest(body: "SkillZipRequest", repo_url: str, *, hd: bool = False):
    """Build (or fetch cached) a SkillPackage from a client-supplied digest."""
    key = skillforge.cache_key(body.digest_md)
    skill_type = getattr(body, "skill_type", "code")
    if hd:
        key += ":hd"
    if skill_type == "framework":
        key += ":framework"
    pkg = None if hd else skillforge.skill_cache.get(key)
    if pkg is not None:
        return pkg

    doc = skillforge.parse_digest(body.digest_md)
    meta = RepoMeta(
        owner=body.owner, repo=body.repo, repo_url=repo_url,
        primary_languages=body.languages,
        files_analyzed=body.files_analyzed or doc.files_analyzed,
        readme=_readme_from_units(doc.units), file_structure=doc.tree,
    )
    pkg = skillforge.build_skill(
        doc.units, meta,
        digest_hash=skillforge.content_hash(body.digest_md),
        hd=hd,
        skill_type=skill_type,
    )
    skillforge.skill_cache.set(key, pkg)
    return pkg


@router.post("/skill-zip")
def get_skill_zip(
    request: Request,
    body: SkillZipRequest,
):
    """
    Build and return a downloadable ZIP skill package from a pre-computed digest.

    Hits the SkillForge cache when the digest matches a prior /converter build
    (no recompute); otherwise rebuilds deterministically from the digest. The
    security scanner gates the download: a FAIL returns 422 with the report.

    ZIP contains: SKILL.md, references/*.md, exporters/*.py, manifest.json.
    """
    try:
        repo_url = urllib.parse.unquote(body.repo_url)
        pkg = _build_from_digest(body, repo_url)
        try:
            zip_buffer = skillforge.build_zip(pkg, bypass_scan_gate=body.bypass_scan_gate)
        except ScanBlocked as blocked:
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "scan_failed",
                    "scan_report": blocked.report.model_dump(mode="json"),
                },
            )

        filename = f"{body.repo}-skill.zip"
        return StreamingResponse(
            zip_buffer,
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class HdProseRequest(SkillZipRequest):
    """Same payload as /skill-zip; rebuilds the skill with Gemini-written prose."""


@router.post("/skill/hd-prose")
@limiter.limit("5/minute")
def get_hd_prose(
    request: Request,
    body: HdProseRequest,
):
    """
    HD mode: rebuild the skill with LLM-written prose (Gemini Flash, server-side
    key) layered over the deterministic structure. Returns the enhanced skill_md +
    references + scan_report + manifest. 503 when no server key is configured.
    """
    if not hd_mod.hd_available():
        raise HTTPException(status_code=503, detail="HD mode is not configured on this server.")
    try:
        repo_url = urllib.parse.unquote(body.repo_url)
        pkg = _build_from_digest(body, repo_url, hd=True)
        return {
            "skill_md": pkg.skill_md,
            "references": pkg.references,
            "scan_report": pkg.scan_report.model_dump(mode="json"),
            "manifest": pkg.manifest.model_dump(mode="json"),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class FrameworkSkillRequest(SkillZipRequest):
    """Same payload as /skill-zip; builds an Engineering Skill using the framework anatomy."""
    skill_type: str = "framework"


@router.post("/skill/framework")
@limiter.limit("5/minute")
def get_framework_skill(
    request: Request,
    body: FrameworkSkillRequest,
):
    """
    Engineering Skill mode: uses Gemini to generate all 6 canonical framework
    sections (Overview, When to Use, Core Process, Common Rationalizations,
    Red Flags, Verification) over the deterministic extract. HD key required.
    Returns skill_md + references + scan_report + manifest.
    503 when no Gemini API key is configured on this server.
    """
    if not hd_mod.hd_available():
        raise HTTPException(
            status_code=503,
            detail="Engineering Skill mode requires the Gemini API key to be configured on this server.",
        )
    try:
        repo_url = urllib.parse.unquote(body.repo_url)
        pkg = _build_from_digest(body, repo_url)
        return {
            "skill_md": pkg.skill_md,
            "references": pkg.references,
            "scan_report": pkg.scan_report.model_dump(mode="json"),
            "manifest": pkg.manifest.model_dump(mode="json"),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/export/{framework}")
@limiter.limit("10/minute")
def get_framework_export(
    request: Request,
    framework: str,
    repo_url: str = Query(..., description="Git repository URL"),
):
    """
    Render and download a Python framework integration file for the given skill.

    Supported frameworks:
      - adk   : Google Agent Development Kit (google-adk)
      - agno  : Agno Knowledge Agent

    Returns a downloadable .py file named {repo}-{framework}-skill.py
    """
    framework = framework.lower()
    if framework not in ("adk", "agno"):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported framework '{framework}'. Supported: adk, agno",
        )

    try:
        decoded_url = urllib.parse.unquote(repo_url)
        # Extract owner/repo from URL, e.g. https://github.com/owner/repo[.git]
        parts = decoded_url.rstrip("/").rstrip(".git").split("/")
        if len(parts) < 2:
            raise ValueError("Cannot parse owner/repo from URL")
        owner = parts[-2]
        repo = parts[-1].removesuffix(".git")

        code = render_framework_export(framework=framework, owner=owner, repo=repo)
        filename = f"{repo}-{framework}-skill.py"

        return StreamingResponse(
            iter([code.encode("utf-8")]),
            media_type="text/x-python",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.websocket("/ws/converter")
async def websocket_converter(
    websocket: WebSocket,
    repo_url: str = Query(..., description="Git repository URL to analyze"),
    github_token: str = Query(
        None,
        description="GitHub Personal Access Token for private repos or increased rate limits",
    ),
):
    """
    WebSocket endpoint to clone a Git repository and generate a Markdown digest,
    streaming progress updates to the client as JSON with percentage.
    """
    await websocket.accept()
    loop = asyncio.get_event_loop()
    sender_task = None

    try:
        repo_url = urllib.parse.unquote(repo_url)
        with tempfile.TemporaryDirectory() as tmpdir:
            clone_path = os.path.join(tmpdir, "repo")
            await websocket.send_text(
                json.dumps(
                    {
                        "type": "progress",
                        "message": "Starting repository clone...",
                        "percentage": 0,
                    }
                )
            )
            converter.clone_repository(repo_url, clone_path, github_token=github_token)
            await websocket.send_text(
                json.dumps(
                    {
                        "type": "progress",
                        "message": "Repository cloned. Starting digest generation...",
                        "percentage": 10,
                    }
                )
            )

            progress_queue = asyncio.Queue()

            def sync_progress_callback(message: str, percentage: int):
                try:
                    asyncio.run_coroutine_threadsafe(
                        progress_queue.put(
                            {
                                "type": "progress",
                                "message": message,
                                "percentage": percentage,
                            }
                        ),
                        loop,
                    ).result()
                except Exception as e:
                    logger.error(
                        f"Error in sync_progress_callback putting to queue: {e}"
                    )

            async def queue_to_websocket_sender():
                while True:
                    item = await progress_queue.get()
                    if item is None:
                        progress_queue.task_done()
                        break
                    try:
                        await websocket.send_text(json.dumps(item))
                    except WebSocketDisconnect:
                        logger.info("WebSocket disconnected during send from queue.")
                        progress_queue.task_done()
                        break
                    except Exception as e:
                        logger.error(
                            f"Error sending message from queue to websocket: {e}"
                        )
                    progress_queue.task_done()
                    await asyncio.sleep(0.01)

            sender_task = asyncio.create_task(queue_to_websocket_sender())

            def progress_callback(message, percentage):
                sync_progress_callback(message, percentage)

            markdown_digest = await loop.run_in_executor(
                None,
                converter.generate_markdown_digest,
                repo_url,
                clone_path,
                progress_callback,
            )

            await progress_queue.put(None)
            await progress_queue.join()
            await sender_task

            await websocket.send_text(
                json.dumps(
                    {
                        "type": "digest_complete",
                        "digest": markdown_digest,
                        "percentage": 100,
                    }
                )
            )

    except WebSocketDisconnect:
        logger.info(f"Client {websocket.client} disconnected")
    except Exception as e:
        error_message = f"An unexpected error occurred: {str(e)}"
        try:
            if websocket.client_state == websocket.client_state.CONNECTED:
                await websocket.send_text(
                    json.dumps(
                        {"type": "error", "message": error_message, "percentage": 100}
                    )
                )
        except Exception as ws_send_error:
            logger.error(
                f"Error sending error to WebSocket during general exception: {ws_send_error}"
            )
        logger.error(error_message)
    finally:
        if sender_task and not sender_task.done():
            sender_task.cancel()
            try:
                await sender_task
            except asyncio.CancelledError:
                logger.info("Sender task cancelled.")
            except Exception as e_cancel:
                logger.error(f"Error during sender_task cancellation: {e_cancel}")
        if websocket.client_state == WebSocketState.CONNECTED:
            try:
                await websocket.close()
            except RuntimeError as close_err:
                logger.warning(f"WebSocket close error (already closed?): {close_err}")
        logger.info(f"WebSocket connection closed for {websocket.client}")


def create_app() -> FastAPI:
    """
    Create and configure the FastAPI application
    """
    app = FastAPI(
        title=str(settings.APP_NAME),
        description=str(settings.APP_DESCRIPTION),
        version=str(settings.APP_VERSION),
    )

    # Configure CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=[
            "Access-Control-Allow-Origin",
            "Access-Control-Allow-Methods",
            "Access-Control-Allow-Headers",
        ],
    )

    return app
