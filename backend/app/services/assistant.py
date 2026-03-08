"""Owner-controlled WhatsApp assistant (draft-first)."""

from __future__ import annotations

import logging
import re
import unicodedata
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import AssistantDraft, Contact, Message
from app.services.llm import chat_completion
from app.services.memory import search_memory
from app.services.whatsapp import send_whatsapp_message

logger = logging.getLogger(__name__)


def normalize_phone(phone: str) -> str:
    return re.sub(r"\D", "", phone or "")


def normalize_text(text: str) -> str:
    text = (text or "").strip().lower()
    text = "".join(ch for ch in unicodedata.normalize("NFD", text) if unicodedata.category(ch) != "Mn")
    return re.sub(r"\s+", " ", text)


def is_owner_phone(phone: str) -> bool:
    if not settings.OWNER_WHATSAPP:
        return False
    return normalize_phone(phone) == normalize_phone(settings.OWNER_WHATSAPP)


def _assistant_model() -> str:
    # Keep owner assistant on configured model (default: Grok) as requested.
    return settings.ASSISTANT_CHAT_MODEL or settings.MODEL_CHAT_SMART


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


async def _build_conversation_context(db: AsyncSession, contact_id: UUID, limit: int | None = None) -> str:
    # 30 turns ~= up to 60 messages (incoming+outgoing)
    msg_limit = limit or max(10, settings.ASSISTANT_CONTEXT_TURNS * 2)
    stmt = (
        select(Message)
        .where(Message.contact_id == contact_id)
        .order_by(desc(Message.timestamp))
        .limit(msg_limit)
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


async def _build_semantic_context(
    db: AsyncSession,
    contact_id: UUID,
    objective: str,
    conversation: str,
    limit: int = 8,
) -> tuple[str, int]:
    # Hybrid retrieval query: objective + tail of recent conversation.
    query = f"{objective}\n\n{conversation[-700:]}".strip()
    memories = await search_memory(
        db,
        query=query,
        limit=limit,
        source_type="message",
        contact_id=contact_id,
    )

    if not memories:
        return "", 0

    lines = ["MEMÓRIA SEMÂNTICA DO CONTATO (trechos relevantes):"]
    for i, mem in enumerate(memories, 1):
        sim = mem.get("similarity", 0.0)
        text = (mem.get("summary") or mem.get("content") or "").strip()
        if not text:
            continue
        lines.append(f"{i}. ({sim:.0%}) {text[:320]}")

    block = "\n".join(lines)
    return block, len(memories)


async def generate_reply_draft(
    db: AsyncSession,
    contact: Contact,
    objective: str | None = None,
) -> AssistantDraft:
    style_examples = await _build_style_examples(db, contact.id)
    conversation = await _build_conversation_context(db, contact.id)

    style_block = "\n".join(f"- {x}" for x in style_examples[:12]) or "- Seja direto e profissional."
    objective = (objective or "Responder a última demanda do cliente com clareza e próximo passo.").strip()
    semantic_context, semantic_count = await _build_semantic_context(db, contact.id, objective, conversation)

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
        f"{semantic_context}\n\n"
        "Escreva uma resposta curta (até ~6 linhas), com opção de fechamento comercial quando fizer sentido."
    )

    draft_text = await chat_completion(
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        model=_assistant_model(),
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
            "semantic_memories_count": semantic_count,
            "generated_from": "conversation+semantic_memory+owner_style",
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
    ], model=_assistant_model(), temperature=0.4, max_tokens=400)).strip()


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


async def get_recent_messages_for_target(
    db: AsyncSession,
    target: str,
    limit: int = 10,
) -> tuple[Contact | None, list[Message]]:
    target_raw = (target or "").strip()
    if not target_raw:
        return None, []

    digits = normalize_phone(target_raw)
    contact = None

    if len(digits) >= 10:
        stmt = select(Contact).where(Contact.phone == digits)
        contact = (await db.execute(stmt)).scalar_one_or_none()

    if contact is None:
        like = f"%{target_raw}%"
        stmt = (
            select(Contact)
            .where(
                or_(
                    Contact.name.ilike(like),
                    Contact.push_name.ilike(like),
                    Contact.phone.ilike(like),
                )
            )
            .order_by(desc(Contact.updated_at))
            .limit(1)
        )
        contact = (await db.execute(stmt)).scalar_one_or_none()

    if contact is None:
        # Accent-insensitive fallback (e.g., "Emilio" -> "Emílio")
        n_target = normalize_text(target_raw)
        c_stmt = (
            select(Contact)
            .where(Contact.is_group.is_(False))
            .order_by(desc(Contact.updated_at))
            .limit(500)
        )
        candidates = (await db.execute(c_stmt)).scalars().all()
        for c in candidates:
            blob = " ".join([
                normalize_text(c.name or ""),
                normalize_text(c.push_name or ""),
                normalize_phone(c.phone or ""),
            ])
            if n_target and n_target in blob:
                contact = c
                break

    if contact is None:
        return None, []

    msg_stmt = (
        select(Message)
        .where(Message.contact_id == contact.id)
        .order_by(desc(Message.timestamp))
        .limit(max(1, min(limit, 30)))
    )
    msgs = (await db.execute(msg_stmt)).scalars().all()
    msgs.reverse()
    return contact, msgs


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


