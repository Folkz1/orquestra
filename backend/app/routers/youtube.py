"""
Orquestra - YouTube Router
Trend analysis, content briefs, and channel analytics for GuyFolkz.
"""

import logging
import os
import json
import tempfile
import uuid
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import MemoryEmbedding
from app.schemas import (
    YouTubeAnalyzeRequest,
    YouTubeAnalyzeResponse,
    YouTubeChannelStats,
    YouTubeScheduleRequest,
    YouTubeSendBriefRequest,
    YouTubeUploadUrlRequest,
    YouTubeVideoUpdate,
)
from app.services.youtube import analyze_channel_trends, generate_content_brief
from app.services.youtube_data import (
    build_oauth_authorization_url,
    decode_oauth_state,
    encode_oauth_state,
    exchange_oauth_code,
    fetch_current_channel_id,
    get_or_create_project_by_name,
    get_channel_stats,
    get_project_access_token,
    get_project_by_name,
    get_video_detail,
    list_channel_videos,
    publish_video,
    resolve_oauth_client_config,
    save_youtube_oauth_credentials,
    schedule_video,
    set_thumbnail,
    update_video_metadata,
    upload_video,
)
from app.services.whatsapp import send_content_brief_to_whatsapp
from app.services.memory import store_memory

logger = logging.getLogger(__name__)

router = APIRouter()

THUMBNAILS_DIR = os.path.join(settings.UPLOAD_DIR, "thumbnails")


def _ok(data: Any) -> dict[str, Any]:
    return {"status": "ok", "data": data}


def _error(message: str, status_code: int = 400) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"status": "error", "data": {"message": message}},
    )


def _error_status_code(message: str) -> int:
    lowered = message.lower()
    if "not found" in lowered:
        return 404
    if "invalid" in lowered or "missing" in lowered:
        return 400
    return 400


def _resolve_project_name(project_name: str | None) -> str:
    return project_name or settings.YOUTUBE_PROJECT_NAME


def _parse_tags_field(raw_tags: str | None) -> list[str]:
    if not raw_tags:
        return []

    try:
        parsed = json.loads(raw_tags)
        if isinstance(parsed, list):
            return [str(tag).strip() for tag in parsed if str(tag).strip()]
    except (json.JSONDecodeError, TypeError):
        pass

    return [part.strip() for part in raw_tags.split(",") if part.strip()]


def _build_redirect_uri(request: Request) -> str:
    return settings.YOUTUBE_OAUTH_REDIRECT_URI or str(request.url_for("youtube_oauth_callback"))


def _create_temp_path(prefix: str, suffix: str) -> str:
    fd, temp_path = tempfile.mkstemp(prefix=prefix, suffix=suffix or ".bin")
    os.close(fd)
    return temp_path


async def _save_upload_to_temp(upload: UploadFile, prefix: str) -> str:
    extension = os.path.splitext(upload.filename or "")[1] or ".bin"
    temp_path = _create_temp_path(prefix, extension)

    with open(temp_path, "wb") as output_file:
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            output_file.write(chunk)

    await upload.close()
    return temp_path


async def _download_url_to_temp(url: str, prefix: str) -> str:
    extension = os.path.splitext(httpx.URL(url).path)[1] or ".bin"
    temp_path = _create_temp_path(prefix, extension)

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(300.0, connect=30.0),
        follow_redirects=True,
    ) as client:
        async with client.stream("GET", url) as response:
            response.raise_for_status()
            with open(temp_path, "wb") as output_file:
                async for chunk in response.aiter_bytes():
                    output_file.write(chunk)

    return temp_path


def _cleanup_temp_file(file_path: str | None) -> None:
    if file_path and os.path.exists(file_path):
        try:
            os.remove(file_path)
        except OSError:
            logger.warning("[YOUTUBE] Failed to remove temp file %s", file_path)


# ─── Briefing Models ────────────────────────────────────────────────

