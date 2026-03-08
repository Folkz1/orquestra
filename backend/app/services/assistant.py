"""Owner-controlled WhatsApp assistant (draft-first)."""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import AssistantDraft, Contact, Message
from app.services.llm import chat_completion
from app.services.whatsapp import send_whatsapp_message

logger = logging.getLogger(__name__)


def normalize_phone(phone: str) -> str:
    return re.sub(r"\D", "", phone or "")


def is_owner_phone(phone: str) -> bool:
    if not settings.OWNER_WHATSAPP:
        return False
    return normalize_phone(phone) == normalize_phone(settings.OWNER_WHATSAPP)


async def _get_contact_by_phone(db: AsyncSession, phone: str) -> Optional[Contact]:
    phone = normalize_phone(phone)
    stmt = select(Contact).where(Contact.phone == phone)
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def get_or_create_contact_by_phone(db: AsyncSession, phone: str, name: str | None = None) -> Contact:
    phone = normalize_phone(phone)
    found = await _get_contact_by_phone(db, phone)
    if found:
        return found

    contact = Contact(phone=phone, name=name or phone, push_name=name, is_group=False)
    db.add(contact)
    await db.flush()
    await db.refresh(contact)
    return contact


async def _build_style_examples(db: AsyncSession, contact_id: UUID, limit: int = 20) -> list[str]:
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
        model=settings.ASSISTANT_CHAT_MODEL or settings.MODEL_CHAT_SMART,
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


async def generate_voice_script(db: AsyncSession, contact: Contact, objective: str) -> str:
    conversation = await _build_conversation_context(db, contact.id)
    system = (
        "Você escreve roteiro curto para áudio de WhatsApp de um vendedor consultivo no Brasil. "
        "Tom: firme, humano, sem enrolação. Até 45 segundos de fala. "
        "Retorne apenas o texto pronto para gravar."
    )
    user = (
        f"Contato: {contact.name or contact.push_name or contact.phone}\n"
        f"Objetivo: {objective}\n\n"
        f"Contexto da conversa:\n{conversation}"
    )
    return (await chat_completion([
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ], model=settings.ASSISTANT_CHAT_MODEL or settings.MODEL_CHAT_SMART, temperature=0.4, max_tokens=400)).strip()


async def list_open_threads(db: AsyncSession, limit: int = 10) -> list[dict]:
    stmt = (
        select(Message, Contact)
        .join(Contact, Contact.id == Message.contact_id)
        .where(Contact.is_group.is_(False), Contact.ignored.is_(False))
        .order_by(desc(Message.timestamp))
        .limit(800)
    )
    rows = (await db.execute(stmt)).all()

    by_contact: dict[UUID, dict] = {}
    for msg, contact in rows:
        c = by_contact.setdefault(contact.id, {
            "contact": contact,
            "last_in": None,
            "last_out": None,
            "last_in_text": None,
        })
        if msg.direction == "incoming" and c["last_in"] is None:
            c["last_in"] = msg.timestamp
            c["last_in_text"] = (msg.content or msg.transcription or "").strip()
        if msg.direction == "outgoing" and c["last_out"] is None:
            c["last_out"] = msg.timestamp

    pending = []
    owner = normalize_phone(settings.OWNER_WHATSAPP or "")
    for data in by_contact.values():
        li = data["last_in"]
        lo = data["last_out"]
        if li and (lo is None or li > lo):
            contact = data["contact"]
            if owner and normalize_phone(contact.phone or "") == owner:
                continue
            pending.append({
                "phone": contact.phone,
                "name": contact.name or contact.push_name or contact.phone,
                "last_in": li,
                "preview": (data["last_in_text"] or "")[:120],
            })

    pending.sort(key=lambda x: x["last_in"], reverse=True)
    return pending[:limit]


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
    if action == "open":
        return {"action": "open"}
    if action == "send" and rest:
        return {"action": "send", "draft_id": rest}
    if action == "draft" and rest:
        phone, objective = (rest.split("|", 1) + [""])[:2]
        return {"action": "draft", "phone": normalize_phone(phone), "objective": objective.strip() or None}
    if action == "audio" and rest:
        phone, objective = (rest.split("|", 1) + [""])[:2]
        return {"action": "audio", "phone": normalize_phone(phone), "objective": objective.strip() or "Responder com firmeza e próximo passo."}
    return {"action": "help"}


async def owner_chat_reply(db: AsyncSession, text: str) -> str:
    pending = await list_open_threads(db, limit=8)
    lines = []
    for i, item in enumerate(pending, 1):
        lines.append(f"{i}. {item['name']} ({item['phone']}): {item['preview']}")
    pending_block = "\n".join(lines) if lines else "Sem conversas em aberto no momento."

    system = (
        "Você é o Jarbas comercial do Diego. Responda em português BR, em linguagem natural, direto e útil. "
        "Seu papel: orientar negociação, priorizar clientes com maior chance de receita, e sugerir próximos passos claros. "
        "Quando fizer sentido, sugira exatamente o que enviar para o cliente (texto curto) e alternativa de áudio. "
        "Se o usuário pedir envio/ação, lembre de confirmar número e objetivo em 1 frase."
    )
    user = (
        f"Mensagem do Diego: {text}\n\n"
        f"Conversas em aberto agora:\n{pending_block}\n\n"
        "Responda como um copiloto comercial em no máximo 12 linhas."
    )
    return (await chat_completion(
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        model=settings.ASSISTANT_CHAT_MODEL or settings.MODEL_CHAT_SMART,
        temperature=0.35,
        max_tokens=500,
    )).strip()


async def parse_owner_natural_message(text: str) -> dict:
    raw = (text or "").strip()
    low = raw.lower()

    # Fast-path heuristics
    if any(k in low for k in ["em aberto", "pendente", "quem eu nao respondi", "conversas abertas", "o que está rolando", "o que ta rolando"]):
        return {"action": "open"}

    if "áudio" in low or "audio" in low:
        phone_match = re.search(r"\b55\d{10,11}\b", normalize_phone(raw))
        phone = phone_match.group(0) if phone_match else ""
        return {"action": "audio", "phone": phone, "objective": raw}

    # LLM intent parser
    system = (
        "Converta a mensagem do dono em JSON para um assistente WhatsApp. "
        "Acoes validas: open, draft, audio, send, chat. "
        "Retorne APENAS JSON com campos: action, phone(opcional), objective(opcional), draft_id(opcional), reply(opcional)."
    )
    parsed = await chat_completion(
        [{"role": "system", "content": system}, {"role": "user", "content": raw}],
        model=settings.ASSISTANT_CHAT_MODEL or settings.MODEL_CHAT_SMART,
        temperature=0.1,
        max_tokens=220,
    )

    # best effort JSON parsing
    m = re.search(r"\{.*\}", parsed, re.DOTALL)
    if m:
        import json
        try:
            data = json.loads(m.group(0))
            if isinstance(data, dict) and data.get("action"):
                if data.get("phone"):
                    data["phone"] = normalize_phone(str(data["phone"]))
                return data
        except Exception:
            pass

    return {"action": "chat", "reply": "Posso te ajudar com conversas em aberto, gerar resposta para cliente, roteiro de áudio e envio. Me diga o número do cliente e o objetivo."}
