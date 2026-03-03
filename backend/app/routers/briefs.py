"""
Orquestra - Daily Briefs Router
List, view, and generate daily briefs.
"""

import logging
import math
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import DailyBrief
from app.schemas import BriefGenerateRequest, DailyBriefResponse, PaginatedResponse
from app.services.orchestrator import generate_daily_brief, send_telegram_brief

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("", response_model=PaginatedResponse[DailyBriefResponse])
async def list_briefs(
    page: int = Query(1, ge=1, description="Page number"),
    per_page: int = Query(50, ge=1, le=200, description="Items per page"),
    db: AsyncSession = Depends(get_db),
):
    """List all daily briefs ordered by date DESC with pagination."""
    # Count
    count_stmt = select(func.count(DailyBrief.id))
    count_result = await db.execute(count_stmt)
    total = count_result.scalar() or 0

    # Fetch
    offset = (page - 1) * per_page
    stmt = (
        select(DailyBrief)
        .order_by(DailyBrief.date.desc())
        .offset(offset)
        .limit(per_page)
    )
    result = await db.execute(stmt)
    briefs = result.scalars().all()

    total_pages = math.ceil(total / per_page) if total > 0 else 0

    return PaginatedResponse(
        items=[DailyBriefResponse.model_validate(b) for b in briefs],
        total=total,
        page=page,
        page_size=per_page,
        total_pages=total_pages,
    )


@router.get("/{brief_id}", response_model=DailyBriefResponse)
async def get_brief(
    brief_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get full details of a single daily brief."""
    stmt = select(DailyBrief).where(DailyBrief.id == brief_id)
    result = await db.execute(stmt)
    brief = result.scalar_one_or_none()

    if not brief:
        raise HTTPException(status_code=404, detail="Brief not found")

    return DailyBriefResponse.model_validate(brief)


@router.post("/generate", response_model=DailyBriefResponse)
async def generate_brief(
    body: BriefGenerateRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Generate a new daily brief.
    Defaults to the last 24 hours if no dates provided.
    Optionally sends via Telegram (default: True).
    """
    now = datetime.now(timezone.utc)
    date_from = body.date_from or (now - timedelta(hours=24))
    date_to = body.date_to or now

    if date_from >= date_to:
        raise HTTPException(
            status_code=400,
            detail="date_from must be before date_to",
        )

    logger.info(
        "[BRIEFS] Generating brief for %s to %s",
        date_from.isoformat(),
        date_to.isoformat(),
    )

    try:
        brief_data = await generate_daily_brief(db, date_from, date_to)
    except Exception as exc:
        logger.error("[BRIEFS] Brief generation failed: %s", exc)
        raise HTTPException(
            status_code=500,
            detail=f"Brief generation failed: {str(exc)[:200]}",
        )

    # Send via Telegram if requested (default: True)
    if body.send_telegram:
        try:
            sent = await send_telegram_brief(brief_data)
            if sent:
                # Update the brief record
                brief_id = brief_data.get("id")
                if brief_id:
                    stmt = select(DailyBrief).where(DailyBrief.id == brief_id)
                    result = await db.execute(stmt)
                    brief_record = result.scalar_one_or_none()
                    if brief_record:
                        brief_record.sent_telegram = True
                        await db.flush()
        except Exception as exc:
            logger.error("[BRIEFS] Telegram send failed: %s", exc)
            # Don't fail the whole request if Telegram fails

    # Fetch the saved brief to return
    stmt = select(DailyBrief).where(DailyBrief.id == brief_data["id"])
    result = await db.execute(stmt)
    brief = result.scalar_one_or_none()

    if not brief:
        raise HTTPException(
            status_code=500,
            detail="Brief was generated but could not be retrieved",
        )

    return DailyBriefResponse.model_validate(brief)
