"""
Orquestra - WhatsApp Service
Send messages via Evolution API with Brazilian phone number fallback.
"""

import logging
import re

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


def _get_instance_key(instance_name: str) -> str:
    """Resolve API key for a given instance (supports multi-instance)."""
    if settings.EVOLUTION_INSTANCES:
        try:
            import json
            instances = json.loads(settings.EVOLUTION_INSTANCES) if isinstance(
                settings.EVOLUTION_INSTANCES, str
            ) else settings.EVOLUTION_INSTANCES
            if instance_name in instances:
                return instances[instance_name]
        except Exception:
            pass
    return settings.EVOLUTION_API_KEY


def _phone_variants(phone: str) -> list[str]:
    """
    Generate phone number variants for Brazilian numbers.
    Brazilian mobile: 55 + DDD(2) + 9 + 8 digits = 13 digits
    Brazilian landline: 55 + DDD(2) + 8 digits = 12 digits

    If number has 13 digits (with 9): try as-is, then without the 9
    If number has 12 digits (without 9): try as-is, then with the 9
    Non-BR numbers: return as-is only.
    """
    digits = re.sub(r'\D', '', phone)

    # Only apply logic to Brazilian numbers (start with 55)
    if not digits.startswith('55') or len(digits) < 12:
        return [digits]

    ddd = digits[2:4]
    rest = digits[4:]

    if len(digits) == 13 and rest.startswith('9'):
        # Has the 9 → try as-is, then without
        without_9 = f"55{ddd}{rest[1:]}"
        return [digits, without_9]
    elif len(digits) == 12 and not rest.startswith('9'):
        # Missing the 9 → try as-is, then with
        with_9 = f"55{ddd}9{rest}"
        return [digits, with_9]

    return [digits]


async def _send_single(
    phone: str,
    message: str,
    instance_name: str,
    api_key: str,
) -> tuple[bool, str | None]:
    """Send a single message attempt. Returns (success, error_message)."""
    url = f"{settings.EVOLUTION_API_URL}/message/sendText/{instance_name}"
    headers = {
        "apikey": api_key,
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
        return True, None
    except Exception as exc:
        return False, str(exc)


async def send_whatsapp_message(
    phone: str,
    message: str,
    instance: str | None = None,
) -> bool:
    """
    Send a WhatsApp text message via Evolution API.
    Automatically tries phone number variants (with/without digit 9)
    for Brazilian numbers if the first attempt fails.

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

    api_key = _get_instance_key(instance_name)
    variants = _phone_variants(phone)

    for i, variant in enumerate(variants):
        success, error = await _send_single(variant, message, instance_name, api_key)
        if success:
            if i > 0:
                logger.info(
                    "[WHATSAPP] Message sent to %s (fallback from %s) via %s",
                    variant, phone, instance_name,
                )
            else:
                logger.info(
                    "[WHATSAPP] Message sent to %s via %s", variant, instance_name,
                )
            return True
        else:
            logger.warning(
                "[WHATSAPP] Attempt %d/%d failed for %s: %s",
                i + 1, len(variants), variant, error,
            )

    logger.error(
        "[WHATSAPP] All attempts failed for %s (%d variants tried)",
        phone, len(variants),
    )
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
