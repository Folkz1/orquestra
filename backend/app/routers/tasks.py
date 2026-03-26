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
from app.schemas import (
    AutoResearchApplyResultRequest,
    AutoResearchDecisionRequest,
    TaskCreate,
    TaskResponse,
    TaskUpdate,
)

logger = logging.getLogger(__name__)

router = APIRouter()
AUTORESEARCH_KIND = "autoresearch_suggestion"
AUTORESEARCH_DECISION_ORDER = {
    "needs_client_confirmation": 0,
    "pending": 1,
    "approved": 2,
    "rejected": 3,
}


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


def _task_metadata(task: ProjectTask) -> dict:
    return dict(task.metadata_json or {})


def _is_autoresearch_task(task: ProjectTask) -> bool:
    return _task_metadata(task).get("kind") == AUTORESEARCH_KIND


def _merge_task_metadata(task: ProjectTask, updates: dict) -> dict:
    merged = _task_metadata(task)
    merged.update(updates)
    task.metadata_json = merged
    return merged


def _autoresearch_sort_key(task: ProjectTask) -> tuple:
    meta = _task_metadata(task)
    decision = meta.get("decision_status", "pending")
    apply_status = meta.get("apply_status", "pending")
    apply_weight = 0 if apply_status == "apply_failed" else 1
    created_ts = task.created_at.timestamp() if task.created_at else 0
    return (
        AUTORESEARCH_DECISION_ORDER.get(decision, 99),
        apply_weight,
        -created_ts,
    )


@router.get("", response_model=list[TaskResponse])
async def list_tasks(
    project_id: UUID | None = Query(None, description="Filter by project"),
    status: str | None = Query(None, description="Filter by status"),
    assigned_to: str | None = Query(None, description="Filter by assignee"),
    kind: str | None = Query(None, description="Filter by metadata_json.kind"),
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
    if kind:
        stmt = stmt.where(ProjectTask.metadata_json["kind"].astext == kind)

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
        metadata_json=body.metadata_json,
    )
    db.add(task)
    await db.flush()
    await db.refresh(task)

    logger.info("[TASKS] Created task: %s (project=%s)", task.title[:50], project.name if project else "none")

    return _build_response(task, project)


