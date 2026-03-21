"""
Orquestra - Projects Router
CRUD operations for projects with stats.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import noload
from sqlalchemy.orm.attributes import flag_modified

from app.database import get_db
from app.models import Contact, Message, Project, Recording
from app.schemas import (
    ProjectCreate,
    ProjectCredentialsUpdate,
    ProjectOptionResponse,
    ProjectResponse,
    ProjectStats,
    ProjectUpdate,
)

logger = logging.getLogger(__name__)

router = APIRouter()


async def _build_project_response(
    db: AsyncSession, project: Project
) -> ProjectResponse:
    """Build a ProjectResponse with computed stats (single project — used on write paths)."""
    # Fetch all stats in two queries instead of four
    msg_stmt = select(
        func.count(Message.id).label("total_messages"),
        func.max(Message.timestamp).label("last_msg"),
    ).where(Message.project_id == project.id)
    rec_stmt = select(
        func.count(Recording.id).label("total_recordings"),
        func.max(Recording.recorded_at).label("last_rec"),
    ).where(Recording.project_id == project.id)

    msg_result = await db.execute(msg_stmt)
    rec_result = await db.execute(rec_stmt)
    msg_row = msg_result.one()
    rec_row = rec_result.one()

    last_msg = msg_row.last_msg
    last_rec = rec_row.last_rec
    last_activity = None
    if last_msg and last_rec:
        last_activity = max(last_msg, last_rec)
    elif last_msg:
        last_activity = last_msg
    elif last_rec:
        last_activity = last_rec

    stats = ProjectStats(
        total_messages=msg_row.total_messages or 0,
        total_recordings=rec_row.total_recordings or 0,
        last_activity=last_activity,
    )

    return ProjectResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        status=project.status,
        color=project.color,
        keywords=project.keywords or [],
        credentials=project.credentials or {},
        created_at=project.created_at,
        updated_at=project.updated_at,
        stats=stats,
    )


async def _fetch_all_project_stats(db: AsyncSession, project_ids: list) -> dict:
    """
    Batch-fetch message and recording stats for multiple projects in two queries.
    Returns a dict: project_id -> ProjectStats.
    """
    if not project_ids:
        return {}

    # One query for all message stats grouped by project
    msg_stmt = (
        select(
            Message.project_id,
            func.count(Message.id).label("total_messages"),
            func.max(Message.timestamp).label("last_msg"),
        )
        .where(Message.project_id.in_(project_ids))
        .group_by(Message.project_id)
    )
    rec_stmt = (
        select(
            Recording.project_id,
            func.count(Recording.id).label("total_recordings"),
            func.max(Recording.recorded_at).label("last_rec"),
        )
        .where(Recording.project_id.in_(project_ids))
        .group_by(Recording.project_id)
    )

    msg_result = await db.execute(msg_stmt)
    rec_result = await db.execute(rec_stmt)

    msg_map = {row.project_id: row for row in msg_result.all()}
    rec_map = {row.project_id: row for row in rec_result.all()}

    stats_map: dict = {}
    for pid in project_ids:
        msg_row = msg_map.get(pid)
        rec_row = rec_map.get(pid)
        total_messages = msg_row.total_messages if msg_row else 0
        total_recordings = rec_row.total_recordings if rec_row else 0
        last_msg = msg_row.last_msg if msg_row else None
        last_rec = rec_row.last_rec if rec_row else None

        last_activity = None
        if last_msg and last_rec:
            last_activity = max(last_msg, last_rec)
        elif last_msg:
            last_activity = last_msg
        elif last_rec:
            last_activity = last_rec

        stats_map[pid] = ProjectStats(
            total_messages=total_messages,
            total_recordings=total_recordings,
            last_activity=last_activity,
        )

    return stats_map


@router.get("/options", response_model=list[ProjectOptionResponse])
async def list_project_options(
    db: AsyncSession = Depends(get_db),
):
    """List lightweight project options for selectors/dropdowns."""
    stmt = (
        select(Project)
        .options(
            noload(Project.contacts),
            noload(Project.messages),
            noload(Project.recordings),
            noload(Project.tasks),
        )
        .order_by(Project.name.asc())
    )
    result = await db.execute(stmt)
    projects = result.scalars().all()
    return [
        ProjectOptionResponse(
            id=project.id,
            name=project.name,
            status=project.status,
            color=project.color,
        )
        for project in projects
    ]


@router.get("", response_model=list[ProjectResponse])
async def list_projects(
    compact: bool = Query(False, description="Return lightweight project data without computed stats"),
    limit: int = Query(50, ge=1, le=200, description="Max records to return"),
    offset: int = Query(0, ge=0, description="Number of records to skip"),
    db: AsyncSession = Depends(get_db),
):
    """List all projects with computed stats."""
    # noload prevents SQLAlchemy from firing selectin queries for Project relationships
    # (contacts, messages, recordings, tasks) — those have lazy="selectin" in the model
    stmt = (
        select(Project)
        .options(
            noload(Project.contacts),
            noload(Project.messages),
            noload(Project.recordings),
            noload(Project.tasks),
        )
        .order_by(Project.name.asc())
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(stmt)
    projects = result.scalars().all()

    if compact:
        return [
            ProjectResponse(
                id=project.id,
                name=project.name,
                description=project.description,
                status=project.status,
                color=project.color,
                keywords=project.keywords or [],
                credentials=project.credentials or {},
                created_at=project.created_at,
                updated_at=project.updated_at,
                stats=ProjectStats(),
            )
            for project in projects
        ]

    # Batch-fetch all stats in 2 queries instead of 4 per project (N+1 fix)
    project_ids = [p.id for p in projects]
    stats_map = await _fetch_all_project_stats(db, project_ids)

    return [
        ProjectResponse(
            id=p.id,
            name=p.name,
            description=p.description,
            status=p.status,
            color=p.color,
            keywords=p.keywords or [],
            credentials=p.credentials or {},
            created_at=p.created_at,
            updated_at=p.updated_at,
            stats=stats_map.get(p.id, ProjectStats()),
        )
        for p in projects
    ]


@router.post("", response_model=ProjectResponse, status_code=201)
async def create_project(
    data: ProjectCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create a new project."""
    project = Project(
        name=data.name,
        description=data.description,
        status=data.status,
        color=data.color,
        keywords=data.keywords,
        credentials=data.credentials,
    )
    db.add(project)
    await db.flush()
    await db.refresh(project)

    logger.info("[PROJECTS] Created project: %s (%s)", project.name, project.id)

    return await _build_project_response(db, project)


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get a single project with stats and credentials."""
    stmt = select(Project).where(Project.id == project_id)
    result = await db.execute(stmt)
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    return await _build_project_response(db, project)


@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: UUID,
    data: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update an existing project."""
    stmt = select(Project).where(Project.id == project_id)
    result = await db.execute(stmt)
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    old_status = project.status
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(project, field, value)

    await db.flush()
    await db.refresh(project)

    # Propagate status to linked contacts
    new_status = project.status
    if "status" in update_data and new_status != old_status:
        contacts_result = await db.execute(
            select(Contact).where(Contact.project_id == project_id)
        )
        contacts = contacts_result.scalars().all()
        if contacts:
            for contact in contacts:
                if new_status in ("deployed", "delivered"):
                    contact.pipeline_stage = "client"
                    contact.next_action = f"Projeto {project.name} entregue"
                elif new_status == "paused":
                    contact.next_action = f"Projeto {project.name} pausado - verificar"
                elif new_status == "cancelled":
                    contact.pipeline_stage = "churned"
                    contact.next_action = f"Projeto {project.name} cancelado"
            await db.flush()
            logger.info(
                "[PROJECTS] Propagated status '%s' to %d contact(s) for project %s",
                new_status, len(contacts), project_id,
            )

    logger.info(
        "[PROJECTS] Updated project %s: %s", project_id, list(update_data.keys())
    )

    return await _build_project_response(db, project)


