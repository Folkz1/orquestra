"""
Orquestra - Webhook Router
Receives Evolution API webhook events and processes WhatsApp messages.
"""

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session, get_db
from app.models import AssistantDraft, Contact, Message, Project
from app.services.media import download_media_from_evolution, save_media
from app.services.memory import store_memory
from app.services.assistant import (
    generate_reply_draft,
    generate_voice_script,
    get_or_create_contact_by_phone,
    is_owner_phone,
    list_open_threads,
    parse_owner_command,
    parse_owner_natural_message,
    owner_chat_reply,
    send_draft,
    get_recent_messages_for_target,
)
from app.services.whatsapp import send_whatsapp_message
from app.config import settings
from app.services.transcriber import describe_image, transcribe_audio

logger = logging.getLogger(__name__)

router = APIRouter()


# Map Evolution message types to our simplified types
MESSAGE_TYPE_MAP = {
    "conversation": "text",
    "extendedTextMessage": "text",
    "audioMessage": "audio",
    "imageMessage": "image",
    "videoMessage": "video",
    "documentMessage": "document",
    "stickerMessage": "sticker",
    "documentWithCaptionMessage": "document",
    "viewOnceMessageV2": "image",
}


def _extract_phone(remote_jid: str) -> str:
    """Extract phone number from WhatsApp JID (strip @s.whatsapp.net or @g.us)."""
    return remote_jid.split("@")[0]


def _is_group(remote_jid: str) -> bool:
    """Check if JID is a group."""
    return "@g.us" in remote_jid


def _extract_content(message_data: dict, message_type: str) -> str | None:
    """Extract text content from message payload based on type."""
    if message_type == "conversation":
        return message_data.get("conversation", "")
    if message_type == "extendedTextMessage":
        return message_data.get("extendedTextMessage", {}).get("text", "")
    if message_type == "imageMessage":
        return message_data.get("imageMessage", {}).get("caption", "")
    if message_type == "videoMessage":
        return message_data.get("videoMessage", {}).get("caption", "")
    if message_type == "documentMessage":
        return message_data.get("documentMessage", {}).get("fileName", "")
    if message_type == "documentWithCaptionMessage":
        inner = message_data.get("documentWithCaptionMessage", {}).get("message", {})
        return inner.get("documentMessage", {}).get("caption", "")
    if message_type == "viewOnceMessageV2":
        inner = message_data.get("viewOnceMessageV2", {}).get("message", {})
        return inner.get("imageMessage", {}).get("caption", "")
    return None


def _extract_mimetype(message_data: dict, message_type: str) -> str | None:
    """Extract mimetype from media message."""
    type_key = message_type
    if type_key in message_data and isinstance(message_data[type_key], dict):
        return message_data[type_key].get("mimetype")
    return None


def _extract_duration(message_data: dict, message_type: str) -> int | None:
    """Extract duration (seconds) from audio/video messages."""
    type_key = message_type
    if type_key in message_data and isinstance(message_data[type_key], dict):
        return message_data[type_key].get("seconds")
    return None


async def _upsert_contact(
    db: AsyncSession,
    phone: str,
    push_name: str | None,
    is_group: bool,
) -> Contact:
    """Find or create a contact by phone number."""
    stmt = select(Contact).where(Contact.phone == phone)
    result = await db.execute(stmt)
    contact = result.scalar_one_or_none()

    if contact:
        # Update push_name if provided and different
        if push_name and push_name != contact.push_name:
            contact.push_name = push_name
            if not contact.name:
                contact.name = push_name
        return contact

    # Create new contact
    contact = Contact(
        phone=phone,
        push_name=push_name,
        name=push_name,
        is_group=is_group,
    )
    db.add(contact)
    await db.flush()
    await db.refresh(contact)
    logger.info("[WEBHOOK] Created new contact: %s (%s)", phone, push_name)
    return contact


async def _auto_associate_project(
    db: AsyncSession,
    contact: Contact,
    content: str | None,
) -> uuid.UUID | None:
    """
    Auto-associate a message to a project.
    First checks contact's project, then keyword matching.
    """
    # If contact already has a project, use it
    if contact.project_id:
        return contact.project_id

    if not content:
        return None

    # Keyword match against active projects
    stmt = select(Project).where(Project.status == "active")
    result = await db.execute(stmt)
    projects = result.scalars().all()

    content_lower = content.lower()
    for project in projects:
        if project.keywords:
            for keyword in project.keywords:
                if keyword.lower() in content_lower:
                    logger.info(
                        "[WEBHOOK] Auto-associated message to project '%s' via keyword '%s'",
                        project.name,
                        keyword,
                    )
                    return project.id

    return None


