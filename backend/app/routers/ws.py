import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import PushSubscription
from app.schemas import PushSubscriptionCreate, PushSubscriptionResponse
from app.services.realtime import manager

logger = logging.getLogger(__name__)

router = APIRouter()


@router.websocket("/ws/messages")
async def message_socket(websocket: WebSocket):
    token = websocket.query_params.get("token", "")
    contact_raw = websocket.query_params.get("contact_id")

    if settings.APP_SECRET_KEY and token != settings.APP_SECRET_KEY:
        await websocket.close(code=4403)
        return

    contact_id = UUID(contact_raw) if contact_raw else None
    await manager.connect(websocket, contact_id)

    try:
        while True:
            payload = await websocket.receive_json()
            if payload.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        await manager.disconnect(websocket, contact_id)
    except Exception as exc:
        logger.warning("[WS] socket error: %s", exc)
        await manager.disconnect(websocket, contact_id)


@router.post("/push-subscriptions", response_model=PushSubscriptionResponse)
async def upsert_push_subscription(
    data: PushSubscriptionCreate,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(PushSubscription).where(PushSubscription.endpoint == data.endpoint)
    result = await db.execute(stmt)
    subscription = result.scalar_one_or_none()

    now = datetime.now(timezone.utc)
    if subscription is None:
        subscription = PushSubscription(
            endpoint=data.endpoint,
            p256dh=data.p256dh,
            auth=data.auth,
            user_agent=data.user_agent,
            last_seen_at=now,
        )
        db.add(subscription)
    else:
        subscription.p256dh = data.p256dh
        subscription.auth = data.auth
        subscription.user_agent = data.user_agent
        subscription.last_seen_at = now

    await db.flush()
    await db.refresh(subscription)
    return subscription


@router.delete("/push-subscriptions", status_code=status.HTTP_204_NO_CONTENT)
async def delete_push_subscription(
    endpoint: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(PushSubscription).where(PushSubscription.endpoint == endpoint)
    result = await db.execute(stmt)
    subscription = result.scalar_one_or_none()
    if subscription is None:
        raise HTTPException(status_code=404, detail="Subscription not found")

    await db.delete(subscription)
