"""
Orquestra - Messages Router
List and search messages with full-text search and pagination.
"""

import logging
import math
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select, and_, or_, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Contact, Message, Project
from app.schemas import MessageResponse, PaginatedResponse

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("", response_model=PaginatedResponse[MessageResponse])
async def list_messages(
    contact_id: UUID | None = Query(None, description="Filter by contact ID"),
    project_id: UUID | None = Query(None, description="Filter by project ID"),
    message_type: str | None = Query(None, alias="type", description="Filter by message type"),
    date_from: datetime | None = Query(None, description="Start date filter"),
    date_to: datetime | None = Query(None, description="End date filter"),
    search: str | None = Query(None, description="Full-text search in content and transcription"),
    page: int = Query(1, ge=1, description="Page number"),
    per_page: int = Query(50, ge=1, le=200, description="Items per page"),
    db: AsyncSession = Depends(get_db),
):
    """
    List messages with filters and pagination.
    Full-text search uses PostgreSQL ts_vector with Portuguese configuration.
    """
    # Base query
    stmt = select(Message)
    count_stmt = select(func.count(Message.id))

    # Build filters
    filters = []

    if contact_id is not None:
        filters.append(Message.contact_id == contact_id)

    if project_id is not None:
        filters.append(Message.project_id == project_id)

    if message_type is not None:
        filters.append(Message.message_type == message_type)

    if date_from is not None:
        filters.append(Message.timestamp >= date_from)

    if date_to is not None:
        filters.append(Message.timestamp <= date_to)

    if search:
        # Full-text search using PostgreSQL tsvector
        # CRITICAL: Use proper parameter binding, not string interpolation
        # CRITICAL: Use CAST(:param AS ...) syntax, NEVER ::type (asyncpg incompatibility)
        fts_filter = text(
            "to_tsvector('portuguese', coalesce(content, '') || ' ' || coalesce(transcription, '')) "
            "@@ plainto_tsquery('portuguese', :search)"
        ).bindparams(search=search)
        filters.append(fts_filter)

    if filters:
        stmt = stmt.where(and_(*filters))
        count_stmt = count_stmt.where(and_(*filters))

    # Get total count
    total_result = await db.execute(count_stmt)
    total = total_result.scalar() or 0

    # Apply pagination and ordering
    offset = (page - 1) * per_page
    stmt = stmt.order_by(Message.timestamp.desc()).offset(offset).limit(per_page)

    # Join contact and project for name resolution
    stmt = stmt.outerjoin(Contact, Message.contact_id == Contact.id)
    stmt = stmt.outerjoin(Project, Message.project_id == Project.id)
    stmt = stmt.add_columns(
        Contact.name.label("contact_name"),
        Contact.push_name.label("contact_push_name"),
        Contact.phone.label("contact_phone"),
        Project.name.label("project_name"),
    )

    result = await db.execute(stmt)
    rows = result.all()

    total_pages = math.ceil(total / per_page) if total > 0 else 0

    items = []
    for row in rows:
        msg = row[0]
        contact_name = row.contact_name or row.contact_push_name
        contact_phone = row.contact_phone
        project_name = row.project_name

        msg_dict = MessageResponse.model_validate(msg).model_dump()
        msg_dict["contact_name"] = contact_name
        msg_dict["contact_phone"] = contact_phone
        msg_dict["project_name"] = project_name
        items.append(MessageResponse(**msg_dict))

    return PaginatedResponse(
        items=items,
        total=total,
        page=page,
        page_size=per_page,
        total_pages=total_pages,
    )


@router.get("/conversation/{contact_id}/search", response_model=list[MessageResponse])
async def search_conversation(
    contact_id: UUID,
    q: str = Query(..., min_length=1, description="Search text inside this contact conversation"),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """Search messages inside a single contact conversation (full-text + fallback ILIKE)."""
    stmt = (
        select(Message)
        .where(Message.contact_id == contact_id)
        .where(
            or_(
                text(
                    "to_tsvector('portuguese', coalesce(content, '') || ' ' || coalesce(transcription, '')) "
                    "@@ plainto_tsquery('portuguese', :search)"
                ).bindparams(search=q),
                Message.content.ilike(f"%{q}%"),
                Message.transcription.ilike(f"%{q}%"),
            )
        )
        .order_by(Message.timestamp.desc())
        .limit(limit)
        .outerjoin(Contact, Message.contact_id == Contact.id)
        .outerjoin(Project, Message.project_id == Project.id)
        .add_columns(
            Contact.name.label("contact_name"),
            Contact.push_name.label("contact_push_name"),
            Contact.phone.label("contact_phone"),
            Project.name.label("project_name"),
        )
    )

    result = await db.execute(stmt)
    rows = result.all()
    rows.reverse()  # return ASC for readability

    items = []
    for row in rows:
        msg = row[0]
        msg_dict = MessageResponse.model_validate(msg).model_dump()
        msg_dict["contact_name"] = row.contact_name or row.contact_push_name
        msg_dict["contact_phone"] = row.contact_phone
        msg_dict["project_name"] = row.project_name
        items.append(MessageResponse(**msg_dict))

    return items


@router.get("/conversation/{contact_id}", response_model=list[MessageResponse])
async def get_conversation(
    contact_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """
    Get full conversation for a contact, ordered by timestamp ASC.
    """
    stmt = (
        select(Message)
        .where(Message.contact_id == contact_id)
        .order_by(Message.timestamp.asc())
        .outerjoin(Contact, Message.contact_id == Contact.id)
        .outerjoin(Project, Message.project_id == Project.id)
        .add_columns(
            Contact.name.label("contact_name"),
            Contact.push_name.label("contact_push_name"),
            Contact.phone.label("contact_phone"),
            Project.name.label("project_name"),
        )
    )

    result = await db.execute(stmt)
    rows = result.all()

    items = []
    for row in rows:
        msg = row[0]
        msg_dict = MessageResponse.model_validate(msg).model_dump()
        msg_dict["contact_name"] = row.contact_name or row.contact_push_name
        msg_dict["contact_phone"] = row.contact_phone
        msg_dict["project_name"] = row.project_name
        items.append(MessageResponse(**msg_dict))

    return items
