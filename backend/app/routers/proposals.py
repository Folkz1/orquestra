"""
Orquestra - Proposals Router
CRUD for commercial proposals + public view by slug.
"""

import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Proposal, ProposalComment
from app.schemas import (
    ProposalCommentCreate,
    ProposalCommentResponse,
    ProposalCreate,
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

    proposal = Proposal(
        slug=data.slug,
        title=data.title,
        client_name=data.client_name,
        client_phone=data.client_phone,
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
    )
    db.add(comment)
    await db.flush()
    await db.refresh(comment)

    logger.info("[PROPOSALS] Comment on %s by %s", slug, data.author_name)
    return comment


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
