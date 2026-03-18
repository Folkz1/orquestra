"""
Orquestra - Recordings Router
Upload, list, and retrieve recording details.
"""

import logging
import math
import os
import uuid
from datetime import datetime

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
)
from sqlalchemy import func, or_, select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.database import async_session, get_db
from app.models import Project, Recording
from app.schemas import PaginatedResponse, RecordingResponse
from app.services.llm import generate_meeting_summary
from app.services.memory import store_memory
from app.services.transcriber import transcribe_audio

logger = logging.getLogger(__name__)

router = APIRouter()


def _recording_to_response(recording: Recording) -> RecordingResponse:
    """Convert Recording ORM to response, resolving project_name."""
    resp = RecordingResponse.model_validate(recording)
    if recording.project_id and hasattr(recording, "project") and recording.project:
        resp.project_name = recording.project.name
    return resp


async def process_recording(recording_id: str):
    """
    Background task: transcribe audio and generate summary for a recording.
    Uses its own database session since this runs outside the request lifecycle.
    """
    async with async_session() as db:
        try:
            stmt = select(Recording).where(Recording.id == recording_id)
            result = await db.execute(stmt)
            recording = result.scalar_one_or_none()

            if not recording:
                logger.error("[RECORDINGS] Recording %s not found", recording_id)
                return

            # Transcribe
            try:
                transcription = await transcribe_audio(recording.file_path)
                recording.transcription = transcription
                logger.info("[RECORDINGS] Transcribed recording %s", recording_id)
            except Exception as exc:
                logger.error(
                    "[RECORDINGS] Transcription failed for %s: %s", recording_id, exc
                )
                recording.transcription = f"[Transcription error: {str(exc)[:200]}]"

            # Generate summary if transcription succeeded
            if recording.transcription and not recording.transcription.startswith(
                "[Transcription error"
            ):
                try:
                    # Fetch known project names for auto-detection
                    proj_stmt = select(Project.id, Project.name).where(Project.status == "active")
                    proj_result = await db.execute(proj_stmt)
                    projects_map = {row.name: row.id for row in proj_result.all()}
                    known_projects = list(projects_map.keys())

                    summary_data = await generate_meeting_summary(
                        recording.transcription, known_projects=known_projects
                    )
                    recording.title = recording.title or summary_data.get("title", "")
                    recording.summary = summary_data.get("summary", "")
                    recording.action_items = summary_data.get("action_items", [])
                    recording.decisions = summary_data.get("decisions", [])
                    recording.key_topics = summary_data.get("key_topics", [])

                    # Auto-associate project if detected and not already set
                    detected = summary_data.get("detected_project")
                    if detected and not recording.project_id:
                        for pname, pid in projects_map.items():
                            if pname.lower() == detected.lower() or detected.lower() in pname.lower():
                                recording.project_id = pid
                                logger.info("[RECORDINGS] Auto-detected project: %s -> %s", detected, pname)
                                break

                    logger.info("[RECORDINGS] Summary generated for %s", recording_id)
                except Exception as exc:
                    logger.error(
                        "[RECORDINGS] Summary generation failed for %s: %s",
                        recording_id,
                        exc,
                    )

            recording.processed = True

            # Store transcription in vector memory
            if recording.transcription and not recording.transcription.startswith(
                "[Transcription error"
            ):
                try:
                    memory_content = recording.transcription
                    if recording.summary:
                        memory_content = f"{recording.summary}\n\n{recording.transcription}"

                    # Resolve project name for memory storage
                    resolved_project_name = None
                    if recording.project_id:
                        for pname, pid in projects_map.items():
                            if pid == recording.project_id:
                                resolved_project_name = pname
                                break

                    await store_memory(
                        db,
                        content=memory_content,
                        source_type="recording",
                        source_id=str(recording.id),
                        project_name=resolved_project_name,
                        metadata={
                            "title": recording.title or "",
                            "key_topics": recording.key_topics or [],
                            "duration_seconds": recording.duration_seconds,
                        },
                        summary=recording.summary,
                    )
                    logger.info("[RECORDINGS] Stored recording in vector memory: %s", recording_id)
                except Exception as exc:
                    logger.error(
                        "[RECORDINGS] Failed to store recording memory for %s: %s",
                        recording_id,
                        exc,
                    )

            await db.commit()
            logger.info("[RECORDINGS] Processing complete for %s", recording_id)

        except Exception as exc:
            logger.error(
                "[RECORDINGS] Processing failed for %s: %s", recording_id, exc
            )
            await db.rollback()