async def _store_message_memory(
    db: AsyncSession, message_id: str, content: str, contact_name: str | None
):
    """Store a processed message in vector memory (within an existing session)."""
    try:
        if content and len(content.strip()) > 10:
            await store_memory(
                db,
                content=content,
                source_type="message",
                source_id=message_id,
                contact_name=contact_name,
                metadata={"origin": "whatsapp"},
            )
    except Exception as exc:
        logger.error("[WEBHOOK] Failed to store message memory: %s", exc)


async def _store_text_message_memory(
    message_id: str, content: str, contact_name: str | None
):
    """Background task: store a text message in vector memory with its own session."""
    async with async_session() as db:
        try:
            await _store_message_memory(db, message_id, content, contact_name)
            await db.commit()
        except Exception as exc:
            logger.error("[WEBHOOK] Failed to store text message memory: %s", exc)
            await db.rollback()


async def process_media(
    message_id: str,
    evolution_msg_id: str,
    msg_type: str,
    raw_payload: dict | None = None,
):
    """
    Background task: download media from Evolution, save to disk,
    transcribe (audio) or describe (image), and update the message.

    Uses its own database session since this runs outside the request lifecycle.
    """
    async with async_session() as db:
        try:
            # Fetch the message by UUID
            stmt = select(Message).where(Message.id == message_id)
            result = await db.execute(stmt)
            message = result.scalar_one_or_none()

            if not message:
                logger.error("[WEBHOOK] Message %s not found for media processing", message_id)
                return

            # Get contact name for memory storage
            contact_name = None
            if message.contact_id:
                contact_stmt = select(Contact.name, Contact.push_name).where(
                    Contact.id == message.contact_id
                )
                contact_result = await db.execute(contact_stmt)
                contact_row = contact_result.first()
                if contact_row:
                    contact_name = contact_row.name or contact_row.push_name

            # Try to get media bytes - prefer inline base64 from webhook payload
            media_bytes = None

            # 1) Check if base64 is already in the webhook payload
            if raw_payload:
                inline_b64 = raw_payload.get("data", {}).get("message", {}).get("base64")
                if inline_b64:
                    import base64 as b64mod
                    if "," in inline_b64:
                        inline_b64 = inline_b64.split(",", 1)[1]
                    media_bytes = b64mod.b64decode(inline_b64)
                    logger.info("[WEBHOOK] Got media from inline base64 (%d bytes)", len(media_bytes))

            # 2) Fallback: download from Evolution API
            if not media_bytes:
                media_bytes = await download_media_from_evolution(
                    evolution_msg_id, raw_payload
                )

            # Determine file extension
            ext_map = {
                "audio": ".ogg",
                "image": ".jpg",
                "video": ".mp4",
                "document": ".pdf",
                "sticker": ".webp",
            }
            ext = ext_map.get(msg_type, ".bin")
            filename = f"{msg_type}_{message_id}{ext}"

            # Save to disk
            file_path = await save_media(media_bytes, filename)
            message.media_local_path = file_path

            # Process based on type
            if msg_type == "audio":
                try:
                    transcription = await transcribe_audio(file_path)
                    message.transcription = transcription
                    message.processed = True
                    logger.info("[WEBHOOK] Audio transcribed: %s", message_id)

                    # Store transcription in vector memory
                    await _store_message_memory(
                        db, str(message.id), transcription, contact_name
                    )
                except Exception as exc:
                    logger.error("[WEBHOOK] Audio transcription failed: %s", exc)
                    message.processed = False

            elif msg_type == "image":
                try:
                    mimetype = message.media_mimetype or "image/jpeg"
                    description = await describe_image(media_bytes, mimetype)
                    message.transcription = description
                    message.processed = True
                    logger.info("[WEBHOOK] Image described: %s", message_id)

                    # Store image description in vector memory
                    await _store_message_memory(
                        db, str(message.id), description, contact_name
                    )
                except Exception as exc:
                    logger.error("[WEBHOOK] Image description failed: %s", exc)
                    message.processed = False
            else:
                # For video/document/sticker, just mark as processed after saving
                message.processed = True

            await db.commit()

        except Exception as exc:
            logger.error("[WEBHOOK] Media processing failed for %s: %s", message_id, exc)
            await db.rollback()


