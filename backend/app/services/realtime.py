import asyncio
import logging
from collections import defaultdict
from datetime import datetime
from uuid import UUID

from fastapi import WebSocket

from app.models import Contact, Message

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[UUID | None, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket, contact_id: UUID | None = None) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections[contact_id].add(websocket)

    async def disconnect(self, websocket: WebSocket, contact_id: UUID | None = None) -> None:
        async with self._lock:
            sockets = self._connections.get(contact_id)
            if not sockets:
                return
            sockets.discard(websocket)
            if not sockets:
                self._connections.pop(contact_id, None)

    async def broadcast(self, payload: dict, contact_id: UUID | None = None) -> None:
        targets: set[WebSocket] = set()
        async with self._lock:
            targets.update(self._connections.get(None, set()))
            if contact_id is not None:
                targets.update(self._connections.get(contact_id, set()))

        stale: list[WebSocket] = []
        for websocket in targets:
            try:
                await websocket.send_json(payload)
            except Exception:
                stale.append(websocket)

        for websocket in stale:
            await self._purge_socket(websocket)

    async def _purge_socket(self, websocket: WebSocket) -> None:
        async with self._lock:
            empty_keys: list[UUID | None] = []
            for key, sockets in self._connections.items():
                sockets.discard(websocket)
                if not sockets:
                    empty_keys.append(key)
            for key in empty_keys:
                self._connections.pop(key, None)


manager = ConnectionManager()


def serialize_message(message: Message, contact: Contact, project_name: str | None = None) -> dict:
    return {
        "id": str(message.id),
        "contact_id": str(message.contact_id),
        "remote_jid": message.remote_jid,
        "direction": message.direction,
        "message_type": message.message_type,
        "content": message.content,
        "transcription": message.transcription,
        "media_url": message.media_url,
        "media_local_path": message.media_local_path,
        "media_mimetype": message.media_mimetype,
        "media_duration_seconds": message.media_duration_seconds,
        "quoted_message_id": str(message.quoted_message_id) if message.quoted_message_id else None,
        "evolution_message_id": message.evolution_message_id,
        "raw_payload": message.raw_payload,
        "processed": message.processed,
        "project_id": str(message.project_id) if message.project_id else None,
        "timestamp": message.timestamp.isoformat(),
        "created_at": message.created_at.isoformat() if message.created_at else None,
        "contact_name": contact.name or contact.push_name or contact.phone,
        "contact_phone": contact.phone,
        "project_name": project_name,
    }


async def broadcast_message_event(
    message: Message,
    contact: Contact,
    project_name: str | None = None,
) -> None:
    await manager.broadcast(
        {
            "type": "message.created",
            "contact_id": str(contact.id),
            "contact": {
                "id": str(contact.id),
                "name": contact.name or contact.push_name or contact.phone,
                "phone": contact.phone,
                "project_id": str(contact.project_id) if contact.project_id else None,
                "project_name": project_name,
                "profile_pic_url": contact.profile_pic_url,
                "pipeline_stage": contact.pipeline_stage or "lead",
                "unread_count": contact.unread_count or 0,
                "last_message_preview": contact.last_message_preview,
                "last_message_at": (
                    contact.last_message_at.isoformat()
                    if isinstance(contact.last_message_at, datetime)
                    else None
                ),
            },
            "message": serialize_message(message, contact, project_name),
        },
        contact_id=contact.id,
    )