class BriefingVideo(BaseModel):
    title: str
    alternatives: list[str] = Field(default_factory=list)
    hook: str = ""
    thumbnail_prompt: str = ""
    thumbnail_whisk_refine: str = ""
    thumbnail_prompts_ptbr: list[str] = Field(default_factory=list)
    roteiro: dict[str, str] = Field(default_factory=dict)
    keywords: list[str] = Field(default_factory=list)
    urgencia: str = "Media"
    formato: str = ""
    duracao: str = ""
    potencial_views: str = ""
    potencial_b2b: str = ""
    # Campos de producao (tela do Diego)
    contexto: str = ""  # briefing completo: o que e o assunto, por que importa agora
    pontos_chave: list[str] = Field(default_factory=list)  # bullets do que mencionar
    dinamica: str = ""  # como conduzir: camera, tela, transicoes
    referencias: list[dict[str, str]] = Field(default_factory=list)  # [{title, url, nota}]
    descricao_youtube: str = ""  # descricao pronta para copiar
    tags_youtube: list[str] = Field(default_factory=list)  # tags formatadas


class BriefingSave(BaseModel):
    date: str
    tipo: str = "noticias-ia"
    calendario: str = ""
    videos: list[BriefingVideo] = Field(default_factory=list)
    tendencias: list[dict[str, Any]] = Field(default_factory=list)
    metricas_canal: dict[str, Any] = Field(default_factory=dict)
    insight_estrategico: str = ""
    thumbnail_template: str = ""


class AnalyticsSave(BaseModel):
    date: str
    subscribers: int = 0
    total_views: int = 0
    videos_count: int = 0
    avg_views: int = 0
    median_views: int = 0
    max_views: int = 0
    videos: list[dict[str, Any]] = Field(default_factory=list)


# ─── Briefings (public) ────────────────────────────────────────────

@router.post("/briefings")
async def save_briefing(body: BriefingSave, db: AsyncSession = Depends(get_db)):
    """Save a YouTube content briefing."""
    import json
    content_text = f"YouTube Briefing {body.date} ({body.tipo}): "
    content_text += "; ".join(v.title for v in body.videos[:5])

    mem = MemoryEmbedding(
        source_type="youtube_briefing",
        content=content_text,
        summary=f"Briefing YouTube {body.date} - {len(body.videos)} videos",
        metadata_={"briefing": body.model_dump()},
        project_name="GuyFolkz",
    )
    db.add(mem)
    await db.flush()
    await db.refresh(mem)
    logger.info("[YOUTUBE] Saved briefing %s with %d videos", body.date, len(body.videos))
    return {"id": str(mem.id), "date": body.date, "videos": len(body.videos)}


@router.get("/briefings/latest")
async def get_latest_briefing(db: AsyncSession = Depends(get_db)):
    """Get the latest YouTube briefing (PUBLIC - no auth required)."""
    stmt = (
        select(MemoryEmbedding)
        .where(MemoryEmbedding.source_type == "youtube_briefing")
        .order_by(desc(MemoryEmbedding.created_at))
        .limit(1)
    )
    result = await db.execute(stmt)
    mem = result.scalar_one_or_none()
    if not mem:
        return {"briefing": None}
    meta = mem.metadata_ or {}
    return {"briefing": meta.get("briefing", {}), "created_at": str(mem.created_at)}


@router.get("/briefings")
async def list_briefings(
    limit: int = Query(10, le=50),
    db: AsyncSession = Depends(get_db),
):
    """List all YouTube briefings."""
    stmt = (
        select(MemoryEmbedding)
        .where(MemoryEmbedding.source_type == "youtube_briefing")
        .order_by(desc(MemoryEmbedding.created_at))
        .limit(limit)
    )
    result = await db.execute(stmt)
    rows = result.scalars().all()
    return [
        {
            "id": str(r.id),
            "date": (r.metadata_ or {}).get("briefing", {}).get("date", ""),
            "tipo": (r.metadata_ or {}).get("briefing", {}).get("tipo", ""),
            "videos_count": len((r.metadata_ or {}).get("briefing", {}).get("videos", [])),
            "summary": r.summary,
            "created_at": str(r.created_at),
        }
        for r in rows
    ]


# ─── Video Actions (Andriely workflow - PUBLIC) ─────────────────────

