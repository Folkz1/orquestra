"""
Orquestra - Proposals Router
CRUD for commercial proposals + public view by slug + analytics tracking.
"""

import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select, func, distinct
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Contact, Proposal, ProposalComment, ProposalEvent
from app.schemas import (
    ProposalAnalyticsSummary,
    ProposalCommentCreate,
    ProposalCommentResponse,
    ProposalCreate,
    ProposalEventCreate,
    ProposalEventResponse,
    ProposalPublicResponse,
    ProposalResponse,
    ProposalUpdate,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("", response_model=list[ProposalResponse])
async def list_proposals(
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """List all proposals, optionally filtered by status."""
    stmt = select(Proposal).order_by(Proposal.created_at.desc())
    if status:
        stmt = stmt.where(Proposal.status == status)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("", response_model=ProposalResponse, status_code=201)
async def create_proposal(
    data: ProposalCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create a new proposal."""
    # Check slug uniqueness
    existing = await db.execute(select(Proposal).where(Proposal.slug == data.slug))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Slug '{data.slug}' already exists")

    # Auto-match contact by phone if contact_id not provided
    contact_id = data.contact_id
    if not contact_id and data.client_phone:
        phone_clean = data.client_phone.replace("+", "").replace(" ", "").replace("-", "")
        stmt_contact = select(Contact).where(Contact.phone.contains(phone_clean[-10:]))
        contact_result = await db.execute(stmt_contact)
        contact = contact_result.scalar_one_or_none()
        if contact:
            contact_id = contact.id
            logger.info("[PROPOSALS] Auto-matched contact %s for phone %s", contact.id, data.client_phone)

    proposal = Proposal(
        slug=data.slug,
        title=data.title,
        client_name=data.client_name,
        client_phone=data.client_phone,
        contact_id=contact_id,
        content=data.content,
        status=data.status,
        total_value=data.total_value,
        metadata_json=data.metadata_json,
    )
    db.add(proposal)
    await db.flush()
    await db.refresh(proposal)

    logger.info("[PROPOSALS] Created: %s (%s)", proposal.slug, proposal.id)
    return proposal


@router.get("/public/{slug}", response_model=ProposalPublicResponse)
async def get_proposal_public(
    slug: str,
    db: AsyncSession = Depends(get_db),
):
    """Public endpoint - view proposal by slug. Marks as viewed."""
    stmt = select(Proposal).where(Proposal.slug == slug)
    result = await db.execute(stmt)
    proposal = result.scalar_one_or_none()

    if not proposal:
        raise HTTPException(status_code=404, detail="Proposta nao encontrada")

    # Mark as viewed on first access
    if not proposal.viewed_at:
        proposal.viewed_at = datetime.now(timezone.utc)
        if proposal.status == "sent":
            proposal.status = "viewed"
        await db.flush()
        await db.refresh(proposal)
        logger.info("[PROPOSALS] Viewed: %s", proposal.slug)

    return proposal


@router.post("/public/{slug}/comments", response_model=ProposalCommentResponse, status_code=201)
async def add_comment(
    slug: str,
    data: ProposalCommentCreate,
    db: AsyncSession = Depends(get_db),
):
    """Public endpoint - add a comment to a proposal."""
    stmt = select(Proposal).where(Proposal.slug == slug)
    result = await db.execute(stmt)
    proposal = result.scalar_one_or_none()

    if not proposal:
        raise HTTPException(status_code=404, detail="Proposta nao encontrada")

    comment = ProposalComment(
        proposal_id=proposal.id,
        author_name=data.author_name,
        content=data.content,
        highlighted_text=data.highlighted_text,
    )
    db.add(comment)
    await db.flush()
    await db.refresh(comment)

    logger.info("[PROPOSALS] Comment on %s by %s", slug, data.author_name)
    return comment


@router.delete("/public/{slug}/comments/{comment_id}", status_code=204)
async def delete_comment(
    slug: str,
    comment_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Public endpoint - delete a comment from a proposal."""
    stmt = select(ProposalComment).where(ProposalComment.id == comment_id)
    result = await db.execute(stmt)
    comment = result.scalar_one_or_none()

    if not comment:
        raise HTTPException(status_code=404, detail="Comentario nao encontrado")

    await db.delete(comment)
    await db.flush()

    logger.info("[PROPOSALS] Deleted comment %s on %s", comment_id, slug)


@router.get("/{proposal_id}", response_model=ProposalResponse)
async def get_proposal(
    proposal_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get a single proposal (admin)."""
    stmt = select(Proposal).where(Proposal.id == proposal_id)
    result = await db.execute(stmt)
    proposal = result.scalar_one_or_none()

    if not proposal:
        raise HTTPException(status_code=404, detail="Proposal not found")

    return proposal


@router.patch("/{proposal_id}", response_model=ProposalResponse)
async def update_proposal(
    proposal_id: UUID,
    data: ProposalUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a proposal."""
    stmt = select(Proposal).where(Proposal.id == proposal_id)
    result = await db.execute(stmt)
    proposal = result.scalar_one_or_none()

    if not proposal:
        raise HTTPException(status_code=404, detail="Proposal not found")

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(proposal, field, value)

    await db.flush()
    await db.refresh(proposal)

    logger.info("[PROPOSALS] Updated %s: %s", proposal_id, list(update_data.keys()))
    return proposal


@router.delete("/{proposal_id}", status_code=204)
async def delete_proposal(
    proposal_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Delete a proposal."""
    stmt = select(Proposal).where(Proposal.id == proposal_id)
    result = await db.execute(stmt)
    proposal = result.scalar_one_or_none()

    if not proposal:
        raise HTTPException(status_code=404, detail="Proposal not found")

    await db.delete(proposal)
    await db.flush()

    logger.info("[PROPOSALS] Deleted %s (%s)", proposal.slug, proposal_id)


# ─── Public Analytics Endpoints ─────────────────────────────────────────────


@router.post("/public/{slug}/events", response_model=ProposalEventResponse, status_code=201)
async def track_event(
    slug: str,
    data: ProposalEventCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Public endpoint - track a proposal interaction event."""
    stmt = select(Proposal).where(Proposal.slug == slug)
    result = await db.execute(stmt)
    proposal = result.scalar_one_or_none()

    if not proposal:
        raise HTTPException(status_code=404, detail="Proposta nao encontrada")

    event = ProposalEvent(
        proposal_id=proposal.id,
        contact_id=proposal.contact_id,
        session_id=data.session_id,
        event_type=data.event_type,
        event_data=data.event_data,
        ip_address=request.headers.get("x-forwarded-for", request.client.host if request.client else None),
        user_agent=request.headers.get("user-agent"),
    )
    db.add(event)
    await db.flush()
    await db.refresh(event)

    return event


# ─── Admin Analytics Endpoints ───────────────────────────────────────────────


@router.get("/{proposal_id}/analytics", response_model=ProposalAnalyticsSummary)
async def get_proposal_analytics(
    proposal_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get analytics summary for a proposal."""
    # Verify proposal exists
    stmt = select(Proposal).where(Proposal.id == proposal_id)
    result = await db.execute(stmt)
    proposal = result.scalar_one_or_none()
    if not proposal:
        raise HTTPException(status_code=404, detail="Proposal not found")

    # Aggregate stats
    events_stmt = select(ProposalEvent).where(
        ProposalEvent.proposal_id == proposal_id
    ).order_by(ProposalEvent.created_at.desc())
    events_result = await db.execute(events_stmt)
    events = events_result.scalars().all()

    # Calculate summary
    total_views = sum(1 for e in events if e.event_type == "page_view")
    unique_sessions = len({e.session_id for e in events})
    total_time = sum(
        e.event_data.get("seconds", 0)
        for e in events
        if e.event_type == "time_on_page"
    )
    max_scroll = max(
        (e.event_data.get("pct", 0) for e in events if e.event_type == "scroll_depth"),
        default=0,
    )
    total_annotations = sum(1 for e in events if e.event_type == "annotation")
    total_downloads = sum(1 for e in events if e.event_type == "download_pdf")
    sections = list({
        e.event_data.get("section", "")
        for e in events
        if e.event_type == "section_view" and e.event_data.get("section")
    })

    first_view = min((e.created_at for e in events), default=None)
    last_view = max((e.created_at for e in events), default=None)

    return ProposalAnalyticsSummary(
        total_views=total_views,
        unique_sessions=unique_sessions,
        total_time_seconds=total_time,
        max_scroll_pct=max_scroll,
        total_annotations=total_annotations,
        total_downloads=total_downloads,
        sections_viewed=sections,
        first_view=first_view,
        last_view=last_view,
        events=[ProposalEventResponse.model_validate(e) for e in events[:50]],
    )
