"""
Orquestra - Messages Router
List, search, send, and contextualize WhatsApp conversations.
"""

import logging
import math
import re
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from sqlalchemy import and_, desc, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Contact, DeliveryReport, Message, Project, ProjectTask, Proposal
from app.schemas import (
    ChatContextResponse,
    ContactResponse,
    ConversationListItem,
    DeliveryReportMini,
    MarkConversationReadResponse,
    MessageResponse,
    MessageSendRequest,
    PaginatedResponse,
    ProposalMini,
    ReplySuggestionResponse,
    TaskMini,
)
from app.services.chat_state import update_contact_chat_state
from app.services.llm import chat_completion
from app.services.realtime import broadcast_message_event, manager
from app.services.whatsapp import send_whatsapp_message

logger = logging.getLogger(__name__)

router = APIRouter()


def _build_message_response(row) -> MessageResponse:
    msg = row[0]
    msg_dict = MessageResponse.model_validate(msg).model_dump()
    msg_dict["contact_name"] = row.contact_name or row.contact_push_name
    msg_dict["contact_phone"] = row.contact_phone
    msg_dict["project_name"] = row.project_name
    return MessageResponse(**msg_dict)


def _normalize_phone(phone: str) -> str:
    return re.sub(r"\D", "", phone or "")


def _message_media_filename(message: Message) -> str:
    file_path = Path(message.media_local_path or "")
    if file_path.name:
        return file_path.name
    return f"{message.message_type or 'media'}-{message.id}"


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
    stmt = select(Message)
    count_stmt = select(func.count(Message.id))
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
        filters.append(
            text(
                "to_tsvector('portuguese', coalesce(content, '') || ' ' || coalesce(transcription, '')) "
                "@@ plainto_tsquery('portuguese', :search)"
            ).bindparams(search=search)
        )

    if filters:
        stmt = stmt.where(and_(*filters))
        count_stmt = count_stmt.where(and_(*filters))

    total_result = await db.execute(count_stmt)
    total = total_result.scalar() or 0

    offset = (page - 1) * per_page
    stmt = stmt.order_by(Message.timestamp.desc()).offset(offset).limit(per_page)
    stmt = (
        stmt.outerjoin(Contact, Message.contact_id == Contact.id)
        .outerjoin(Project, Message.project_id == Project.id)
        .add_columns(
            Contact.name.label("contact_name"),
            Contact.push_name.label("contact_push_name"),
            Contact.phone.label("contact_phone"),
            Project.name.label("project_name"),
        )
    )

    rows = (await db.execute(stmt)).all()
    total_pages = math.ceil(total / per_page) if total > 0 else 0

    return PaginatedResponse(
        items=[_build_message_response(row) for row in rows],
        total=total,
        page=page,
        page_size=per_page,
        total_pages=total_pages,
    )


@router.get("/conversations", response_model=list[ConversationListItem])
async def list_conversations(
    search: str | None = Query(None),
    unread_only: bool = Query(False),
    limit: int = Query(100, ge=1, le=300),
    db: AsyncSession = Depends(get_db),
):
    msg_count_subq = (
        select(func.count(Message.id))
        .where(Message.contact_id == Contact.id)
        .correlate(Contact)
        .scalar_subquery()
        .label("message_count")
    )

    stmt = (
        select(Contact, Project.name.label("project_name"), msg_count_subq)
        .outerjoin(Project, Contact.project_id == Project.id)
        .where(or_(Contact.last_message_at.is_not(None), msg_count_subq > 0))
    )

    filters = []
    if search:
        pattern = f"%{search}%"
        filters.append(
            or_(
                Contact.name.ilike(pattern),
                Contact.push_name.ilike(pattern),
                Contact.phone.ilike(pattern),
                Project.name.ilike(pattern),
                Contact.last_message_preview.ilike(pattern),
            )
        )
    if unread_only:
        filters.append(Contact.unread_count > 0)
    if filters:
        stmt = stmt.where(and_(*filters))

    stmt = stmt.order_by(Contact.last_message_at.desc().nullslast(), desc(Contact.updated_at)).limit(limit)
    rows = (await db.execute(stmt)).all()

    return [
        ConversationListItem(
            contact_id=contact.id,
            contact_name=contact.name or contact.push_name or contact.phone,
            contact_phone=contact.phone,
            profile_pic_url=contact.profile_pic_url,
            project_id=contact.project_id,
            project_name=project_name,
            pipeline_stage=contact.pipeline_stage or "lead",
            unread_count=contact.unread_count or 0,
            message_count=message_count or 0,
            last_message_preview=contact.last_message_preview,
            last_message_at=contact.last_message_at,
        )
        for contact, project_name, message_count in rows
    ]


