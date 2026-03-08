"""Assistant endpoints: draft generation + approval/send."""

from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import AssistantDraft, Contact
from app.schemas import (
    AssistantDraftGenerateRequest,
    AssistantDraftResponse,
)
from app.services.assistant import generate_reply_draft, send_draft

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/drafts/generate", response_model=AssistantDraftResponse)
async def generate_draft(
    payload: AssistantDraftGenerateRequest,
    db: AsyncSession = Depends(get_db),
):
    contact = None
    if payload.contact_id:
        contact = await db.get(Contact, payload.contact_id)
    elif payload.phone:
        stmt = select(Contact).where(Contact.phone == payload.phone)
        contact = (await db.execute(stmt)).scalar_one_or_none()

    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    draft = await generate_reply_draft(db, contact, payload.objective)

    if payload.send_now:
        ok = await send_draft(db, draft)
        if not ok:
            raise HTTPException(status_code=500, detail="Failed to send draft")

    await db.commit()
    await db.refresh(draft)
    return AssistantDraftResponse.model_validate(draft)


@router.get("/drafts", response_model=list[AssistantDraftResponse])
async def list_drafts(
    status: str | None = Query(None, description="generated|sent|discarded"),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(AssistantDraft).order_by(desc(AssistantDraft.created_at)).limit(limit)
    if status:
        stmt = stmt.where(AssistantDraft.status == status)
    rows = (await db.execute(stmt)).scalars().all()
    return [AssistantDraftResponse.model_validate(x) for x in rows]


@router.post("/drafts/{draft_id}/send", response_model=AssistantDraftResponse)
async def send_draft_endpoint(
    draft_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    draft = await db.get(AssistantDraft, draft_id)
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")

    ok = await send_draft(db, draft)
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to send draft")

    await db.commit()
    await db.refresh(draft)
    return AssistantDraftResponse.model_validate(draft)
