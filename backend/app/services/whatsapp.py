"""
Orquestra - WhatsApp Service
Send messages via Evolution API with Brazilian phone number fallback.
"""

import logging
import re

import httpx
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Contact, Message

logger = logging.getLogger(__name__)


def _load_instances_config() -> dict:
    """Parse EVOLUTION_INSTANCES JSON once per call site."""
    if settings.EVOLUTION_INSTANCES:
        try:
            import json
            instances = json.loads(settings.EVOLUTION_INSTANCES) if isinstance(
                settings.EVOLUTION_INSTANCES, str
            ) else settings.EVOLUTION_INSTANCES
            if isinstance(instances, dict):
                return instances
        except Exception:
            pass
    return {}


def _resolve_instance_config(
    instance_name: str | None,
    base_url: str | None = None,
) -> tuple[str, str]:
    """Resolve API key + base URL for a given instance."""
    resolved_base_url = (base_url or settings.EVOLUTION_API_URL or "").rstrip("/")
    instances = _load_instances_config()
    entry = instances.get(instance_name or "")

    if isinstance(entry, dict):
        api_key = (
            entry.get("apikey")
            or entry.get("api_key")
            or settings.EVOLUTION_API_KEY
        )
        resolved_base_url = (
            entry.get("url")
            or entry.get("server_url")
            or resolved_base_url
        )
        return api_key, (resolved_base_url or "").rstrip("/")

    if isinstance(entry, str):
        return entry, resolved_base_url

    return settings.EVOLUTION_API_KEY, resolved_base_url


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
    base_url: str,
) -> tuple[bool, str | None]:
    """Send a single message attempt. Returns (success, error_message)."""
    url = f"{base_url.rstrip('/')}/message/sendText/{instance_name}"
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
    base_url: str | None = None,
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
    instance_name = instance or settings.EVOLUTION_INSTANCE
    if not instance_name:
        logger.warning("[WHATSAPP] No Evolution instance configured, skipping send")
        return False

    api_key, resolved_base_url = _resolve_instance_config(instance_name, base_url)
    if not api_key:
        logger.warning("[WHATSAPP] No Evolution API key configured, skipping send")
        return False
    if not resolved_base_url:
        logger.warning("[WHATSAPP] No Evolution base URL configured, skipping send")
        return False
    variants = _phone_variants(phone)

    for i, variant in enumerate(variants):
        success, error = await _send_single(
            variant,
            message,
            instance_name,
            api_key,
            resolved_base_url,
        )
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


def build_outbound_channel_payload(
    instance: str | None = None,
    base_url: str | None = None,
    source: str = "orquestra-outbound",
) -> dict:
    """Persist the channel used for outbound sends so future replies can reuse it."""
    payload: dict[str, str] = {"source": source}
    resolved_instance = (instance or settings.EVOLUTION_INSTANCE or "").strip()
    resolved_base_url = (base_url or settings.EVOLUTION_API_URL or "").strip()
    if resolved_instance:
        payload["instance"] = resolved_instance
    if resolved_base_url:
        payload["server_url"] = resolved_base_url.rstrip("/")
    return payload


def _extract_channel_from_payload(raw_payload: dict | None) -> tuple[str | None, str | None]:
    if not isinstance(raw_payload, dict):
        return None, None

    instance = raw_payload.get("instance")
    if not isinstance(instance, str):
        instance = None
    elif not instance.strip():
        instance = None
    else:
        instance = instance.strip()

    base_url = raw_payload.get("server_url")
    if not isinstance(base_url, str):
        base_url = None
    elif not base_url.strip():
        base_url = None
    else:
        base_url = base_url.strip().rstrip("/")

    return instance, base_url


async def resolve_contact_whatsapp_channel(
    db: AsyncSession,
    *,
    contact: Contact | None = None,
    phone: str | None = None,
) -> tuple[str | None, str | None]:
    """
    Reuse the last inbound/outbound Evolution channel seen for a contact.
    This keeps multi-instance contacts on the correct WhatsApp instance.
    """
    contact_id = getattr(contact, "id", None)
    normalized_phone = re.sub(r"\D", "", phone or "")

    if contact_id is None and normalized_phone:
        contact_id = await db.scalar(
            select(Contact.id).where(Contact.phone == normalized_phone)
        )

    if contact_id is None:
        return None, None

    stmt = (
        select(Message.raw_payload)
        .where(
            Message.contact_id == contact_id,
            Message.raw_payload.is_not(None),
        )
        .order_by(desc(Message.timestamp), desc(Message.created_at))
        .limit(20)
    )
    raw_payloads = (await db.execute(stmt)).scalars().all()
    for raw_payload in raw_payloads:
        instance_name, base_url = _extract_channel_from_payload(raw_payload)
        if instance_name or base_url:
            return instance_name, base_url

    return None, None


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
