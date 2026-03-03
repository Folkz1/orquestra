"""
Orquestra - Orchestrator Service
Daily brief generation and Telegram notification.
"""

import logging
from datetime import datetime

import httpx
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Contact, DailyBrief, Message, Recording
from app.services.llm import chat_completion, _parse_json_response
from app.services.memory import get_context_for_brief

logger = logging.getLogger(__name__)

MAX_MESSAGES_PER_CONTACT = 50


async def generate_daily_brief(
    db: AsyncSession,
    date_from: datetime,
    date_to: datetime,
) -> dict:
    """
    Generate a daily brief for the given time period.

    1. Query messages grouped by contact
    2. Query recordings in the period
    3. Build context string
    4. Call LLM for structured analysis
    5. Save DailyBrief to database
    6. Return the brief data
    """
    # -- 1. Fetch messages in period, grouped by contact --
    stmt = (
        select(Message, Contact.name, Contact.push_name, Contact.phone)
        .join(Contact, Message.contact_id == Contact.id)
        .where(and_(Message.timestamp >= date_from, Message.timestamp <= date_to))
        .order_by(Message.timestamp.asc())
    )
    result = await db.execute(stmt)
    rows = result.all()

    # Group messages by contact
    contacts_messages: dict[str, list[dict]] = {}
    for msg, contact_name, push_name, phone in rows:
        display_name = contact_name or push_name or phone
        if display_name not in contacts_messages:
            contacts_messages[display_name] = []
        contacts_messages[display_name].append({
            "direction": msg.direction,
            "type": msg.message_type,
            "content": msg.content or "",
            "transcription": msg.transcription or "",
            "timestamp": msg.timestamp.isoformat() if msg.timestamp else "",
        })

    # -- 2. Fetch recordings in period --
    rec_stmt = (
        select(Recording)
        .where(and_(Recording.recorded_at >= date_from, Recording.recorded_at <= date_to))
        .order_by(Recording.recorded_at.asc())
    )
    rec_result = await db.execute(rec_stmt)
    recordings = rec_result.scalars().all()

    # -- 3. Build context string --
    context_parts = []
    total_messages = 0

    date_fmt = "%d/%m/%Y %H:%M"
    context_parts.append(
        f"=== BRIEFING DIARIO: {date_from.strftime(date_fmt)} "
        f"ate {date_to.strftime(date_fmt)} ==="
    )
    context_parts.append("")

    if contacts_messages:
        context_parts.append("--- CONVERSAS ---")
        for cname, msgs in contacts_messages.items():
            total_messages += len(msgs)
            display_msgs = msgs[:MAX_MESSAGES_PER_CONTACT]
            context_parts.append(f"\n[{cname}] ({len(msgs)} mensagens)")
            for m in display_msgs:
                direction = ">>>" if m["direction"] == "outgoing" else "<<<"
                text_content = m["content"] or m["transcription"] or f"[{m['type']}]"
                if len(text_content) > 500:
                    text_content = text_content[:500] + "..."
                context_parts.append(f"  {direction} {text_content}")
            if len(msgs) > MAX_MESSAGES_PER_CONTACT:
                context_parts.append(
                    f"  ... (+{len(msgs) - MAX_MESSAGES_PER_CONTACT} mensagens omitidas)"
                )
    else:
        context_parts.append("Nenhuma conversa no periodo.")

    context_parts.append("")

    if recordings:
        context_parts.append("--- GRAVACOES ---")
        for rec in recordings:
            title = rec.title or "Sem titulo"
            context_parts.append(f"\n[Gravacao: {title}]")
            if rec.transcription:
                rec_text = rec.transcription[:2000]
                if len(rec.transcription) > 2000:
                    rec_text += "..."
                context_parts.append(f"  Transcricao: {rec_text}")
            if rec.summary:
                context_parts.append(f"  Resumo: {str(rec.summary)[:500]}")
    else:
        context_parts.append("Nenhuma gravacao no periodo.")

    raw_context = "\n".join(context_parts)

    # -- 3b. Enrich with semantic memory context --
    try:
        memory_context = await get_context_for_brief(
            db, "projetos decisoes acoes pendentes progresso", limit=15
        )
        if memory_context:
            raw_context += "\n\n" + memory_context
    except Exception as exc:
        logger.warning("[ORCHESTRATOR] Could not fetch memory context: %s", exc)

    # -- 4. Call LLM --
    prompt_structure = (
        "Voce e o Jarbas, CTO virtual. Analise o contexto do dia e gere um "
        "briefing executivo em JSON com a seguinte estrutura:\n"
        "{\n"
        '  "summary": "Resumo executivo do dia em 3-5 paragrafos",\n'
        '  "pending_actions": [\n'
        '    {"action": "descricao", "priority": "high|medium|low", '
        '"contact": "nome ou null"}\n'
        "  ],\n"
        '  "decisions_made": [\n'
        '    {"decision": "descricao", "context": "contexto breve"}\n'
        "  ],\n"
        '  "key_insights": [\n'
        '    {"insight": "descricao", "relevance": "high|medium|low"}\n'
        "  ],\n"
        '  "projects_mentioned": ["projeto1", "projeto2"]\n'
        "}\n\n"
        "Foco em acoes concretas e decisoes importantes. "
        "Responda APENAS com o JSON."
    )

    llm_messages = [
        {"role": "system", "content": prompt_structure},
        {"role": "user", "content": raw_context},
    ]

    llm_response = await chat_completion(
        llm_messages, model=settings.MODEL_CHAT_SMART, temperature=0.2, max_tokens=4000
    )
    brief_data = _parse_json_response(llm_response)

    # -- 5. Save to database --
    total_recordings = len(recordings)

    daily_brief = DailyBrief(
        date=date_from.date(),
        period_start=date_from,
        period_end=date_to,
        total_messages=total_messages,
        total_recordings=total_recordings,
        summary=brief_data.get("summary", ""),
        pending_actions=brief_data.get("pending_actions", []),
        decisions_made=brief_data.get("decisions_made", []),
        key_insights=brief_data.get("key_insights", []),
        projects_mentioned=brief_data.get("projects_mentioned", []),
        raw_context=raw_context,
        model_used=settings.MODEL_CHAT_SMART,
        sent_telegram=False,
        sent_whatsapp=False,
    )
    db.add(daily_brief)
    await db.flush()
    await db.refresh(daily_brief)

    logger.info(
        "[ORCHESTRATOR] Generated daily brief id=%s, msgs=%d, recs=%d",
        daily_brief.id,
        total_messages,
        total_recordings,
    )

    # -- 6. Return --
    return {
        "id": str(daily_brief.id),
        "date": str(daily_brief.date),
        "period_start": daily_brief.period_start.isoformat(),
        "period_end": daily_brief.period_end.isoformat(),
        "total_messages": total_messages,
        "total_recordings": total_recordings,
        "summary": daily_brief.summary,
        "pending_actions": daily_brief.pending_actions,
        "decisions_made": daily_brief.decisions_made,
        "key_insights": daily_brief.key_insights,
        "projects_mentioned": daily_brief.projects_mentioned,
        "model_used": daily_brief.model_used,
    }