@router.patch("/briefings/latest/videos/{video_index}")
async def update_video(
    video_index: int,
    chosen_title: Optional[str] = Form(None),
    status: Optional[str] = Form(None),
    thumbnail_prompts_ptbr: Optional[str] = Form(None),
    youtube_video_id: Optional[str] = Form(None),
    thumbnail: Optional[UploadFile] = File(None),
    db: AsyncSession = Depends(get_db),
):
    """Update a video in the latest briefing (choose title, upload thumbnail, set status)."""
    stmt = (
        select(MemoryEmbedding)
        .where(MemoryEmbedding.source_type == "youtube_briefing")
        .order_by(desc(MemoryEmbedding.created_at))
        .limit(1)
    )
    result = await db.execute(stmt)
    mem = result.scalar_one_or_none()
    if not mem:
        return {"error": "No briefing found"}

    meta = dict(mem.metadata_ or {})
    briefing = dict(meta.get("briefing", {}))
    videos = list(briefing.get("videos", []))

    if video_index < 0 or video_index >= len(videos):
        return {"error": f"Video index {video_index} out of range (0-{len(videos)-1})"}

    video = dict(videos[video_index])

    if chosen_title is not None:
        video["chosen_title"] = chosen_title

    if status is not None:
        video["status"] = status

    if youtube_video_id is not None:
        video["youtube_video_id"] = youtube_video_id

    if thumbnail_prompts_ptbr is not None:
        import json as _json
        try:
            video["thumbnail_prompts_ptbr"] = _json.loads(thumbnail_prompts_ptbr)
        except (ValueError, TypeError):
            pass

    # Handle thumbnail upload - store as base64 in JSONB (persists across deploys)
    if thumbnail:
        import base64
        content = await thumbnail.read()
        ext = os.path.splitext(thumbnail.filename)[1] or ".png"
        mime = "image/png" if ext == ".png" else "image/jpeg"
        b64 = base64.b64encode(content).decode("utf-8")
        video["thumbnail_data"] = f"data:{mime};base64,{b64}"
        # Also save to disk as fallback
        os.makedirs(THUMBNAILS_DIR, exist_ok=True)
        filename = f"{uuid.uuid4().hex}{ext}"
        filepath = os.path.join(THUMBNAILS_DIR, filename)
        with open(filepath, "wb") as f:
            f.write(content)
        video["thumbnail_file"] = filename
        logger.info("[YOUTUBE] Thumbnail uploaded: %s (%d bytes, stored in DB)", filename, len(content))

    videos[video_index] = video
    briefing["videos"] = videos
    meta["briefing"] = briefing

    # Update the record - need to create new dict to trigger JSONB change detection
    mem.metadata_ = meta
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(mem, "metadata_")
    await db.flush()

    logger.info("[YOUTUBE] Updated video %d: title=%s, status=%s", video_index, chosen_title, status)
    return {"ok": True, "video": video}


@router.get("/thumbnails/{filename}")
async def serve_thumbnail(filename: str, db: AsyncSession = Depends(get_db)):
    """Serve uploaded thumbnail images (PUBLIC). Falls back to DB if file missing."""
    filepath = os.path.join(THUMBNAILS_DIR, filename)
    if os.path.exists(filepath):
        return FileResponse(filepath)

    # Fallback: reconstruct from base64 in DB (survives container restarts)
    stmt = (
        select(MemoryEmbedding)
        .where(MemoryEmbedding.source_type == "youtube_briefing")
        .order_by(desc(MemoryEmbedding.created_at))
        .limit(5)
    )
    result = await db.execute(stmt)
    for mem in result.scalars().all():
        meta = mem.metadata_ or {}
        for v in meta.get("briefing", {}).get("videos", []):
            if v.get("thumbnail_file") == filename and v.get("thumbnail_data"):
                import base64
                data_str = v["thumbnail_data"]
                # Parse data:mime;base64,DATA
                b64_part = data_str.split(",", 1)[1] if "," in data_str else data_str
                content = base64.b64decode(b64_part)
                # Re-save to disk for next time
                os.makedirs(THUMBNAILS_DIR, exist_ok=True)
                with open(filepath, "wb") as f:
                    f.write(content)
                logger.info("[YOUTUBE] Thumbnail restored from DB: %s", filename)
                return FileResponse(filepath)

    return {"error": "Not found"}


# ─── Analytics ──────────────────────────────────────────────────────

