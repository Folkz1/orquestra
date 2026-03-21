"""
Orquestra - Tasks Router
CRUD for project tasks (Kanban board).
"""

import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Project, ProjectTask
from app.schemas import TaskCreate, TaskResponse, TaskUpdate

logger = logging.getLogger(__name__)

router = APIRouter()


def _build_response(task: ProjectTask, project: Project | None = None) -> TaskResponse:
    """Build TaskResponse with project info."""
    return TaskResponse(
        id=task.id,
        project_id=task.project_id,
        project_name=project.name if project else None,
        project_color=project.color if project else None,
        title=task.title,
        description=task.description,
        status=task.status,
        priority=task.priority,
        source=task.source,
        assigned_to=task.assigned_to,
        metadata_json=task.metadata_json or {},
        project_credentials=project.credentials if project else {},
        completed_at=task.completed_at,
        created_at=task.created_at,
        updated_at=task.updated_at,
    )


@router.get("", response_model=list[TaskResponse])
async def list_tasks(
    project_id: UUID | None = Query(None, description="Filter by project"),
    status: str | None = Query(None, description="Filter by status"),
    assigned_to: str | None = Query(None, description="Filter by assignee"),
    limit: int = Query(50, ge=1, le=200, description="Max records to return"),
    offset: int = Query(0, ge=0, description="Number of records to skip"),
    db: AsyncSession = Depends(get_db),
):
    """List tasks with optional filters and pagination."""
    stmt = (
        select(ProjectTask, Project)
        .outerjoin(Project, ProjectTask.project_id == Project.id)
    )

    if project_id:
        stmt = stmt.where(ProjectTask.project_id == project_id)
    if status:
        stmt = stmt.where(ProjectTask.status == status)
    if assigned_to:
        stmt = stmt.where(ProjectTask.assigned_to == assigned_to)

    stmt = stmt.order_by(
        # Priority ordering: high=0, medium=1, low=2
        case(
            (ProjectTask.priority == "high", 0),
            (ProjectTask.priority == "medium", 1),
            else_=2,
        ),
        ProjectTask.created_at.desc(),
    ).offset(offset).limit(limit)

    result = await db.execute(stmt)
    rows = result.all()

    return [_build_response(task, project) for task, project in rows]


@router.post("", response_model=TaskResponse, status_code=201)
async def create_task(
    body: TaskCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create a new task."""
    project = None
    if body.project_id:
        stmt = select(Project).where(Project.id == body.project_id)
        result = await db.execute(stmt)
        project = result.scalar_one_or_none()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

    task = ProjectTask(
        project_id=body.project_id,
        title=body.title,
        description=body.description,
        status=body.status,
        priority=body.priority,
        source=body.source,
        assigned_to=body.assigned_to,
    )
    db.add(task)
    await db.flush()
    await db.refresh(task)

    logger.info("[TASKS] Created task: %s (project=%s)", task.title[:50], project.name if project else "none")

    return _build_response(task, project)


@router.patch("/{task_id}", response_model=TaskResponse)
async def update_task(
    task_id: UUID,
    body: TaskUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a task (used for drag-drop status changes and edits)."""
    stmt = (
        select(ProjectTask, Project)
        .outerjoin(Project, ProjectTask.project_id == Project.id)
        .where(ProjectTask.id == task_id)
    )
    result = await db.execute(stmt)
    row = result.one_or_none()

    if not row:
        raise HTTPException(status_code=404, detail="Task not found")

    task, project = row

    # Apply updates
    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(task, field, value)

    # Auto-set completed_at when moved to done
    if body.status == "done" and not task.completed_at:
        task.completed_at = datetime.now(timezone.utc)
    elif body.status and body.status != "done":
        task.completed_at = None

    # Re-resolve project if changed
    if body.project_id is not None:
        stmt2 = select(Project).where(Project.id == body.project_id)
        result2 = await db.execute(stmt2)
        project = result2.scalar_one_or_none()

    task.updated_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(task)

    logger.info("[TASKS] Updated task %s: status=%s", task.title[:50], task.status)

    return _build_response(task, project)


@router.delete("/{task_id}", status_code=204)
async def delete_task(
    task_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Delete a task."""
    stmt = select(ProjectTask).where(ProjectTask.id == task_id)
    result = await db.execute(stmt)
    task = result.scalar_one_or_none()

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    await db.delete(task)
    logger.info("[TASKS] Deleted task: %s", task.title[:50])


@router.get("/stats", response_model=dict)
async def task_stats(
    db: AsyncSession = Depends(get_db),
):
    """Get task count by status."""
    stmt = (
        select(ProjectTask.status, func.count(ProjectTask.id))
        .group_by(ProjectTask.status)
    )
    result = await db.execute(stmt)
    counts = {status: count for status, count in result.all()}

    return {
        "backlog": counts.get("backlog", 0),
        "in_progress": counts.get("in_progress", 0),
        "review": counts.get("review", 0),
        "done": counts.get("done", 0),
        "total": sum(counts.values()),
    }
