"""Assistant endpoints: draft generation + approval/send."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import AssistantDraft, Contact
from app.schemas import (
    AssistantDraftGenerateRequest,
    AssistantDraftResponse,
)
from app.services.assistant import generate_reply_draft, get_or_create_contact_by_phone, list_open_threads, send_draft
from app.services.whatsapp import send_whatsapp_message

logger = logging.getLogger(__name__)

router = APIRouter()

STALE_STATE_PATH = Path("/tmp/orquestra_stale_30m_state.json")


def _load_stale_state() -> dict:
    if not STALE_STATE_PATH.exists():
        return {}
    try:
        return json.loads(STALE_STATE_PATH.read_text())
    except Exception:
        return {}


def _save_stale_state(state: dict) -> None:
    try:
        STALE_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        STALE_STATE_PATH.write_text(json.dumps(state, ensure_ascii=False))
    except Exception:
        logger.exception("[ASSISTANT] Failed to persist stale-watch state")


@router.post("/chat/stream")
async def proxy_stream_chat(request: Request):
    """Proxy the Jarbas AI Agent stream through Orquestra to avoid mobile CORS issues."""
    body = await request.json()
    upstream_url = f"{settings.JARBAS_AI_AGENT_URL.rstrip('/')}/api/chat"

    try:
        client = httpx.AsyncClient(timeout=None)
        request_stream = client.build_request("POST", upstream_url, json=body)
        upstream = await client.send(request_stream, stream=True)
    except Exception as exc:
        logger.exception("[ASSISTANT] Streaming proxy failed to connect")
        raise HTTPException(status_code=502, detail=f"Jarbas AI Agent indisponivel: {exc}") from exc

    if upstream.status_code >= 400:
        error_text = await upstream.aread()
        await upstream.aclose()
        await client.aclose()
        raise HTTPException(
            status_code=upstream.status_code,
            detail=error_text.decode("utf-8", errors="ignore") or "Jarbas AI Agent retornou erro",
        )

    async def iterate_stream():
        try:
            async for chunk in upstream.aiter_bytes():
                if chunk:
                    yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(
        iterate_stream(),
        media_type=upstream.headers.get("content-type", "text/plain; charset=utf-8"),
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/stale-watch")
async def stale_watch(
    min_minutes: int = Query(30, ge=1, le=1440),
    limit: int = Query(30, ge=1, le=100),
    top: int = Query(3, ge=1, le=10),
    notify_whatsapp: bool = Query(True, description="Send alert to OWNER_WHATSAPP when there are new alerts"),
    db: AsyncSession = Depends(get_db),
):
    """Return only NEW stale open threads (dedup by contact + last inbound timestamp)."""
    pending = await list_open_threads(db, limit=limit)
    now = datetime.now(timezone.utc)

    stale = []
    for item in pending:
        last_in = item.get("last_in")
        if not last_in:
            continue
        minutes = (now - last_in).total_seconds() / 60
        if minutes >= min_minutes:
            stale.append(item)

    stale_phones = {str(x.get("phone", "")) for x in stale if x.get("phone")}

    state = _load_stale_state()
    alerts = []
    for item in stale:
        phone = str(item.get("phone", ""))
        last_in = item.get("last_in")
        if not phone or not last_in:
            continue

        last_in_iso = last_in.isoformat()
        prev = state.get(phone) or {}
        if prev.get("last_in") != last_in_iso:
            alerts.append(item)

        state[phone] = {
            "last_in": last_in_iso,
            "last_alert_check_at": now.isoformat(),
        }

    # clean state for contacts no longer stale
    for phone in list(state.keys()):
        if phone not in stale_phones:
            state.pop(phone, None)

    _save_stale_state(state)

    alerts_sorted = sorted(alerts, key=lambda x: x["last_in"], reverse=True)
    stale_sorted = sorted(stale, key=lambda x: x["last_in"], reverse=True)

    def _to_payload(rows: list[dict]) -> list[dict]:
        data = []
        for r in rows:
            data.append({
                "phone": r.get("phone"),
                "name": r.get("name"),
                "last_in": r.get("last_in").isoformat() if r.get("last_in") else None,
                "preview": r.get("preview") or "",
            })
        return data

    payload = {
        "status": "sem-alerta" if not alerts_sorted else "alerta",
        "total_stale": len(stale_sorted),
        "new_alerts": len(alerts_sorted),
        "top_new": _to_payload(alerts_sorted[:top]),
        "top_stale": _to_payload(stale_sorted[:top]),
    }

    if notify_whatsapp and alerts_sorted:
        owner_phone = (settings.OWNER_WHATSAPP or "").strip()
        if owner_phone:
            lines = [
                "⚠️ Pendências >30min no WhatsApp",
                f"Total atrasadas: {payload['total_stale']}",
                f"Novos alertas: {payload['new_alerts']}",
                "",
            ]
            for i, item in enumerate(payload["top_new"], 1):
                lines.append(f"{i}) {item.get('name') or item.get('phone')} ({item.get('phone')})")
                if item.get("preview"):
                    lines.append(f"   {str(item['preview'])[:180]}")
            try:
                await send_whatsapp_message(owner_phone, "\n".join(lines)[:3900])
            except Exception:
                logger.exception("[ASSISTANT] Failed to send stale-watch WhatsApp alert")

    return payload


@router.post("/drafts/generate", response_model=AssistantDraftResponse)
async def generate_draft(
    payload: AssistantDraftGenerateRequest,
    db: AsyncSession = Depends(get_db),
):
    contact = None
    if payload.contact_id:
        contact = await db.get(Contact, payload.contact_id)
    elif payload.phone:
        contact = await get_or_create_contact_by_phone(db, payload.phone)

    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    draft = await generate_reply_draft(db, contact, payload.objective)

    if payload.send_now:
        ok = await send_draft(db, draft)
        if not ok:
            raise HTTPException(status_code=500, detail="Failed to send draft")

    await db.commit()
    await db.refresh(draft)
    return AssistantDraftResponse.model_validate(draft)


@router.get("/drafts", response_model=list[AssistantDraftResponse])
async def list_drafts(
    status: str | None = Query(None, description="generated|sent|discarded"),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(AssistantDraft).order_by(desc(AssistantDraft.created_at)).limit(limit)
    if status:
        stmt = stmt.where(AssistantDraft.status == status)
    rows = (await db.execute(stmt)).scalars().all()
    return [AssistantDraftResponse.model_validate(x) for x in rows]


@router.get("/open-threads")
async def open_threads(
    limit: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
):
    return await list_open_threads(db, limit=limit)


@router.post("/drafts/{draft_id}/send", response_model=AssistantDraftResponse)
async def send_draft_endpoint(
    draft_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    draft = await db.get(AssistantDraft, draft_id)
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")

    ok = await send_draft(db, draft)
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to send draft")

    await db.commit()
    await db.refresh(draft)
    return AssistantDraftResponse.model_validate(draft)