@router.post("/analytics")
async def save_analytics(body: AnalyticsSave, db: AsyncSession = Depends(get_db)):
    """Save a YouTube channel analytics snapshot."""
    content_text = f"YouTube Analytics {body.date}: {body.subscribers} subs, {body.avg_views} avg views, {body.videos_count} videos"

    mem = MemoryEmbedding(
        source_type="youtube_analytics",
        content=content_text,
        summary=f"Analytics {body.date} - {body.subscribers} inscritos, {body.avg_views} media views",
        metadata_={"analytics": body.model_dump()},
        project_name="GuyFolkz",
    )
    db.add(mem)
    await db.flush()
    await db.refresh(mem)
    logger.info("[YOUTUBE] Saved analytics %s: %d subs, %d avg views", body.date, body.subscribers, body.avg_views)
    return {"id": str(mem.id), "date": body.date}


@router.get("/analytics")
async def get_analytics(
    limit: int = Query(30, le=90),
    db: AsyncSession = Depends(get_db),
):
    """Get YouTube analytics history (for charts)."""
    stmt = (
        select(MemoryEmbedding)
        .where(MemoryEmbedding.source_type == "youtube_analytics")
        .order_by(desc(MemoryEmbedding.created_at))
        .limit(limit)
    )
    result = await db.execute(stmt)
    rows = result.scalars().all()
    return [
        (r.metadata_ or {}).get("analytics", {})
        for r in rows
    ]