@router.post("/upload", response_model=RecordingResponse)
async def upload_recording(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    title: str | None = Form(None),
    project_id: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload a recording file (audio).
    Saves the file, creates a Recording record, and starts background transcription.
    """
    # Validate file size
    max_bytes = settings.MAX_AUDIO_SIZE_MB * 1024 * 1024
    content = await file.read()
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size: {settings.MAX_AUDIO_SIZE_MB}MB",
        )

    # Save file to disk
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    file_ext = os.path.splitext(file.filename or "recording.ogg")[1] or ".ogg"
    filename = f"recording_{uuid.uuid4().hex}{file_ext}"
    file_path = os.path.join(settings.UPLOAD_DIR, filename)

    with open(file_path, "wb") as f:
        f.write(content)

    # Parse project_id if provided
    parsed_project_id = None
    if project_id:
        try:
            parsed_project_id = uuid.UUID(project_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid project_id format")

    # Create recording
    recording = Recording(
        title=title,
        source="pwa",
        file_path=file_path,
        file_size_bytes=len(content),
        project_id=parsed_project_id,
        processed=False,
    )
    db.add(recording)
    await db.flush()
    await db.refresh(recording)

    logger.info(
        "[RECORDINGS] Uploaded recording %s (%d bytes)", recording.id, len(content)
    )

    # Schedule background transcription + summary
    background_tasks.add_task(process_recording, str(recording.id))

    return RecordingResponse.model_validate(recording)


@router.get("", response_model=PaginatedResponse[RecordingResponse])
async def list_recordings(
    project_id: str | None = Query(None, description="Filter by project ID"),
    date_from: datetime | None = Query(None, description="Start date filter"),
    date_to: datetime | None = Query(None, description="End date filter"),
    search: str | None = Query(
        None, description="Search in title, transcription, or summary"
    ),
    page: int = Query(1, ge=1, description="Page number"),
    per_page: int = Query(50, ge=1, le=200, description="Items per page"),
    db: AsyncSession = Depends(get_db),
):
    """List recordings with filters and pagination."""
    stmt = select(Recording).options(selectinload(Recording.project))
    count_stmt = select(func.count(Recording.id))

    filters = []

    if project_id:
        try:
            pid = uuid.UUID(project_id)
            filters.append(Recording.project_id == pid)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid project_id format")

    if date_from is not None:
        filters.append(Recording.recorded_at >= date_from)

    if date_to is not None:
        filters.append(Recording.recorded_at <= date_to)

    if search:
        search_pattern = f"%{search}%"
        filters.append(
            or_(
                Recording.title.ilike(search_pattern),
                Recording.transcription.ilike(search_pattern),
                Recording.summary.ilike(search_pattern),
            )
        )

    if filters:
        stmt = stmt.where(and_(*filters))
        count_stmt = count_stmt.where(and_(*filters))

    # Count
    total_result = await db.execute(count_stmt)
    total = total_result.scalar() or 0

    # Paginate
    offset = (page - 1) * per_page
    stmt = stmt.order_by(Recording.recorded_at.desc()).offset(offset).limit(per_page)

    result = await db.execute(stmt)
    recordings = result.scalars().all()

    total_pages = math.ceil(total / per_page) if total > 0 else 0

    return PaginatedResponse(
        items=[_recording_to_response(rec) for rec in recordings],
        total=total,
        page=page,
        page_size=per_page,
        total_pages=total_pages,
    )


@router.get("/{recording_id}", response_model=RecordingResponse)
async def get_recording(
    recording_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get full details of a single recording."""
    stmt = select(Recording).options(selectinload(Recording.project)).where(Recording.id == recording_id)
    result = await db.execute(stmt)
    recording = result.scalar_one_or_none()

    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")

    return _recording_to_response(recording)


@router.patch("/{recording_id}", response_model=RecordingResponse)
async def update_recording(
    recording_id: uuid.UUID,
    body: dict,
    db: AsyncSession = Depends(get_db),
):
    """Update recording fields (project_id, title, etc.)."""
    stmt = select(Recording).options(selectinload(Recording.project)).where(Recording.id == recording_id)
    result = await db.execute(stmt)
    recording = result.scalar_one_or_none()

    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")

    allowed = {"project_id", "title", "transcription", "summary", "action_items", "decisions", "key_topics", "processed", "duration_seconds"}
    for key, value in body.items():
        if key in allowed:
            if key == "project_id" and value:
                value = uuid.UUID(value)
            setattr(recording, key, value)

    await db.commit()
    await db.refresh(recording, attribute_names=["project"])
    return _recording_to_response(recording)


@router.post("/{recording_id}/inject", response_model=RecordingResponse)
async def inject_transcription(
    recording_id: uuid.UUID,
    body: dict,
    db: AsyncSession = Depends(get_db),
):
    """Admin: inject transcription, summary, action_items directly (bypasses transcription pipeline)."""
    stmt = select(Recording).options(selectinload(Recording.project)).where(Recording.id == recording_id)
    result = await db.execute(stmt)
    recording = result.scalar_one_or_none()
    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")

    for key in ("transcription", "summary", "action_items", "decisions", "key_topics", "processed", "duration_seconds", "title"):
        if key in body:
            setattr(recording, key, body[key])

    await db.commit()
    await db.refresh(recording, attribute_names=["project"])
    return _recording_to_response(recording)


@router.post("/{recording_id}/reprocess", response_model=RecordingResponse)
async def reprocess_recording(
    recording_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Re-process a recording (re-transcribe and re-summarize)."""
    stmt = select(Recording).where(Recording.id == recording_id)
    result = await db.execute(stmt)
    recording = result.scalar_one_or_none()

    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")

    recording.processed = False
    recording.transcription = None
    recording.summary = None
    await db.commit()

    background_tasks.add_task(process_recording, str(recording.id))

    logger.info("[RECORDINGS] Reprocessing recording %s", recording_id)
    return RecordingResponse.model_validate(recording)
