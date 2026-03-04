"""
Orquestra - Contacts Router
List and update contacts with filters.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Contact, Message
from app.schemas import ContactResponse, ContactUpdate

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("", response_model=list[ContactResponse])
async def list_contacts(
    search: str | None = Query(None, description="Search by name, phone, or push_name"),
    project_id: UUID | None = Query(None, description="Filter by project ID"),
    is_group: bool | None = Query(None, description="Filter groups or individuals"),
    has_recent_messages: bool | None = Query(
        None, description="Filter contacts with messages in the last 7 days"
    ),
    db: AsyncSession = Depends(get_db),
):
    """
    List contacts with optional filters.
    Includes message_count and last_message_at computed via subquery.
    """
    # Subqueries for message stats
    msg_count_subq = (
        select(func.count(Message.id))
        .where(Message.contact_id == Contact.id)
        .correlate(Contact)
        .scalar_subquery()
        .label("message_count")
    )
    last_msg_subq = (
        select(func.max(Message.timestamp))
        .where(Message.contact_id == Contact.id)
        .correlate(Contact)
        .scalar_subquery()
        .label("last_message_at")
    )

    stmt = select(Contact, msg_count_subq, last_msg_subq)

    # Apply filters
    filters = []

    if search:
        search_pattern = f"%{search}%"
        filters.append(
            or_(
                Contact.name.ilike(search_pattern),
                Contact.phone.ilike(search_pattern),
                Contact.push_name.ilike(search_pattern),
            )
        )

    if project_id is not None:
        filters.append(Contact.project_id == project_id)

    if is_group is not None:
        filters.append(Contact.is_group == is_group)

    if has_recent_messages:
        from datetime import datetime, timedelta, timezone

        seven_days_ago = datetime.now(timezone.utc) - timedelta(days=7)
        recent_subq = (
            select(Message.contact_id)
            .where(Message.timestamp >= seven_days_ago)
            .distinct()
        )
        filters.append(Contact.id.in_(recent_subq))

    if filters:
        stmt = stmt.where(and_(*filters))

    stmt = stmt.order_by(Contact.updated_at.desc())

    result = await db.execute(stmt)
    rows = result.all()

    contacts_out = []
    for contact, message_count, last_message_at in rows:
        contact_data = ContactResponse(
            id=contact.id,
            phone=contact.phone,
            name=contact.name,
            push_name=contact.push_name,
            profile_pic_url=contact.profile_pic_url,
            tags=contact.tags or [],
            project_id=contact.project_id,
            notes=contact.notes,
            is_group=contact.is_group,
            ignored=contact.ignored if hasattr(contact, 'ignored') else False,
            created_at=contact.created_at,
            updated_at=contact.updated_at,
            message_count=message_count or 0,
            last_message_at=last_message_at,
        )
        contacts_out.append(contact_data)

    return contacts_out


@router.patch("/{contact_id}", response_model=ContactResponse)
async def update_contact(
    contact_id: UUID,
    update: ContactUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a contact's name, tags, project_id, or notes."""
    stmt = select(Contact).where(Contact.id == contact_id)
    result = await db.execute(stmt)
    contact = result.scalar_one_or_none()

    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    # Apply updates (only non-None fields)
    update_data = update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(contact, field, value)

    await db.flush()
    await db.refresh(contact)

    # Fetch message stats
    msg_count_stmt = select(func.count(Message.id)).where(Message.contact_id == contact.id)
    last_msg_stmt = select(func.max(Message.timestamp)).where(Message.contact_id == contact.id)

    count_result = await db.execute(msg_count_stmt)
    last_result = await db.execute(last_msg_stmt)
    message_count = count_result.scalar() or 0
    last_message_at = last_result.scalar()

    logger.info("[CONTACTS] Updated contact %s: %s", contact_id, list(update_data.keys()))

    return ContactResponse(
        id=contact.id,
        phone=contact.phone,
        name=contact.name,
        push_name=contact.push_name,
        profile_pic_url=contact.profile_pic_url,
        tags=contact.tags or [],
        project_id=contact.project_id,
        notes=contact.notes,
        is_group=contact.is_group,
        ignored=contact.ignored if hasattr(contact, 'ignored') else False,
        created_at=contact.created_at,
        updated_at=contact.updated_at,
        message_count=message_count,
        last_message_at=last_message_at,
    )
