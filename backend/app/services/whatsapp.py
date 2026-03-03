"""
Orquestra - WhatsApp Service
Send messages via Evolution API.
"""

import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


async def send_whatsapp_message(
    phone: str,
    message: str,
    instance: str | None = None,
) -> bool:
    """
    Send a WhatsApp text message via Evolution API.

    Args:
        phone: Phone number (digits only, with country code, e.g., "5551999998888").
        message: Text message to send.
        instance: Evolution API instance name (defaults to settings.EVOLUTION_INSTANCE).

    Returns:
        True if sent successfully, False otherwise.
    """
    if not settings.EVOLUTION_API_URL or not settings.EVOLUTION_API_KEY:
        logger.warning("[WHATSAPP] Evolution API not configured, skipping send")
        return False

    instance_name = instance or settings.EVOLUTION_INSTANCE
    if not instance_name:
        logger.warning("[WHATSAPP] No Evolution instance configured, skipping send")
        return False

    url = f"{settings.EVOLUTION_API_URL}/message/sendText/{instance_name}"
    headers = {
        "apikey": settings.EVOLUTION_API_KEY,
        "Content-Type": "application/json",
    }
    payload = {
        "number": phone,
        "text": message,
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, headers=headers, json=payload)
            response.raise_for_status()

        logger.info("[WHATSAPP] Message sent to %s via instance %s", phone, instance_name)
        return True

    except Exception as exc:
        logger.error("[WHATSAPP] Failed to send message to %s: %s", phone, exc)
        return False


async def send_content_brief_to_whatsapp(
    phone: str,
    brief: dict,
    instance: str | None = None,
) -> bool:
    """
    Format and send a content brief via WhatsApp.

    Args:
        phone: Phone number to send to.
        brief: Content brief dict from YouTube analysis.
        instance: Evolution API instance name.

    Returns:
        True if sent successfully, False otherwise.
    """
    # Format the brief for WhatsApp (plain text, no markdown)
    parts = []
    parts.append("*BRIEFING YOUTUBE - GuyFolkz*")
    parts.append("")

    # Video ideas
    video_ideas = brief.get("video_ideas", [])
    if video_ideas:
        parts.append("*IDEIAS DE VIDEO:*")
        parts.append("")
        for i, idea in enumerate(video_ideas, 1):
            title = idea.get("title", "Sem titulo")
            hook = idea.get("hook", "")
            urgency = idea.get("urgency", "medium")
            difficulty = idea.get("difficulty", "medium")
            cta = idea.get("cta_strategy", "")

            urgency_emoji = {"high": "!!!", "medium": "!!", "low": "!"}.get(urgency, "!")
            parts.append(f"{i}. {urgency_emoji} *{title}*")
            if hook:
                parts.append(f"   Hook: _{hook}_")
            parts.append(f"   Dificuldade: {difficulty} | Urgencia: {urgency}")
            if cta:
                parts.append(f"   CTA: {cta}")

            # Alternatives
            alts = idea.get("title_alternatives", [])
            if alts:
                parts.append(f"   Alternativas: {' | '.join(alts[:2])}")

            parts.append("")

    # Trends
    trends = brief.get("trends", [])
    if trends:
        parts.append("*TENDENCIAS:*")
        for trend in trends[:5]:
            topic = trend.get("topic", "?")
            heat = trend.get("heat_level", "?")
            source = trend.get("source", "?")
            parts.append(f"  - [{heat}] {topic} (via {source})")
        parts.append("")

    # Market insights
    insights = brief.get("market_insights", [])
    if insights:
        parts.append("*INSIGHTS:*")
        for insight in insights[:3]:
            parts.append(f"  - {insight}")
        parts.append("")

    parts.append("_Gerado por Jarbas - Orquestra_")

    message = "\n".join(parts)

    # WhatsApp has a message limit; split if needed
    if len(message) > 4000:
        message = message[:3997] + "..."

    return await send_whatsapp_message(phone, message, instance)