@router.get("/autoresearch", response_model=list[TaskResponse])
async def list_autoresearch_tasks(
    decision: str | None = Query(
        None,
        pattern="^(pending|approved|rejected|needs_client_confirmation)$",
        description="Filter by decision status",
    ),
    target: str | None = Query(None, description="Filter by AutoResearch target"),
    apply_status: str | None = Query(None, description="Filter by apply status"),
    requires_client_confirmation: bool | None = Query(
        None,
        description="Filter tasks that still need client confirmation",
    ),
    limit: int = Query(200, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(ProjectTask, Project)
        .outerjoin(Project, ProjectTask.project_id == Project.id)
        .where(ProjectTask.metadata_json["kind"].astext == AUTORESEARCH_KIND)
        .order_by(ProjectTask.created_at.desc())
    )
    result = await db.execute(stmt)
    rows = result.all()

    filtered: list[tuple[ProjectTask, Project | None]] = []
    for task, project in rows:
        meta = _task_metadata(task)
        if decision and meta.get("decision_status", "pending") != decision:
            continue
        if target and meta.get("target") != target:
            continue
        if apply_status and meta.get("apply_status", "pending") != apply_status:
            continue
        if requires_client_confirmation is not None:
            if bool(meta.get("client_confirmation_required")) != requires_client_confirmation:
                continue
        filtered.append((task, project))

    filtered.sort(key=lambda row: _autoresearch_sort_key(row[0]))
    return [_build_response(task, project) for task, project in filtered[:limit]]


@router.get("/autoresearch/apply-queue", response_model=list[TaskResponse])
async def list_autoresearch_apply_queue(
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(ProjectTask, Project)
        .outerjoin(Project, ProjectTask.project_id == Project.id)
        .where(ProjectTask.metadata_json["kind"].astext == AUTORESEARCH_KIND)
        .order_by(ProjectTask.created_at.asc())
    )
    result = await db.execute(stmt)
    rows = result.all()

    queue: list[tuple[ProjectTask, Project | None]] = []
    for task, project in rows:
        meta = _task_metadata(task)
        if meta.get("decision_status") != "approved":
            continue
        if meta.get("apply_status", "pending") not in {"pending", "queued"}:
            continue
        if meta.get("client_confirmation_required") and meta.get("client_confirmation_status") != "confirmed":
            continue
        queue.append((task, project))

    queue.sort(key=lambda row: row[0].created_at)
    return [_build_response(task, project) for task, project in queue[:limit]]


@router.post("/{task_id}/autoresearch/decision", response_model=TaskResponse)
async def decide_autoresearch_task(
    task_id: UUID,
    body: AutoResearchDecisionRequest,
    db: AsyncSession = Depends(get_db),
):
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
    if not _is_autoresearch_task(task):
        raise HTTPException(status_code=400, detail="Task is not an AutoResearch suggestion")

    current_meta = _task_metadata(task)
    client_confirmation_status = body.client_confirmation_status
    if client_confirmation_status is None:
        if body.decision == "needs_client_confirmation":
            client_confirmation_status = "pending"
        elif current_meta.get("client_confirmation_required"):
            client_confirmation_status = current_meta.get("client_confirmation_status", "pending")
        else:
            client_confirmation_status = "not_needed"

    apply_status = current_meta.get("apply_status", "pending")
    if body.decision == "approved" and apply_status != "applied":
        apply_status = "queued"
    elif body.decision == "rejected":
        apply_status = "cancelled"
    elif body.decision in {"pending", "needs_client_confirmation"}:
        apply_status = "pending"

    _merge_task_metadata(
        task,
        {
            "decision_status": body.decision,
            "decision_note": body.note,
            "decision_at": datetime.now(timezone.utc).isoformat(),
            "approval_checklist": body.approval_checklist
            if body.approval_checklist is not None
            else current_meta.get("approval_checklist", []),
            "client_checklist": body.client_checklist
            if body.client_checklist is not None
            else current_meta.get("client_checklist", []),
            "client_confirmation_status": client_confirmation_status,
            "apply_status": apply_status,
        },
    )

    if body.decision == "rejected":
        task.status = "done"
        task.completed_at = datetime.now(timezone.utc)
    else:
        task.status = "review"
        task.completed_at = None

    task.updated_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(task)

    logger.info("[TASKS] AutoResearch decision %s on %s", body.decision, task.title[:50])
    return _build_response(task, project)


@router.post("/{task_id}/autoresearch/apply-result", response_model=TaskResponse)
async def report_autoresearch_apply_result(
    task_id: UUID,
    body: AutoResearchApplyResultRequest,
    db: AsyncSession = Depends(get_db),
):
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
    if not _is_autoresearch_task(task):
        raise HTTPException(status_code=400, detail="Task is not an AutoResearch suggestion")

    now = datetime.now(timezone.utc)
    meta = _task_metadata(task)
    payload = {
        "apply_status": body.apply_status,
        "apply_note": body.note,
        "apply_error": body.error,
        "applied_files": body.applied_files,
        "last_apply_attempt_at": now.isoformat(),
    }
    if body.apply_status == "applied":
        payload["applied_at"] = now.isoformat()
        task.status = "done"
        task.completed_at = now
    else:
        payload["applied_at"] = meta.get("applied_at")
        task.status = "review"
        task.completed_at = None

    _merge_task_metadata(task, payload)

    task.updated_at = now
    await db.flush()
    await db.refresh(task)

    logger.info("[TASKS] AutoResearch apply result %s on %s", body.apply_status, task.title[:50])
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
