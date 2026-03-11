"""
Orquestra - Scheduled Messages Router
CRUD for scheduling WhatsApp messages to be sent at specific times.
"""

import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import ScheduledMessage
from app.schemas import (
    ScheduledMessageCreate,
    ScheduledMessageResponse,
    ScheduledMessageUpdate,
)

logger = logging.getLogger(__name__)
router = APIRouter()


def _to_response(msg: ScheduledMessage) -> ScheduledMessageResponse:
    return ScheduledMessageResponse(
        id=msg.id,
        phone=msg.phone,
        message_text=msg.message_text,
        scheduled_for=msg.scheduled_for,
        status=msg.status,
        error_message=msg.error_message,
        evolution_instance=msg.evolution_instance,
        contact_id=msg.contact_id,
        project_id=msg.project_id,
        metadata_json=msg.metadata_json or {},
        sent_at=msg.sent_at,
        created_at=msg.created_at,
        updated_at=msg.updated_at,
        contact_name=msg.contact.name if msg.contact else None,
    )


@router.get("", response_model=list[ScheduledMessageResponse])
async def list_scheduled_messages(
    status: str | None = Query(None, description="Filter by status: pending, sent, failed, cancelled"),
    phone: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(ScheduledMessage).order_by(ScheduledMessage.scheduled_for.asc())
    if status:
        stmt = stmt.where(ScheduledMessage.status == status)
    if phone:
        stmt = stmt.where(ScheduledMessage.phone == phone)
    stmt = stmt.limit(limit)
    result = await db.execute(stmt)
    messages = result.scalars().all()
    return [_to_response(m) for m in messages]


@router.post("", response_model=ScheduledMessageResponse, status_code=201)
async def create_scheduled_message(
    data: ScheduledMessageCreate,
    db: AsyncSession = Depends(get_db),
):
    msg = ScheduledMessage(
        phone=data.phone,
        message_text=data.message_text,
        scheduled_for=data.scheduled_for,
        evolution_instance=data.evolution_instance,
        contact_id=data.contact_id,
        project_id=data.project_id,
        metadata_json=data.metadata_json,
    )
    db.add(msg)
    await db.flush()
    await db.refresh(msg)
    logger.info("[SCHEDULED_MESSAGES] Created: %s for %s at %s", msg.id, msg.phone, msg.scheduled_for)
    return _to_response(msg)


@router.get("/{message_id}", response_model=ScheduledMessageResponse)
async def get_scheduled_message(
    message_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(ScheduledMessage).where(ScheduledMessage.id == message_id)
    result = await db.execute(stmt)
    msg = result.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=404, detail="Scheduled message not found")
    return _to_response(msg)


@router.patch("/{message_id}", response_model=ScheduledMessageResponse)
async def update_scheduled_message(
    message_id: UUID,
    data: ScheduledMessageUpdate,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(ScheduledMessage).where(ScheduledMessage.id == message_id)
    result = await db.execute(stmt)
    msg = result.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=404, detail="Scheduled message not found")

    if msg.status in ("sent", "failed"):
        raise HTTPException(status_code=400, detail="Cannot update a message that was already sent or failed")

    if data.message_text is not None:
        msg.message_text = data.message_text
    if data.scheduled_for is not None:
        msg.scheduled_for = data.scheduled_for
    if data.status is not None:
        msg.status = data.status
    if data.evolution_instance is not None:
        msg.evolution_instance = data.evolution_instance
    if data.metadata_json is not None:
        msg.metadata_json = data.metadata_json

    msg.updated_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(msg)
    logger.info("[SCHEDULED_MESSAGES] Updated: %s", msg.id)
    return _to_response(msg)


@router.delete("/{message_id}", status_code=204)
async def delete_scheduled_message(
    message_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(ScheduledMessage).where(ScheduledMessage.id == message_id)
    result = await db.execute(stmt)
    msg = result.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=404, detail="Scheduled message not found")

    if msg.status == "sent":
        raise HTTPException(status_code=400, detail="Cannot delete a sent message")

    await db.delete(msg)
    await db.flush()
    logger.info("[SCHEDULED_MESSAGES] Deleted: %s", message_id)
