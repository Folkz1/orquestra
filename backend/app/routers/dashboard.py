"""
Dashboard Router - Agent Status Board + Chart Endpoints

Provides:
  - POST /agents/heartbeat  — receive status from remote daemons
  - GET  /agents             — list all agent statuses
  - GET  /charts/mrr         — MRR trend (last 12 months)
  - GET  /charts/tasks       — task velocity (last 8 weeks)
  - GET  /charts/messages    — message volume (last 30 days)
"""

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Contact, Message, ProjectTask, SubscriptionPayment
from app.schemas import AgentHeartbeatReport, AgentStatusResponse

router = APIRouter()

# ─── In-Memory Agent State Store ──────────────────────────────────────────
# Ephemeral — resets on restart, daemons re-report within one cycle.

_agent_states: dict[str, dict[str, Any]] = {}

# Known scheduled jobs and their current status (paused or not)
_KNOWN_JOBS = {
    "Scheduled Sender": {"id": "scheduled_messages", "active": True},
    "Subscription Alerts": {"id": "subscription_alerts", "active": True},
    "Daily Brief": {"id": "daily_brief", "active": False},
    "YouTube Daily": {"id": "youtube_analysis", "active": False},
    "Proactive Bot": {"id": "proactive_bot", "active": False},
}


# ─── Agent Endpoints ──────────────────────────────────────────────────────


@router.post("/agents/heartbeat")
async def receive_heartbeat(report: AgentHeartbeatReport):
    """Receive status report from a remote daemon (heartbeat, autoresearch, etc)."""
    _agent_states[report.agent_name] = {
        "name": report.agent_name,
        "status": report.status,
        "last_execution": report.last_execution.isoformat() if report.last_execution else None,
        "tasks_completed_today": report.tasks_completed_today,
        "metadata": report.metadata,
        "received_at": datetime.now(timezone.utc).isoformat(),
    }
    return {"ok": True}


@router.get("/agents", response_model=list[AgentStatusResponse])
async def get_agent_statuses():
    """Return all known agent statuses — remote daemons + scheduler jobs."""
    agents: list[dict] = []
    now = datetime.now(timezone.utc)

    # Remote daemons (heartbeat, autoresearch, etc)
    for name, state in _agent_states.items():
        received = state.get("received_at")
        status = state.get("status", "idle")

        # Auto-degrade status based on staleness
        if received:
            age_min = (now - datetime.fromisoformat(received)).total_seconds() / 60
            if age_min > 180:
                status = "error"
            elif age_min > 45:
                status = "idle"

        agents.append(AgentStatusResponse(
            name=name,
            status=status,
            last_execution=state.get("last_execution"),
            tasks_completed_today=state.get("tasks_completed_today", 0),
            metadata=state.get("metadata", {}),
        ))

    # APScheduler jobs
    try:
        from app.tasks.daily_brief import scheduler
        running_jobs = {job.id: job for job in scheduler.get_jobs()}
    except Exception:
        running_jobs = {}

    for label, info in _KNOWN_JOBS.items():
        job = running_jobs.get(info["id"])
        if job:
            agents.append(AgentStatusResponse(
                name=label,
                status="active",
                next_run=job.next_run_time,
            ))
        else:
            agents.append(AgentStatusResponse(
                name=label,
                status="paused" if not info["active"] else "idle",
            ))

    return agents


# ─── Chart Endpoints ──────────────────────────────────────────────────────


@router.get("/charts/mrr")
async def chart_mrr(db: AsyncSession = Depends(get_db)):
    """MRR trend — monthly paid revenue from subscriptions (last 12 months)."""
    stmt = (
        select(
            SubscriptionPayment.reference_month,
            func.sum(SubscriptionPayment.amount_cents).label("total"),
        )
        .where(SubscriptionPayment.status == "paid")
        .group_by(SubscriptionPayment.reference_month)
        .order_by(SubscriptionPayment.reference_month.desc())
        .limit(12)
    )
    rows = (await db.execute(stmt)).all()
    months = [
        {
            "month": row.reference_month,
            "amount_cents": row.total or 0,
            "amount_brl": (row.total or 0) / 100,
        }
        for row in reversed(rows)
    ]
    return {"months": months}


@router.get("/charts/tasks")
async def chart_tasks(db: AsyncSession = Depends(get_db)):
    """Task velocity — completed tasks per week (last 8 weeks)."""
    eight_weeks_ago = datetime.now(timezone.utc) - timedelta(weeks=8)
    stmt = (
        select(
            func.date_trunc("week", ProjectTask.completed_at).label("week_start"),
            func.count(ProjectTask.id).label("completed"),
        )
        .where(ProjectTask.completed_at >= eight_weeks_ago)
        .group_by("week_start")
        .order_by("week_start")
    )
    rows = (await db.execute(stmt)).all()
    weeks = [
        {
            "week_start": row.week_start.strftime("%Y-%m-%d") if row.week_start else "",
            "completed": row.completed,
        }
        for row in rows
    ]
    return {"weeks": weeks}


@router.get("/charts/messages")
async def chart_messages(db: AsyncSession = Depends(get_db)):
    """Message volume — daily message count with direction split (last 30 days)."""
    thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)
    stmt = (
        select(
            func.date_trunc("day", Message.timestamp).label("day"),
            func.count(Message.id).label("total"),
            func.sum(
                case((Message.direction == "incoming", 1), else_=0)
            ).label("incoming"),
            func.sum(
                case((Message.direction == "outgoing", 1), else_=0)
            ).label("outgoing"),
        )
        .where(Message.timestamp >= thirty_days_ago)
        .group_by("day")
        .order_by("day")
    )
    rows = (await db.execute(stmt)).all()
    days = [
        {
            "date": row.day.strftime("%Y-%m-%d") if row.day else "",
            "count": row.total,
            "incoming": row.incoming or 0,
            "outgoing": row.outgoing or 0,
        }
        for row in rows
    ]
    return {"days": days}


# ─── Voice Agent Proxy Endpoints ──────────────────────────────────────────
# ElevenLabs webhook tools can't do path params, only query params.
# These endpoints proxy to existing APIs using query params.


@router.get("/voice/conversation")
async def voice_read_conversation(
    contact_id: str = "",
    limit: int = 30,
    db: AsyncSession = Depends(get_db),
):
    """Read full conversation for a contact — proxy for ElevenLabs voice agent."""
    if not contact_id:
        return {"error": "contact_id required"}

    from uuid import UUID
    try:
        cid = UUID(contact_id)
    except ValueError:
        return {"error": "invalid contact_id format"}

    stmt = (
        select(Message)
        .where(Message.contact_id == cid)
        .order_by(Message.timestamp.desc())
        .limit(limit)
    )
    rows = (await db.execute(stmt)).scalars().all()

    messages = []
    for m in reversed(rows):
        msg = {
            "direction": m.direction,
            "type": m.message_type,
            "content": m.content or "",
            "timestamp": m.timestamp.isoformat() if m.timestamp else "",
        }
        if m.transcription:
            msg["transcription"] = m.transcription
        messages.append(msg)

    # Get contact name
    contact = (await db.execute(select(Contact).where(Contact.id == cid))).scalar_one_or_none()
    contact_name = contact.name or contact.push_name if contact else "Desconhecido"

    return {
        "contact_name": contact_name,
        "contact_id": contact_id,
        "total_messages": len(messages),
        "messages": messages,
    }