@router.post("/analyze", response_model=YouTubeAnalyzeResponse)
async def youtube_analyze(
    body: YouTubeAnalyzeRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Analyze YouTube trends and generate content ideas.
    Stores the analysis in vector memory for future reference.
    """
    result = await analyze_channel_trends(
        topics=body.topics,
        sources=body.sources,
    )

    # Store analysis in memory for future context
    video_ideas = result.get("video_ideas", [])
    ideas_summary = "; ".join(
        idea.get("title", "") for idea in video_ideas[:5]
    )

    await store_memory(
        db,
        content=f"YouTube trend analysis: {ideas_summary}",
        source_type="youtube",
        metadata={
            "topics": body.topics,
            "sources": body.sources,
            "video_count": len(video_ideas),
        },
        summary=f"Analise de tendencias: {', '.join(body.topics or ['IA', 'automacao'])}",
    )

    return YouTubeAnalyzeResponse(
        trends=result.get("trends", []),
        video_ideas=result.get("video_ideas", []),
        market_insights=result.get("market_insights", []),
    )


@router.post("/brief")
async def youtube_brief(
    topic: str,
    db: AsyncSession = Depends(get_db),
):
    """Generate a detailed content brief for a specific topic."""
    # Search memory for relevant context
    from app.services.memory import get_context_for_brief

    memory_context = await get_context_for_brief(db, topic, limit=10)

    result = await generate_content_brief(
        topic=topic,
        channel_context=memory_context,
    )

    # Store the brief in memory
    titles = result.get("title_options", [])
    await store_memory(
        db,
        content=f"Content brief for: {topic}. Titles: {'; '.join(titles[:3])}",
        source_type="youtube",
        metadata={"type": "content_brief", "topic": topic},
        summary=f"Briefing de conteudo: {topic}",
    )

    return result


@router.post("/send-brief")
async def youtube_send_brief(
    body: YouTubeSendBriefRequest,
    db: AsyncSession = Depends(get_db),
):
    """Generate trend analysis and send the brief via WhatsApp."""
    # Generate the analysis
    result = await analyze_channel_trends(
        topics=body.topics,
        sources=body.sources,
    )

    # Send via WhatsApp
    sent = await send_content_brief_to_whatsapp(
        phone=body.phone,
        brief=result,
    )

    # Store in memory
    video_ideas = result.get("video_ideas", [])
    ideas_summary = "; ".join(
        idea.get("title", "") for idea in video_ideas[:5]
    )
    await store_memory(
        db,
        content=f"YouTube brief sent to {body.phone}: {ideas_summary}",
        source_type="youtube",
        metadata={
            "type": "sent_brief",
            "phone": body.phone,
            "topics": body.topics,
            "sent_whatsapp": sent,
        },
        summary=f"Briefing enviado via WhatsApp para {body.phone}",
    )

    return {
        "status": "ok" if sent else "error",
        "sent_whatsapp": sent,
        "video_ideas_count": len(video_ideas),
        "trends_count": len(result.get("trends", [])),
    }


@router.get("/oauth/authorize")
async def youtube_oauth_authorize(
    request: Request,
    project_name: str = Query(default=settings.YOUTUBE_PROJECT_NAME),
    db: AsyncSession = Depends(get_db),
):
    resolved_project_name = _resolve_project_name(project_name)
    try:
        project = await get_or_create_project_by_name(db, resolved_project_name)
        client_id, _ = resolve_oauth_client_config(project)
        redirect_uri = _build_redirect_uri(request)
        state = encode_oauth_state(resolved_project_name)
        authorization_url = build_oauth_authorization_url(client_id, redirect_uri, state)
        logger.info("[YOUTUBE] OAuth authorize project=%s", resolved_project_name)
        return RedirectResponse(url=authorization_url, status_code=302)
    except Exception as exc:
        message = str(exc)
        logger.error("[YOUTUBE] OAuth authorize failed for %s: %s", resolved_project_name, message)
        return _error(message, _error_status_code(message))


@router.get("/oauth/callback", name="youtube_oauth_callback")
async def youtube_oauth_callback(
    request: Request,
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
    project_name: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    if error:
        logger.error("[YOUTUBE] OAuth callback error=%s", error)
        return _error(f"Google OAuth error: {error}", 400)
    if not code:
        return _error("Missing OAuth code", 400)
    if not state and not project_name:
        return _error("Missing OAuth state", 400)

    try:
        if state:
            payload = decode_oauth_state(state)
            resolved_project_name = payload.get("project_name") or _resolve_project_name(project_name)
        else:
            resolved_project_name = _resolve_project_name(project_name)

        project = await get_or_create_project_by_name(db, resolved_project_name)
        client_id, client_secret = resolve_oauth_client_config(project)
        redirect_uri = _build_redirect_uri(request)
        token_data = await exchange_oauth_code(client_id, client_secret, code, redirect_uri)

        existing_refresh_token = ((project.credentials or {}).get("youtube") or {}).get("refresh_token")
        refresh_token = token_data.get("refresh_token") or existing_refresh_token
        if not refresh_token:
            raise ValueError(
                "Google OAuth callback did not return refresh_token. "
                "Revoke the app in Google Account permissions and authorize again."
            )

        access_token = token_data["access_token"]
        channel_id = await fetch_current_channel_id(access_token)
        await save_youtube_oauth_credentials(
            db,
            resolved_project_name,
            client_id,
            client_secret,
            refresh_token,
            channel_id,
        )
        await db.commit()

        logger.info(
            "[YOUTUBE] OAuth callback saved credentials project=%s channel_id=%s",
            resolved_project_name,
            channel_id,
        )
        return _ok(
            {
                "project_name": resolved_project_name,
                "channel_id": channel_id,
                "refresh_token_saved": True,
                "scopes": token_data.get("scope", "").split(),
            }
        )
    except Exception as exc:
        await db.rollback()
        message = str(exc)
        logger.error("[YOUTUBE] OAuth callback failed: %s", message)
        return _error(message, _error_status_code(message))


@router.post("/upload")
async def youtube_upload_video(
    file: UploadFile = File(...),
    title: str = Form(...),
    description: str = Form(""),
    tags: str = Form("[]"),
    category_id: str = Form("28"),
    privacy_status: str = Form("private"),
    thumbnail: UploadFile | None = File(default=None),
    project_name: str = Query(default=settings.YOUTUBE_PROJECT_NAME),
    db: AsyncSession = Depends(get_db),
):
    resolved_project_name = _resolve_project_name(project_name)
    video_path: str | None = None
    thumbnail_path: str | None = None

    try:
        access_token, _youtube_credentials = await get_project_access_token(db, resolved_project_name)
        parsed_tags = _parse_tags_field(tags)
        video_path = await _save_upload_to_temp(file, "youtube-upload-")
        if thumbnail:
            thumbnail_path = await _save_upload_to_temp(thumbnail, "youtube-thumbnail-")

        result = await upload_video(
            access_token=access_token,
            file_path=video_path,
            title=title,
            description=description,
            tags=parsed_tags,
            category_id=category_id,
            privacy_status=privacy_status,
            thumbnail_path=thumbnail_path,
        )
        logger.info(
            "[YOUTUBE] Uploaded file to YouTube project=%s video_id=%s",
            resolved_project_name,
            result.get("video_id"),
        )
        return _ok(result)
    except Exception as exc:
        message = str(exc)
        logger.error("[YOUTUBE] Upload failed project=%s: %s", resolved_project_name, message)
        return _error(message, _error_status_code(message))
    finally:
        _cleanup_temp_file(video_path)
        _cleanup_temp_file(thumbnail_path)


@router.post("/upload-url")
async def youtube_upload_video_from_url(
    body: YouTubeUploadUrlRequest,
    project_name: str = Query(default=settings.YOUTUBE_PROJECT_NAME),
    db: AsyncSession = Depends(get_db),
):
    resolved_project_name = _resolve_project_name(project_name or body.project_name)
    video_path: str | None = None
    thumbnail_path: str | None = None

    try:
        access_token, _youtube_credentials = await get_project_access_token(db, resolved_project_name)
        video_path = await _download_url_to_temp(body.source_url, "youtube-url-upload-")
        if body.thumbnail_url:
            thumbnail_path = await _download_url_to_temp(body.thumbnail_url, "youtube-url-thumbnail-")

        result = await upload_video(
            access_token=access_token,
            file_path=video_path,
            title=body.title,
            description=body.description,
            tags=body.tags,
            category_id=body.category_id,
            privacy_status=body.privacy_status,
            thumbnail_path=thumbnail_path,
        )
        logger.info(
            "[YOUTUBE] Uploaded URL to YouTube project=%s video_id=%s",
            resolved_project_name,
            result.get("video_id"),
        )
        return _ok(result)
    except Exception as exc:
        message = str(exc)
        logger.error("[YOUTUBE] Upload-url failed project=%s: %s", resolved_project_name, message)
        return _error(message, _error_status_code(message))
    finally:
        _cleanup_temp_file(video_path)
        _cleanup_temp_file(thumbnail_path)


@router.put("/video/{video_id}")
async def youtube_update_video_metadata(
    video_id: str,
    body: YouTubeVideoUpdate,
    project_name: str = Query(default=settings.YOUTUBE_PROJECT_NAME),
    db: AsyncSession = Depends(get_db),
):
    resolved_project_name = _resolve_project_name(project_name)
    update_payload = body.model_dump(exclude_unset=True)
    if not update_payload:
        return _error("At least one metadata field must be provided", 400)

    try:
        access_token, _youtube_credentials = await get_project_access_token(db, resolved_project_name)
        result = await update_video_metadata(
            access_token=access_token,
            video_id=video_id,
            **update_payload,
        )
        logger.info("[YOUTUBE] Updated metadata video_id=%s project=%s", video_id, resolved_project_name)
        return _ok(result)
    except Exception as exc:
        message = str(exc)
        logger.error("[YOUTUBE] Metadata update failed video_id=%s: %s", video_id, message)
        return _error(message, _error_status_code(message))


@router.post("/video/{video_id}/thumbnail")
async def youtube_set_video_thumbnail(
    video_id: str,
    thumbnail: UploadFile = File(...),
    project_name: str = Query(default=settings.YOUTUBE_PROJECT_NAME),
    db: AsyncSession = Depends(get_db),
):
    resolved_project_name = _resolve_project_name(project_name)
    thumbnail_path: str | None = None

    try:
        access_token, _youtube_credentials = await get_project_access_token(db, resolved_project_name)
        thumbnail_path = await _save_upload_to_temp(thumbnail, "youtube-video-thumbnail-")
        success = await set_thumbnail(access_token, video_id, thumbnail_path)
        logger.info("[YOUTUBE] Thumbnail set video_id=%s project=%s", video_id, resolved_project_name)
        return _ok({"video_id": video_id, "thumbnail_updated": success})
    except Exception as exc:
        message = str(exc)
        logger.error("[YOUTUBE] Thumbnail update failed video_id=%s: %s", video_id, message)
        return _error(message, _error_status_code(message))
    finally:
        _cleanup_temp_file(thumbnail_path)


@router.post("/video/{video_id}/publish")
async def youtube_publish_video(
    video_id: str,
    project_name: str = Query(default=settings.YOUTUBE_PROJECT_NAME),
    db: AsyncSession = Depends(get_db),
):
    resolved_project_name = _resolve_project_name(project_name)
    try:
        access_token, _youtube_credentials = await get_project_access_token(db, resolved_project_name)
        result = await publish_video(access_token, video_id)
        logger.info("[YOUTUBE] Published video_id=%s project=%s", video_id, resolved_project_name)
        return _ok(result)
    except Exception as exc:
        message = str(exc)
        logger.error("[YOUTUBE] Publish failed video_id=%s: %s", video_id, message)
        return _error(message, _error_status_code(message))


@router.post("/video/{video_id}/schedule")
async def youtube_schedule_video(
    video_id: str,
    body: YouTubeScheduleRequest,
    project_name: str = Query(default=settings.YOUTUBE_PROJECT_NAME),
    db: AsyncSession = Depends(get_db),
):
    resolved_project_name = _resolve_project_name(project_name)
    try:
        access_token, _youtube_credentials = await get_project_access_token(db, resolved_project_name)
        result = await schedule_video(access_token, video_id, body.publish_at)
        logger.info("[YOUTUBE] Scheduled video_id=%s project=%s", video_id, resolved_project_name)
        return _ok(result)
    except Exception as exc:
        message = str(exc)
        logger.error("[YOUTUBE] Schedule failed video_id=%s: %s", video_id, message)
        return _error(message, _error_status_code(message))


@router.get("/channel/stats")
async def youtube_channel_stats(
    project_name: str = Query(default=settings.YOUTUBE_PROJECT_NAME),
    db: AsyncSession = Depends(get_db),
):
    resolved_project_name = _resolve_project_name(project_name)
    try:
        access_token, youtube_credentials = await get_project_access_token(db, resolved_project_name)
        channel_id = youtube_credentials.get("channel_id", "")
        stats = await get_channel_stats(access_token, channel_id)
        recent_videos = await list_channel_videos(access_token, channel_id, max_results=10)
        response = YouTubeChannelStats(
            subscribers=stats["subscribers"],
            total_views=stats["total_views"],
            total_videos=stats["total_videos"],
            recent_videos=recent_videos,
        )
        logger.info("[YOUTUBE] Channel stats fetched project=%s", resolved_project_name)
        return _ok(response.model_dump())
    except Exception as exc:
        message = str(exc)
        logger.error("[YOUTUBE] Channel stats failed project=%s: %s", resolved_project_name, message)
        return _error(message, _error_status_code(message))


@router.get("/videos")
async def youtube_list_channel_videos(
    max_results: int = Query(default=20, ge=1, le=50),
    project_name: str = Query(default=settings.YOUTUBE_PROJECT_NAME),
    db: AsyncSession = Depends(get_db),
):
    resolved_project_name = _resolve_project_name(project_name)
    try:
        access_token, youtube_credentials = await get_project_access_token(db, resolved_project_name)
        videos = await list_channel_videos(
            access_token=access_token,
            channel_id=youtube_credentials.get("channel_id", ""),
            max_results=max_results,
        )
        logger.info("[YOUTUBE] Listed %d videos project=%s", len(videos), resolved_project_name)
        return _ok({"items": videos, "total": len(videos)})
    except Exception as exc:
        message = str(exc)
        logger.error("[YOUTUBE] List videos failed project=%s: %s", resolved_project_name, message)
        return _error(message, _error_status_code(message))


@router.get("/video/{video_id}")
async def youtube_get_video(
    video_id: str,
    project_name: str = Query(default=settings.YOUTUBE_PROJECT_NAME),
    db: AsyncSession = Depends(get_db),
):
    resolved_project_name = _resolve_project_name(project_name)
    try:
        access_token, _youtube_credentials = await get_project_access_token(db, resolved_project_name)
        detail = await get_video_detail(access_token, video_id)
        logger.info("[YOUTUBE] Video detail fetched video_id=%s project=%s", video_id, resolved_project_name)
        return _ok(detail)
    except Exception as exc:
        message = str(exc)
        logger.error("[YOUTUBE] Video detail failed video_id=%s: %s", video_id, message)
        return _error(message, _error_status_code(message))
