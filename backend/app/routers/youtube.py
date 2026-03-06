"""
Orquestra - YouTube Router
Trend analysis, content briefs, and channel analytics for GuyFolkz.
"""

import logging
import os
import uuid
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import MemoryEmbedding
from app.schemas import YouTubeAnalyzeRequest, YouTubeAnalyzeResponse, YouTubeSendBriefRequest
from app.services.youtube import analyze_channel_trends, generate_content_brief
from app.services.whatsapp import send_content_brief_to_whatsapp
from app.services.memory import store_memory

logger = logging.getLogger(__name__)

router = APIRouter()

THUMBNAILS_DIR = os.path.join(settings.UPLOAD_DIR, "thumbnails")


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
