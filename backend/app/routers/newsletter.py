"""
Newsletter Router — subscribers + editions
POST /subscribe é PÚBLICO (sem auth) para captura de email
"""

import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr
from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import NewsletterSubscriber, NewsletterEdition

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Schemas ──────────────────────────────────────────────

class SubscribeRequest(BaseModel):
    email: EmailStr
    name: str | None = None
    source: str = "website"


class EditionCreate(BaseModel):
    title: str
    content_html: str
    content_text: str | None = None
    youtube_video_id: str | None = None


# ── PUBLIC: Subscribe ────────────────────────────────────

@router.post("/subscribe")
async def subscribe(req: SubscribeRequest, db: AsyncSession = Depends(get_db)):
    """Público — captura email sem auth."""
    existing = await db.execute(
        select(NewsletterSubscriber).where(NewsletterSubscriber.email == req.email)
    )
    sub = existing.scalar_one_or_none()

    if sub:
        if sub.status == "unsubscribed":
            sub.status = "active"
            sub.unsubscribed_at = None
            await db.commit()
            return {"status": "reactivated", "message": "Bem-vindo de volta!"}
        return {"status": "already_subscribed", "message": "Esse email já está na lista!"}

    new_sub = NewsletterSubscriber(
        email=req.email,
        name=req.name,
        source=req.source,
    )
    db.add(new_sub)
    await db.commit()
    logger.info("[NEWSLETTER] Novo subscriber: %s (source: %s)", req.email, req.source)
    return {"status": "ok", "message": "Inscrito com sucesso! Você vai receber o Radar IA toda semana."}


# ── PUBLIC: Unsubscribe ──────────────────────────────────

@router.post("/unsubscribe")
async def unsubscribe(email: str = Query(...), db: AsyncSession = Depends(get_db)):
    """Público — remove da lista."""
    result = await db.execute(
        select(NewsletterSubscriber).where(NewsletterSubscriber.email == email)
    )
    sub = result.scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="Email não encontrado")

    sub.status = "unsubscribed"
    sub.unsubscribed_at = datetime.now(timezone.utc)
    await db.commit()
    return {"status": "ok", "message": "Você foi removido da lista."}


# ── ADMIN: List subscribers ──────────────────────────────

@router.get("/subscribers")
async def list_subscribers(
    status: str = Query("active"),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(NewsletterSubscriber)
        .where(NewsletterSubscriber.status == status)
        .order_by(NewsletterSubscriber.created_at.desc())
    )
    subs = result.scalars().all()

    count_result = await db.execute(
        select(func.count()).select_from(NewsletterSubscriber).where(NewsletterSubscriber.status == "active")
    )
    total_active = count_result.scalar() or 0

    return {
        "status": "ok",
        "total_active": total_active,
        "subscribers": [
            {
                "id": str(s.id),
                "email": s.email,
                "name": s.name,
                "source": s.source,
                "status": s.status,
                "created_at": s.created_at.isoformat() if s.created_at else None,
            }
            for s in subs
        ],
    }


# ── ADMIN: Editions CRUD ─────────────────────────────────

@router.get("/editions")
async def list_editions(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(NewsletterEdition).order_by(NewsletterEdition.created_at.desc())
    )
    editions = result.scalars().all()
    return {
        "status": "ok",
        "editions": [
            {
                "id": str(e.id),
                "title": e.title,
                "status": e.status,
                "sent_count": e.sent_count,
                "youtube_video_id": e.youtube_video_id,
                "created_at": e.created_at.isoformat() if e.created_at else None,
                "sent_at": e.sent_at.isoformat() if e.sent_at else None,
            }
            for e in editions
        ],
    }


@router.post("/editions")
async def create_edition(req: EditionCreate, db: AsyncSession = Depends(get_db)):
    edition = NewsletterEdition(
        title=req.title,
        content_html=req.content_html,
        content_text=req.content_text,
        youtube_video_id=req.youtube_video_id,
    )
    db.add(edition)
    await db.commit()
    await db.refresh(edition)
    return {"status": "ok", "edition_id": str(edition.id)}