@router.post("/evolution")
async def evolution_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """
    Receive Evolution API webhook events.
    Only processes 'messages.upsert' events.
    """
    payload = await request.json()

    # Evolution sends event type in the payload
    event = payload.get("event")
    instance_name = payload.get("instance", "unknown")
    server_url = payload.get("server_url", "unknown")
    logger.info("[WEBHOOK] Event: %s from instance=%s server=%s", event, instance_name, server_url)

    if event != "messages.upsert":
        logger.debug("[WEBHOOK] Ignoring event: %s", event)
        return {"status": "ignored"}

    data = payload.get("data", {})
    key = data.get("key", {})
    message_data = data.get("message", {})

    # Extract fields
    remote_jid = key.get("remoteJid", "")
    from_me = key.get("fromMe", False)
    evolution_msg_id = key.get("id", "")
    push_name = data.get("pushName")
    message_timestamp = data.get("messageTimestamp")

    if not remote_jid:
        logger.warning("[WEBHOOK] No remoteJid in payload")
        return {"status": "error"}

    # Parse phone and group status
    phone = _extract_phone(remote_jid)
    group = _is_group(remote_jid)

    # Determine message type
    raw_type = data.get("messageType", "")
    # Also check for message keys as fallback
    if not raw_type:
        for key_name in MESSAGE_TYPE_MAP:
            if key_name in message_data:
                raw_type = key_name
                break

    simplified_type = MESSAGE_TYPE_MAP.get(raw_type, "text")

    # Extract content
    content = _extract_content(message_data, raw_type)
    mimetype = _extract_mimetype(message_data, raw_type)
    duration = _extract_duration(message_data, raw_type)

    # Parse timestamp
    if message_timestamp:
        try:
            ts = datetime.fromtimestamp(int(message_timestamp), tz=timezone.utc)
        except (ValueError, TypeError, OSError):
            ts = datetime.now(timezone.utc)
    else:
        ts = datetime.now(timezone.utc)

    # Upsert contact
    contact = await _upsert_contact(db, phone, push_name, group)

    # Owner assistant mode (natural language + /assist).
    # IMPORTANT: in some Evolution setups, owner messages can arrive as incoming (from_me=False).
    owner_text_message = (
        simplified_type == "text"
        and bool(content)
        and bool(settings.OWNER_WHATSAPP)
        and is_owner_phone(phone)
        and not group
    )
    if owner_text_message:

        # Natural language is the primary mode; /assist is only fallback.
        cmd = await parse_owner_natural_message(content)
        if not cmd or not cmd.get("action") or cmd.get("action") == "chat":
            slash_cmd = await parse_owner_command(content)
            if slash_cmd:
                cmd = slash_cmd

        if cmd:
            try:
                if cmd["action"] == "help":
                    help_txt = (
                        "Assistente Orquestra\n"
                        "Comandos:\n"
                        "/assist open\n"
                        "/assist draft <telefone> | <objetivo>\n"
                        "/assist audio <telefone> | <objetivo>\n"
                        "/assist send <draft_id>"
                    )
                    await send_whatsapp_message(phone, help_txt)
                    return {"status": "owner_command"}

                if cmd["action"] == "open":
                    pending = await list_open_threads(db, limit=12)
                    if not pending:
                        await send_whatsapp_message(phone, "Sem conversas em aberto agora ✅")
                        return {"status": "owner_command"}

                    lines = ["Mensagens em aberto (clientes):"]
                    for i, item in enumerate(pending, 1):
                        lines.append(f"{i}. {item['name']} ({item['phone']}) - {item['preview']}")
                    lines.append("\nUse: /assist draft <telefone> | <objetivo>")
                    await send_whatsapp_message(phone, "\n".join(lines)[:3900])
                    return {"status": "owner_command"}

                if cmd["action"] == "draft":
                    if not cmd.get("phone"):
                        await send_whatsapp_message(phone, "Me manda o número do cliente com DDI (ex: 5551999998888) para eu gerar o rascunho.")
                        return {"status": "owner_command"}
                    target = await get_or_create_contact_by_phone(db, cmd["phone"])
                    draft = await generate_reply_draft(db, target, cmd.get("objective"))
                    await db.commit()

                    preview = (
                        f"Rascunho #{draft.id} para {target.name or target.push_name or target.phone}:\n\n"
                        f"{draft.draft_text[:1200]}\n\n"
                        f"Para enviar: /assist send {draft.id}"
                    )
                    await send_whatsapp_message(phone, preview)
                    return {"status": "owner_command"}

                if cmd["action"] == "audio":
                    if not cmd.get("phone"):
                        await send_whatsapp_message(phone, "Me manda o número do cliente com DDI para eu montar o roteiro de áudio.")
                        return {"status": "owner_command"}
                    target = await get_or_create_contact_by_phone(db, cmd["phone"])
                    script = await generate_voice_script(db, target, cmd.get("objective") or "")
                    msg = (
                        f"Roteiro de áudio para {target.name or target.push_name or target.phone}:\n\n"
                        f"{script[:1500]}\n\n"
                        "Se quiser texto em vez de áudio: /assist draft <telefone> | <objetivo>"
                    )
                    await send_whatsapp_message(phone, msg)
                    return {"status": "owner_command"}

                if cmd["action"] == "send":
                    draft_id = (cmd.get("draft_id") or "").strip()
                    if not draft_id:
                        await send_whatsapp_message(
                            phone,
                            "Para enviar, me passe o ID do rascunho. Ex.: /assist send <draft_id>",
                        )
                        return {"status": "owner_command"}

                    draft = await db.get(AssistantDraft, draft_id)
                    if not draft:
                        await send_whatsapp_message(phone, "Draft nao encontrado.")
                        return {"status": "owner_command"}

                    ok = await send_draft(db, draft)
                    await db.commit()
                    txt = "Mensagem enviada ✅" if ok else "Falha ao enviar mensagem."
                    await send_whatsapp_message(phone, txt)
                    return {"status": "owner_command"}

                if cmd["action"] == "history":
                    target = (cmd.get("target") or "").strip()
                    limit = int(cmd.get("limit") or 10)
                    if not target:
                        await send_whatsapp_message(phone, "Me diz de quem você quer o histórico (nome ou número).")
                        return {"status": "owner_command"}

                    contact_target, msgs = await get_recent_messages_for_target(db, target, limit=limit)
                    if not contact_target:
                        await send_whatsapp_message(phone, f"Não encontrei esse contato: {target}.")
                        return {"status": "owner_command"}

                    if not msgs:
                        await send_whatsapp_message(
                            phone,
                            f"Não achei mensagens recentes de {contact_target.name or contact_target.push_name or contact_target.phone}.",
                        )
                        return {"status": "owner_command"}

                    lines = [f"Últimas {len(msgs)} mensagens de {contact_target.name or contact_target.push_name or contact_target.phone}:"]
                    for m in msgs:
                        who = "Cliente" if m.direction == "incoming" else "Você"
                        text = (m.content or m.transcription or "").strip()
                        if not text:
                            text = f"[{m.message_type}]"
                        ts = m.timestamp.strftime("%d/%m %H:%M") if m.timestamp else "--"
                        lines.append(f"[{ts}] {who}: {text[:180]}")

                    await send_whatsapp_message(phone, "\n".join(lines)[:3900])
                    return {"status": "owner_command"}

                if cmd["action"] == "chat":
                    reply = cmd.get("reply") or await owner_chat_reply(db, content, contact.id)
                    await send_whatsapp_message(phone, reply[:3500])
                    return {"status": "owner_command"}
            except Exception as exc:
                logger.error("[WEBHOOK] owner command failed: %s", exc)
                await db.rollback()
                await send_whatsapp_message(phone, "Deu um erro aqui para processar isso. Me manda de novo em uma frase que eu resolvo agora.")
                return {"status": "owner_command_error"}

    # Auto-associate project
    project_id = await _auto_associate_project(db, contact, content)

    # Determine direction
    direction = "outgoing" if from_me else "incoming"

    # Determine if this needs background processing
    needs_media_processing = simplified_type in ("audio", "image", "video", "document")
    processed = not needs_media_processing  # text/sticker = True immediately

    # Check for duplicate (by evolution_message_id)
    if evolution_msg_id:
        dup_stmt = select(Message).where(Message.evolution_message_id == evolution_msg_id)
        dup_result = await db.execute(dup_stmt)
        if dup_result.scalar_one_or_none():
            logger.debug("[WEBHOOK] Duplicate message ignored: %s", evolution_msg_id)
            return {"status": "duplicate"}

    # Create message
    msg = Message(
        contact_id=contact.id,
        remote_jid=remote_jid,
        direction=direction,
        message_type=simplified_type,
        content=content,
        media_mimetype=mimetype,
        media_duration_seconds=duration,
        evolution_message_id=evolution_msg_id,
        raw_payload=payload,
        processed=processed,
        project_id=project_id,
        timestamp=ts,
    )
    db.add(msg)
    await db.flush()
    await db.refresh(msg)

    logger.info(
        "[WEBHOOK] Saved message: %s %s from %s (type=%s, processed=%s)",
        direction,
        simplified_type,
        phone,
        raw_type,
        processed,
    )

    # Schedule background media processing if needed
    if needs_media_processing and evolution_msg_id:
        background_tasks.add_task(
            process_media,
            str(msg.id),
            evolution_msg_id,
            simplified_type,
            payload,
        )

    # Store text messages in vector memory (background task) - skip ignored contacts
    is_ignored = getattr(contact, 'ignored', False)
    if processed and content and len(content.strip()) > 10 and not is_ignored:
        contact_display = contact.name or contact.push_name or phone
        background_tasks.add_task(
            _store_text_message_memory,
            str(msg.id),
            content,
            contact_display,
        )

    return {"status": "ok"}