async def _build_owner_recent_context(db: AsyncSession, owner_contact_id: UUID | None, limit: int = 20) -> str:
    if not owner_contact_id:
        return ""

    stmt = (
        select(Message)
        .where(Message.contact_id == owner_contact_id)
        .order_by(desc(Message.timestamp))
        .limit(max(1, min(limit, 50)))
    )
    rows = (await db.execute(stmt)).scalars().all()
    rows.reverse()

    lines: list[str] = []
    for m in rows:
        text = (m.content or m.transcription or "").strip()
        if not text:
            continue
        who = "DIEGO" if m.direction == "incoming" else "ASSISTENTE"
        lines.append(f"[{who}] {text}")

    return "\n".join(lines)


async def owner_chat_reply(db: AsyncSession, text: str, owner_contact_id: UUID | None = None) -> str:
    pending = await list_open_threads(db, limit=8)
    lines = []
    for i, item in enumerate(pending, 1):
        lines.append(f"{i}. {item['name']} ({item['phone']}): {item['preview']}")
    pending_block = "\n".join(lines) if lines else "Sem conversas em aberto no momento."

    system = (
        "Você é o assistente pessoal e comercial do Diego no WhatsApp. "
        "Fale em português BR, com tom humano, natural, direto e contextual. "
        "Você NÃO fala como sistema, não expõe bastidores, não cita parser/JSON/comando/action/endpoints. "
        "Entenda intenção antes de processo. Ferramentas ficam invisíveis; entregue resultado útil em linguagem de gente. "
        "Mantenha continuidade da conversa (não trate cada mensagem como assunto novo quando for continuação). "
        "Quando fizer sentido, sugira texto pronto e opção de áudio de forma natural. "
        "Só peça confirmação quando houver risco real de envio/ação errada."
    )
    owner_recent = await _build_owner_recent_context(db, owner_contact_id, limit=20)

    user = (
        f"Mensagem do Diego: {text}\n\n"
        f"Contexto recente da conversa com Diego (últimas 20 mensagens):\n{owner_recent or 'Sem contexto recente.'}\n\n"
        f"Conversas em aberto agora:\n{pending_block}\n\n"
        "Responda como um assistente humano de confiança, em no máximo 12 linhas, "
        "sem linguagem técnica e com próximo passo claro quando útil."
    )
    return (await chat_completion(
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        model=_assistant_model(),
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

    hist_match = re.search(r"ultim(?:a|as|o|os)\s+(\d{1,2})\s+mens", low)
    if hist_match:
        n = int(hist_match.group(1))
        target_match = re.search(r"d[oa]\s+(.+)$", raw, re.IGNORECASE)
        target = (target_match.group(1).strip() if target_match else "")
        return {"action": "history", "limit": max(1, min(n, 30)), "target": target}

    # LLM intent parser
    system = (
        "Classifique a intenção da mensagem do dono para roteamento interno do assistente WhatsApp. "
        "Acoes validas: open, draft, audio, send, history, chat. "
        "Regra principal: se houver qualquer ambiguidade, escolha chat (conversa natural). "
        "Use send apenas se houver referência clara de envio + draft_id. "
        "Retorne APENAS JSON com campos: action, phone(opcional), objective(opcional), draft_id(opcional), reply(opcional)."
    )
    parsed = await chat_completion(
        [{"role": "system", "content": system}, {"role": "user", "content": raw}],
        model=_assistant_model(),
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

    return {
        "action": "chat",
        "reply": "Tô com você. Me fala em uma frase o que você quer destravar agora que eu te respondo do jeito mais direto.",
    }
