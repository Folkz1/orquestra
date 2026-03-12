"""
Orquestra - Projects Router
CRUD operations for projects with stats.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.database import get_db
from app.models import Message, Project, Recording
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
    """Build a ProjectResponse with computed stats."""
    # Total messages for this project
    msg_count_stmt = select(func.count(Message.id)).where(
        Message.project_id == project.id
    )
    msg_result = await db.execute(msg_count_stmt)
    total_messages = msg_result.scalar() or 0

    # Total recordings for this project
    rec_count_stmt = select(func.count(Recording.id)).where(
        Recording.project_id == project.id
    )
    rec_result = await db.execute(rec_count_stmt)
    total_recordings = rec_result.scalar() or 0

    # Last activity: most recent message or recording timestamp
    last_msg_stmt = select(func.max(Message.timestamp)).where(
        Message.project_id == project.id
    )
    last_rec_stmt = select(func.max(Recording.recorded_at)).where(
        Recording.project_id == project.id
    )
    last_msg_result = await db.execute(last_msg_stmt)
    last_rec_result = await db.execute(last_rec_stmt)
    last_msg = last_msg_result.scalar()
    last_rec = last_rec_result.scalar()

    last_activity = None
    if last_msg and last_rec:
        last_activity = max(last_msg, last_rec)
    elif last_msg:
        last_activity = last_msg
    elif last_rec:
        last_activity = last_rec

    stats = ProjectStats(
        total_messages=total_messages,
        total_recordings=total_recordings,
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


@router.get("/options", response_model=list[ProjectOptionResponse])
async def list_project_options(
    db: AsyncSession = Depends(get_db),
):
    """List lightweight project options for selectors/dropdowns."""
    stmt = select(Project).order_by(Project.name.asc())
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
    db: AsyncSession = Depends(get_db),
):
    """List all projects with computed stats."""
    stmt = select(Project).order_by(Project.name.asc())
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

    return [await _build_project_response(db, p) for p in projects]


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

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(project, field, value)

    await db.flush()
    await db.refresh(project)

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