async def send_telegram_brief(brief_data: dict) -> bool:
    """
    Format and send a daily brief to Telegram.

    Args:
        brief_data: Dict containing the brief fields.

    Returns:
        True if sent successfully, False otherwise.
    """
    if not settings.TELEGRAM_BOT_TOKEN or not settings.TELEGRAM_CHAT_ID:
        logger.warning("[ORCHESTRATOR] Telegram not configured, skipping send")
        return False

    # Format Telegram message (Markdown)
    parts = []
    parts.append("*BRIEFING DIARIO - Jarbas*")
    period_start = brief_data.get("period_start", "?")
    period_end = brief_data.get("period_end", "?")
    parts.append(f"Periodo: {period_start} - {period_end}")
    total_msg = brief_data.get("total_messages", 0)
    total_rec = brief_data.get("total_recordings", 0)
    parts.append(f"Mensagens: {total_msg} | Gravacoes: {total_rec}")
    parts.append("")

    summary = brief_data.get("summary", "Sem resumo")
    parts.append(f"*Resumo:*\n{summary}")
    parts.append("")

    pending = brief_data.get("pending_actions", [])
    if pending:
        parts.append("*Acoes Pendentes:*")
        for item in pending[:10]:
            action = item.get("action", str(item)) if isinstance(item, dict) else str(item)
            priority = item.get("priority", "") if isinstance(item, dict) else ""
            marker_map = {"high": "!", "medium": "-", "low": "."}
            marker = marker_map.get(priority, "-")
            parts.append(f"  {marker} {action}")
        parts.append("")

    decisions = brief_data.get("decisions_made", [])
    if decisions:
        parts.append("*Decisoes:*")
        for item in decisions[:10]:
            decision = item.get("decision", str(item)) if isinstance(item, dict) else str(item)
            parts.append(f"  - {decision}")
        parts.append("")

    insights = brief_data.get("key_insights", [])
    if insights:
        parts.append("*Insights:*")
        for item in insights[:10]:
            insight = item.get("insight", str(item)) if isinstance(item, dict) else str(item)
            parts.append(f"  - {insight}")
        parts.append("")

    projects = brief_data.get("projects_mentioned", [])
    if projects:
        joined = ", ".join(projects)
        parts.append(f"*Projetos:* {joined}")

    text = "\n".join(parts)

    # Telegram has a 4096 char limit
    if len(text) > 4000:
        text = text[:3997] + "..."

    url = f"https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": settings.TELEGRAM_CHAT_ID,
        "text": text,
        "parse_mode": "Markdown",
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, json=payload)
            response.raise_for_status()
        logger.info("[ORCHESTRATOR] Telegram brief sent successfully")
        return True
    except Exception as exc:
        logger.error("[ORCHESTRATOR] Failed to send Telegram brief: %s", exc)
        return False