@router.get("/conversation/{contact_id}/search", response_model=list[MessageResponse])
async def search_conversation(
    contact_id: UUID,
    q: str = Query(..., min_length=1, description="Search text inside this contact conversation"),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
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

    rows = (await db.execute(stmt)).all()
    rows.reverse()
    return [_build_message_response(row) for row in rows]


@router.get("/conversation/{contact_id}", response_model=list[MessageResponse])
async def get_conversation(
    contact_id: UUID,
    limit: int = Query(0, ge=0, le=100000),
    db: AsyncSession = Depends(get_db),
):
    """Get all messages in a conversation, ordered chronologically (oldest first).

    If limit=0 (default), returns ALL messages. Set limit>0 to get only the last N messages.
    """
    stmt = (
        select(Message)
        .where(Message.contact_id == contact_id)
        .outerjoin(Contact, Message.contact_id == Contact.id)
        .outerjoin(Project, Message.project_id == Project.id)
        .add_columns(
            Contact.name.label("contact_name"),
            Contact.push_name.label("contact_push_name"),
            Contact.phone.label("contact_phone"),
            Project.name.label("project_name"),
        )
    )

    # If limit is set, fetch only the latest N messages (for performance on very long conversations)
    if limit > 0:
        latest_stmt = (
            select(Message)
            .where(Message.contact_id == contact_id)
            .order_by(Message.timestamp.desc())
            .limit(limit)
            .subquery()
        )
        stmt = stmt.where(Message.id.in_(select(latest_stmt.c.id)))

    # Always order by timestamp ascending (oldest first) - chronological order
    stmt = stmt.order_by(Message.timestamp.asc())

    rows = (await db.execute(stmt)).all()
    return [_build_message_response(row) for row in rows]


@router.post("/read/{contact_id}", response_model=MarkConversationReadResponse)
async def mark_conversation_read(
    contact_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    contact = await db.get(Contact, contact_id)
    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")

    contact.unread_count = 0
    await db.flush()
    await manager.broadcast(
        {
            "type": "conversation.read",
            "contact_id": str(contact.id),
            "unread_count": 0,
        },
        contact_id=contact.id,
    )
    return MarkConversationReadResponse(contact_id=contact.id, unread_count=0)


@router.post("/send", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
async def send_message(
    data: MessageSendRequest,
    db: AsyncSession = Depends(get_db),
):
    if not data.contact_id and not data.phone:
        raise HTTPException(status_code=400, detail="contact_id or phone is required")

    contact: Contact | None = None
    if data.contact_id:
        contact = await db.get(Contact, data.contact_id)
    elif data.phone:
        phone = _normalize_phone(data.phone)
        if not phone:
            raise HTTPException(status_code=400, detail="Invalid phone")
        stmt = select(Contact).where(Contact.phone == phone)
        contact = (await db.execute(stmt)).scalar_one_or_none()
        if contact is None:
            contact = Contact(phone=phone, pipeline_stage="lead")
            db.add(contact)
            await db.flush()

    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")

    ok = await send_whatsapp_message(contact.phone, data.content)
    if not ok:
        raise HTTPException(status_code=502, detail="Failed to send message via WhatsApp")

    now = datetime.now(timezone.utc)
    message = Message(
        contact_id=contact.id,
        remote_jid=f"{contact.phone}@s.whatsapp.net",
        direction="outgoing",
        message_type="text",
        content=data.content,
        processed=True,
        project_id=contact.project_id,
        timestamp=now,
    )
    db.add(message)
    update_contact_chat_state(contact, message, now)
    await db.flush()
    await db.refresh(message)

    project_name = None
    if contact.project_id:
        project_name = await db.scalar(select(Project.name).where(Project.id == contact.project_id))

    await broadcast_message_event(message, contact, project_name)

    payload = MessageResponse.model_validate(message).model_dump()
    payload["contact_name"] = contact.name or contact.push_name or contact.phone
    payload["contact_phone"] = contact.phone
    payload["project_name"] = project_name
    return MessageResponse(**payload)


@router.get("/{message_id}/media")
async def get_message_media(
    message_id: UUID,
    download: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    message = await db.get(Message, message_id)
    if message is None:
        raise HTTPException(status_code=404, detail="Message not found")

    if not message.media_local_path:
        raise HTTPException(status_code=404, detail="Media not available")

    file_path = Path(message.media_local_path)
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Media file missing")

    return FileResponse(
        path=file_path,
        media_type=message.media_mimetype or "application/octet-stream",
        filename=_message_media_filename(message),
        content_disposition_type="attachment" if download else "inline",
    )


@router.get("/conversation/{contact_id}/context", response_model=ChatContextResponse)
async def get_conversation_context(
    contact_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    contact = await db.get(Contact, contact_id)
    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")

    message_count = await db.scalar(select(func.count(Message.id)).where(Message.contact_id == contact.id)) or 0
    contact_response = ContactResponse(
        id=contact.id,
        phone=contact.phone,
        name=contact.name,
        push_name=contact.push_name,
        profile_pic_url=contact.profile_pic_url,
        tags=contact.tags or [],
        project_id=contact.project_id,
        notes=contact.notes,
        is_group=contact.is_group,
        ignored=contact.ignored,
        pipeline_stage=contact.pipeline_stage or "lead",
        company=contact.company,
        email=contact.email,
        engagement_score=contact.engagement_score or 0,
        last_contacted_at=contact.last_contacted_at,
        next_action=contact.next_action,
        next_action_date=contact.next_action_date,
        monthly_revenue=contact.monthly_revenue,
        total_revenue=contact.total_revenue,
        acquired_at=contact.acquired_at,
        support_ends_at=contact.support_ends_at,
        created_at=contact.created_at,
        updated_at=contact.updated_at,
        message_count=message_count,
        unread_count=contact.unread_count or 0,
        last_message_preview=contact.last_message_preview,
        last_message_at=contact.last_message_at,
    )

    project_name = None
    if contact.project_id:
        project_name = await db.scalar(select(Project.name).where(Project.id == contact.project_id))

    proposal_rows = (
        await db.execute(
            select(Proposal)
            .where(Proposal.contact_id == contact.id)
            .order_by(Proposal.updated_at.desc())
            .limit(5)
        )
    ).scalars().all()

    task_rows = []
    if contact.project_id:
        task_rows = (
            await db.execute(
                select(ProjectTask)
                .where(ProjectTask.project_id == contact.project_id)
                .where(ProjectTask.status != "done")
                .order_by(ProjectTask.updated_at.desc())
                .limit(6)
            )
        ).scalars().all()

    report_rows = (
        await db.execute(
            select(DeliveryReport)
            .where(DeliveryReport.contact_id == contact.id)
            .order_by(DeliveryReport.generated_at.desc())
            .limit(4)
        )
    ).scalars().all()

    return ChatContextResponse(
        contact=contact_response,
        project_name=project_name,
        proposals=[
            ProposalMini(
                id=proposal.id,
                title=proposal.title,
                status=proposal.status,
                total_value=proposal.total_value,
                updated_at=proposal.updated_at,
            )
            for proposal in proposal_rows
        ],
        tasks=[
            TaskMini(
                id=task.id,
                title=task.title,
                status=task.status,
                priority=task.priority,
                updated_at=task.updated_at,
            )
            for task in task_rows
        ],
        delivery_reports=[
            DeliveryReportMini(
                id=report.id,
                proposal_id=report.proposal_id,
                status=report.status,
                generated_at=report.generated_at,
                comparison_analysis=report.comparison_analysis,
            )
            for report in report_rows
        ],
    )


@router.post("/conversation/{contact_id}/reply-suggestion", response_model=ReplySuggestionResponse)
async def suggest_reply(
    contact_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    contact = await db.get(Contact, contact_id)
    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")

    recent_messages = (
        await db.execute(
            select(Message)
            .where(Message.contact_id == contact.id)
            .order_by(Message.timestamp.desc())
            .limit(20)
        )
    ).scalars().all()
    recent_messages.reverse()

    proposals = (
        await db.execute(
            select(Proposal)
            .where(Proposal.contact_id == contact.id)
            .order_by(Proposal.updated_at.desc())
            .limit(3)
        )
    ).scalars().all()

    tasks = []
    if contact.project_id:
        tasks = (
            await db.execute(
                select(ProjectTask)
                .where(ProjectTask.project_id == contact.project_id)
                .order_by(ProjectTask.updated_at.desc())
                .limit(5)
            )
        ).scalars().all()

    transcript = "\n".join(
        f"[{msg.timestamp.strftime('%d/%m %H:%M')}] "
        f"{'Cliente' if msg.direction == 'incoming' else 'Diego'}: "
        f"{(msg.content or msg.transcription or '[' + msg.message_type + ']')[:220]}"
        for msg in recent_messages
    )
    proposals_text = "\n".join(
        f"- {proposal.title} | status={proposal.status} | valor={proposal.total_value or 'n/a'}"
        for proposal in proposals
    ) or "Sem propostas ativas."
    tasks_text = "\n".join(
        f"- {task.title} | {task.status} | prioridade={task.priority}"
        for task in tasks
    ) or "Sem tasks relevantes."

    prompt = [
        {
            "role": "system",
            "content": (
                "Voce e Jarbas, operador comercial do Diego. "
                "Sugira UMA resposta curta de WhatsApp, objetiva, calorosa e em portugues brasileiro. "
                "Nao invente promessas nem datas. Se faltar contexto, seja conservador. "
                "Responda apenas com a mensagem final."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Contato: {contact.name or contact.push_name or contact.phone}\n"
                f"Notas: {contact.notes or 'Sem notas.'}\n\n"
                f"Propostas:\n{proposals_text}\n\n"
                f"Tasks:\n{tasks_text}\n\n"
                f"Conversa recente:\n{transcript}"
            ),
        },
    ]

    suggestion = await chat_completion(prompt, temperature=0.4, max_tokens=220)
    return ReplySuggestionResponse(suggestion=suggestion.strip())
