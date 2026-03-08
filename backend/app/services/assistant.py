"""Owner-controlled WhatsApp assistant (draft-first)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AssistantDraft, Contact, Message
from app.services.llm import chat_completion
from app.services.whatsapp import send_whatsapp_message

logger = logging.getLogger(__name__)


async def _get_contact_by_phone(db: AsyncSession, phone: str) -> Optional[Contact]:
    stmt = select(Contact).where(Contact.phone == phone)
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def _build_style_examples(db: AsyncSession, contact_id: UUID, limit: int = 20) -> list[str]:
    """Learn user's tone from previous outgoing messages.

    Priority:
      1) Outgoing to same contact
      2) Outgoing to other non-group contacts
    """
    examples: list[str] = []

    same_stmt = (
        select(Message.content)
        .where(
            Message.contact_id == contact_id,
            Message.direction == "outgoing",
            Message.message_type == "text",
            Message.content.isnot(None),
        )
        .order_by(desc(Message.timestamp))
        .limit(limit)
    )
    same_rows = (await db.execute(same_stmt)).all()
    for row in same_rows:
        text = (row[0] or "").strip()
        if len(text) >= 8 and not text.startswith("/"):
            examples.append(text)

    if len(examples) < limit:
        global_stmt = (
            select(Message.content)
            .join(Contact, Contact.id == Message.contact_id)
            .where(
                Message.direction == "outgoing",
                Message.message_type == "text",
                Message.content.isnot(None),
                Contact.is_group.is_(False),
            )
            .order_by(desc(Message.timestamp))
            .limit(limit * 3)
        )
        global_rows = (await db.execute(global_stmt)).all()
        for row in global_rows:
            text = (row[0] or "").strip()
            if len(text) >= 8 and not text.startswith("/"):
                examples.append(text)
                if len(examples) >= limit:
                    break

    return examples[:limit]


async def _build_conversation_context(db: AsyncSession, contact_id: UUID, limit: int = 24) -> str:
    stmt = (
        select(Message)
        .where(Message.contact_id == contact_id)
        .order_by(desc(Message.timestamp))
        .limit(limit)
    )
    rows = (await db.execute(stmt)).scalars().all()
    rows.reverse()

    lines: list[str] = []
    for m in rows:
        text = (m.content or m.transcription or "").strip()
        if not text:
            continue
        who = "CLIENTE" if m.direction == "incoming" else "EU"
        lines.append(f"[{who}] {text}")
    return "\n".join(lines)


async def generate_reply_draft(
    db: AsyncSession,
    contact: Contact,
    objective: str | None = None,
) -> AssistantDraft:
    style_examples = await _build_style_examples(db, contact.id)
    conversation = await _build_conversation_context(db, contact.id)

    style_block = "\n".join(f"- {x}" for x in style_examples[:12]) or "- Seja direto e profissional."
    objective = (objective or "Responder a última demanda do cliente com clareza e próximo passo.").strip()

    system_prompt = (
        "Você é um assistente de WhatsApp que escreve rascunhos para o dono da conta. "
        "Objetivo: manter o estilo real do dono, com linguagem natural em português do Brasil, "
        "tom humano, direto e orientado a fechar próximo passo. "
        "NUNCA invente fatos. Se faltar contexto, assuma o mínimo e peça confirmação no final. "
        "Retorne APENAS o texto da resposta final, sem explicações."
    )

    user_prompt = (
        f"CONTATO: {contact.name or contact.push_name or contact.phone}\n"
        f"OBJETIVO: {objective}\n\n"
        "EXEMPLOS REAIS DO MEU JEITO DE ESCREVER:\n"
        f"{style_block}\n\n"
        "CONVERSA RECENTE:\n"
        f"{conversation}\n\n"
        "Escreva uma resposta curta (até ~6 linhas), com opção de fechamento comercial quando fizer sentido."
    )

    draft_text = await chat_completion(
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.35,
        max_tokens=600,
    )

    draft = AssistantDraft(
        contact_id=contact.id,
        objective=objective,
        draft_text=draft_text.strip(),
        status="generated",
        metadata_json={
            "style_examples_count": len(style_examples),
            "generated_from": "conversation+owner_style",
        },
    )
    db.add(draft)
    await db.flush()
    await db.refresh(draft)
    return draft


async def send_draft(db: AsyncSession, draft: AssistantDraft) -> bool:
    if draft.status == "sent":
        return True

    contact = await db.get(Contact, draft.contact_id)
    if not contact:
        return False

    ok = await send_whatsapp_message(contact.phone, draft.draft_text)
    if ok:
        draft.status = "sent"
        draft.sent_at = datetime.now(timezone.utc)
    return ok


async def parse_owner_command(text: str) -> dict | None:
    """Supported commands:
      /assist help
      /assist draft <phone> | <objective>
      /assist send <draft_id>
    """
    raw = (text or "").strip()
    if not raw.lower().startswith("/assist"):
        return None

    parts = raw.split(" ", 2)
    if len(parts) < 2:
        return {"action": "help"}

    action = parts[1].lower().strip()
    rest = parts[2].strip() if len(parts) > 2 else ""

    if action == "help":
        return {"action": "help"}
    if action == "send" and rest:
        return {"action": "send", "draft_id": rest}
    if action == "draft" and rest:
        phone, objective = (rest.split("|", 1) + [""])[:2]
        return {"action": "draft", "phone": phone.strip(), "objective": objective.strip() or None}
    return {"action": "help"}