@router.get("/editions/{edition_id}")
async def get_edition(edition_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(NewsletterEdition).where(NewsletterEdition.id == edition_id)
    )
    edition = result.scalar_one_or_none()
    if not edition:
        raise HTTPException(status_code=404, detail="Edição não encontrada")
    return {
        "status": "ok",
        "edition": {
            "id": str(edition.id),
            "title": edition.title,
            "content_html": edition.content_html,
            "content_text": edition.content_text,
            "status": edition.status,
            "sent_count": edition.sent_count,
            "youtube_video_id": edition.youtube_video_id,
            "created_at": edition.created_at.isoformat() if edition.created_at else None,
            "sent_at": edition.sent_at.isoformat() if edition.sent_at else None,
        },
    }


# ── ADMIN: Send edition ──────────────────────────────────

@router.post("/editions/{edition_id}/send")
async def send_edition(edition_id: UUID, db: AsyncSession = Depends(get_db)):
    """Dispara email para todos os subscribers ativos."""
    result = await db.execute(
        select(NewsletterEdition).where(NewsletterEdition.id == edition_id)
    )
    edition = result.scalar_one_or_none()
    if not edition:
        raise HTTPException(status_code=404, detail="Edição não encontrada")
    if edition.status == "sent":
        raise HTTPException(status_code=400, detail="Edição já foi enviada")

    # Get active subscribers
    subs_result = await db.execute(
        select(NewsletterSubscriber).where(NewsletterSubscriber.status == "active")
    )
    subscribers = subs_result.scalars().all()

    if not subscribers:
        raise HTTPException(status_code=400, detail="Nenhum subscriber ativo")

    # Send emails via Resend API
    sent = 0
    errors = []
    try:
        import httpx
        from app.config import settings
        resend_key = getattr(settings, "RESEND_API_KEY", None)

        if not resend_key:
            logger.warning("[NEWSLETTER] RESEND_API_KEY não configurada — simulando envio")
            sent = len(subscribers)
        else:
            async with httpx.AsyncClient(timeout=30) as client:
                for sub in subscribers:
                    try:
                        resp = await client.post(
                            "https://api.resend.com/emails",
                            headers={"Authorization": f"Bearer {resend_key}"},
                            json={
                                "from": "Radar IA <radar@guyfolkz.com>",
                                "to": sub.email,
                                "subject": edition.title,
                                "html": edition.content_html,
                                "text": edition.content_text or "",
                            },
                        )
                        if resp.status_code in (200, 201):
                            sent += 1
                        else:
                            errors.append(f"{sub.email}: {resp.status_code}")
                    except Exception as e:
                        errors.append(f"{sub.email}: {str(e)[:100]}")
    except ImportError:
        sent = len(subscribers)
        logger.warning("[NEWSLETTER] httpx não disponível — contagem simulada")

    # Update edition status
    edition.status = "sent"
    edition.sent_count = sent
    edition.sent_at = datetime.now(timezone.utc)
    await db.commit()

    logger.info("[NEWSLETTER] Edição '%s' enviada para %d subscribers", edition.title, sent)
    return {
        "status": "ok",
        "sent": sent,
        "total_subscribers": len(subscribers),
        "errors": errors[:10] if errors else [],
    }


# ── ADMIN: Stats ─────────────────────────────────────────

@router.get("/stats")
async def newsletter_stats(db: AsyncSession = Depends(get_db)):
    active = await db.execute(
        select(func.count()).select_from(NewsletterSubscriber).where(NewsletterSubscriber.status == "active")
    )
    total = await db.execute(select(func.count()).select_from(NewsletterSubscriber))
    editions = await db.execute(select(func.count()).select_from(NewsletterEdition))
    sent = await db.execute(
        select(func.count()).select_from(NewsletterEdition).where(NewsletterEdition.status == "sent")
    )

    return {
        "status": "ok",
        "active_subscribers": active.scalar() or 0,
        "total_subscribers": total.scalar() or 0,
        "total_editions": editions.scalar() or 0,
        "sent_editions": sent.scalar() or 0,
    }
