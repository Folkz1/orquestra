from datetime import datetime

from app.models import Contact, Message


def build_message_preview(message_type: str, content: str | None, transcription: str | None) -> str:
    text = (content or transcription or "").strip()
    if text:
        return text[:180]

    labels = {
        "audio": "[AUDIO]",
        "image": "[IMAGEM]",
        "video": "[VIDEO]",
        "document": "[DOCUMENTO]",
        "sticker": "[FIGURINHA]",
    }
    return labels.get(message_type, "[MENSAGEM]")


def update_contact_chat_state(contact: Contact, message: Message, timestamp: datetime) -> None:
    contact.last_message_at = timestamp
    contact.last_message_preview = build_message_preview(
        message.message_type,
        message.content,
        message.transcription,
    )

    if message.direction == "incoming":
        contact.unread_count = (contact.unread_count or 0) + 1
    else:
        contact.last_contacted_at = timestamp
