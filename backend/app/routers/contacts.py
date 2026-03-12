"""
Orquestra - Contacts Router
List and update contacts with filters + AI suggestions.
"""

import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Contact, Message, Proposal, ProposalEvent
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
            pipeline_stage=contact.pipeline_stage or "lead",
            company=contact.company,
            email=contact.email,
            engagement_score=contact.engagement_score or 0,
            last_contacted_at=contact.last_contacted_at,
            next_action=contact.next_action,
            next_action_date=contact.next_action_date,
            monthly_revenue=contact.monthly_revenue,
            total_revenue=contact.total_revenue,
            support_ends_at=contact.support_ends_at,
            created_at=contact.created_at,
            updated_at=contact.updated_at,
            message_count=message_count or 0,
            unread_count=contact.unread_count or 0,
            last_message_preview=contact.last_message_preview,
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
        pipeline_stage=contact.pipeline_stage or "lead",
        company=contact.company,
        email=contact.email,
        engagement_score=contact.engagement_score or 0,
        last_contacted_at=contact.last_contacted_at,
        next_action=contact.next_action,
        next_action_date=contact.next_action_date,
        monthly_revenue=contact.monthly_revenue,
        total_revenue=contact.total_revenue,
        support_ends_at=contact.support_ends_at,
        created_at=contact.created_at,
        updated_at=contact.updated_at,
        message_count=message_count,
        unread_count=contact.unread_count or 0,
        last_message_preview=contact.last_message_preview,
        last_message_at=last_message_at,
    )


@router.get("/{contact_id}/suggestions")
async def get_contact_suggestions(
    contact_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Generate AI-powered suggestions for a contact based on all available intelligence."""
    from app.services.llm import chat_completion
    from app.services.memory import search_memory

    # 1. Fetch contact
    stmt = select(Contact).where(Contact.id == contact_id)
    result = await db.execute(stmt)
    contact = result.scalar_one_or_none()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    # 2. Recent messages (last 30)
    msg_stmt = (
        select(Message)
        .where(Message.contact_id == contact_id)
        .order_by(Message.timestamp.desc())
        .limit(30)
    )
    msg_result = await db.execute(msg_stmt)
    messages = msg_result.scalars().all()

    # 3. Proposals linked to this contact
    proposal_stmt = select(Proposal).where(Proposal.contact_id == contact_id)
    proposal_result = await db.execute(proposal_stmt)
    proposals = proposal_result.scalars().all()

    # 4. Proposal analytics (if any proposals)
    analytics_ctx = []
    for p in proposals:
        events_stmt = select(ProposalEvent).where(ProposalEvent.proposal_id == p.id)
        ev_result = await db.execute(events_stmt)
        events = ev_result.scalars().all()
        if events:
            views = sum(1 for e in events if e.event_type == "page_view")
            time_s = sum(e.event_data.get("seconds", 0) for e in events if e.event_type == "time_on_page")
            analytics_ctx.append(f"Proposta '{p.title}': {views} views, {time_s}s tempo total, status={p.status}")

    # 5. Memory search for contact name
    memory_results = []
    search_name = contact.name or contact.push_name or contact.phone
    try:
        memory_results = await search_memory(db, search_name, limit=5)
    except Exception:
        logger.warning("[CONTACTS] Memory search failed for %s", search_name)

    # Build context
    now = datetime.now(timezone.utc)
    msgs_text = "\n".join([
        f"[{m.timestamp.strftime('%d/%m %H:%M')}] {'>' if m.direction == 'outgoing' else '<'} {(m.content or m.transcription or m.message_type)[:150]}"
        for m in messages[:20]
    ]) or "Sem mensagens recentes."

    proposals_text = "\n".join([
        f"- {p.title} | {p.total_value or 'sem valor'} | status={p.status} | criada={p.created_at.strftime('%d/%m/%Y')}"
        + (f" | vista={p.viewed_at.strftime('%d/%m/%Y')}" if p.viewed_at else " | nao vista")
        for p in proposals
    ]) or "Nenhuma proposta vinculada."

    analytics_text = "\n".join(analytics_ctx) or "Sem dados de analytics."

    memory_text = "\n".join([
        f"- [{r.get('source_type', '?')}] {(r.get('summary') or r.get('content', ''))[:200]}"
        for r in memory_results
    ]) or "Sem memorias relevantes."

    days_since_contact = "nunca"
    if contact.last_contacted_at:
        days = (now - contact.last_contacted_at).days
        days_since_contact = f"{days} dias atras"
    elif messages:
        days = (now - messages[0].timestamp).days
        days_since_contact = f"{days} dias atras"

    support_info = ""
    if contact.support_ends_at:
        days_left = (contact.support_ends_at - now).days
        support_info = f"Suporte termina em {days_left} dias ({contact.support_ends_at.strftime('%d/%m/%Y')})"

    prompt = f"""Voce e o CTO virtual do Diego (Guy Folkz - Automacao & IA para Negocios).
Analise TODA a inteligencia abaixo sobre este cliente e gere 3 a 5 sugestoes ACIOÁVEIS e concretas.

CLIENTE: {contact.name or contact.push_name or 'Desconhecido'} ({contact.phone})
Empresa: {contact.company or 'nao informada'}
Pipeline: {contact.pipeline_stage}
Engagement Score: {contact.engagement_score}/100
Ultimo contato: {days_since_contact}
Proxima acao registrada: {contact.next_action or 'nenhuma'}
Receita mensal: {contact.monthly_revenue or 'nao informada'}
{support_info}

MENSAGENS RECENTES:
{msgs_text}

PROPOSTAS:
{proposals_text}

ANALYTICS DE PROPOSTAS:
{analytics_text}

MEMORIA RAG:
{memory_text}

Gere sugestoes no formato JSON:
[
  {{"tipo": "follow_up|upsell|suporte|urgente|relacionamento", "titulo": "titulo curto", "descricao": "descricao detalhada da acao", "prioridade": "alta|media|baixa"}}
]

Regras:
- Foco em RECEITA e RETENCAO
- Se proposta foi vista mas nao respondida: sugerir follow-up
- Se suporte esta acabando: sugerir renovacao
- Se engagement score baixo: sugerir reengajamento
- Se sem contato ha muito tempo: sugerir check-in
- Seja ESPECIFICO (use nomes, valores, datas reais do contexto)
- Responda APENAS o JSON, sem texto extra."""

    try:
        response = await chat_completion(
            [{"role": "user", "content": prompt}],
            temperature=0.4,
            max_tokens=2000,
        )

        import json
        import re
        # Parse JSON from response
        match = re.search(r"\[.*\]", response, re.DOTALL)
        if match:
            suggestions = json.loads(match.group())
        else:
            suggestions = [{"tipo": "info", "titulo": "Analise disponivel", "descricao": response[:500], "prioridade": "media"}]

        logger.info("[CONTACTS] Generated %d suggestions for %s", len(suggestions), contact_id)
        return {"contact_id": str(contact_id), "suggestions": suggestions}

    except Exception as e:
        logger.error("[CONTACTS] AI suggestions failed: %s", str(e))
        return {"contact_id": str(contact_id), "suggestions": [], "error": str(e)}