@router.delete("/{project_id}", status_code=204)
async def delete_project(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Delete a project. Associated messages/recordings have project_id set to NULL (ON DELETE SET NULL)."""
    stmt = select(Project).where(Project.id == project_id)
    result = await db.execute(stmt)
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    await db.delete(project)
    await db.flush()

    logger.info("[PROJECTS] Deleted project %s (%s)", project.name, project_id)


@router.put("/{project_id}/credentials", response_model=ProjectResponse)
async def set_credentials(
    project_id: UUID,
    data: ProjectCredentialsUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Replace all credentials for a project."""
    stmt = select(Project).where(Project.id == project_id)
    result = await db.execute(stmt)
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    project.credentials = data.credentials
    await db.flush()
    await db.refresh(project)

    logger.info("[PROJECTS] Updated credentials for %s (%s)", project.name, project_id)

    return await _build_project_response(db, project)


@router.patch("/{project_id}/credentials", response_model=ProjectResponse)
async def merge_credentials(
    project_id: UUID,
    data: dict,
    db: AsyncSession = Depends(get_db),
):
    """Merge (shallow) new keys into existing credentials. Useful for adding one provider at a time."""
    stmt = select(Project).where(Project.id == project_id)
    result = await db.execute(stmt)
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    current = dict(project.credentials or {})
    current.update(data)
    project.credentials = current
    flag_modified(project, "credentials")
    await db.flush()
    await db.refresh(project)

    logger.info(
        "[PROJECTS] Merged credentials for %s: %s", project.name, list(data.keys())
    )

    return await _build_project_response(db, project)
