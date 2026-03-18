"""
Orquestra - Cliente público
Página pública por cliente: /cliente/{slug}
Slug = nome do contato normalizado (lowercase, sem espaços/acentos).
Sem autenticação - dados controlados pelo Diego.
"""

import logging
import re
import unicodedata
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Contact, Project, ProjectTask, Proposal, Subscription, SubscriptionPayment

logger = logging.getLogger(__name__)
router = APIRouter()


def _slugify(text: str) -> str:
    """Normaliza texto para slug: lowercase, sem acentos, somente alphanum e hífen."""
    nfkd = unicodedata.normalize("NFKD", text or "")
    ascii_str = nfkd.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", ascii_str.lower()).strip("-")


def _iso(dt) -> str | None:
    return dt.isoformat() if dt else None


async def _find_contact(slug: str, db: AsyncSession) -> Contact | None:
    """
    Busca contato pelo slug do nome.
    Tenta match exato primeiro, depois parcial.
    """
    stmt = select(Contact).where(Contact.is_group == False)
    result = await db.execute(stmt)
    contacts = result.scalars().all()

    for c in contacts:
        if _slugify(c.name or c.push_name or "") == slug:
            return c

    # Fallback: contato cujo slug começa com o slug buscado
    for c in contacts:
        if _slugify(c.name or c.push_name or "").startswith(slug):
            return c

    return None


@router.get("/{slug}")
async def get_cliente_page(slug: str, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """
    Página pública do cliente: propostas aceitas, entregas com timeline,
    pagamentos pago/pendente e modelo de parceria vigente.
    Acessível sem autenticação.
    """
    contact = await _find_contact(slug, db)
    if not contact:
        raise HTTPException(status_code=404, detail=f"Cliente '{slug}' não encontrado")

    # Projeto associado
    project = None
    if contact.project_id:
        project = await db.get(Project, contact.project_id)

    # Propostas aceitas (e todas para histórico)
    proposals_result = await db.execute(
        select(Proposal)
        .where(Proposal.contact_id == contact.id)
        .order_by(Proposal.created_at.desc())
    )
    proposals = proposals_result.scalars().all()

    # Tasks do projeto (timeline de entregas)
    tasks = []
    if project:
        tasks_result = await db.execute(
            select(ProjectTask)
            .where(ProjectTask.project_id == project.id)
            .order_by(ProjectTask.created_at.desc())
        )
        tasks = tasks_result.scalars().all()

    # Assinaturas do cliente
    subs_result = await db.execute(
        select(Subscription).where(
            func.lower(Subscription.client_name).contains(
                (contact.name or contact.push_name or "").split()[0].lower()
                if (contact.name or contact.push_name or "")
                else ""
            ),
            Subscription.status == "active",
        )
    )
    subscriptions = subs_result.scalars().all()

    # Pagamentos das assinaturas
    payments_by_sub: dict[str, list[dict]] = {}
    for sub in subscriptions:
        pays_result = await db.execute(
            select(SubscriptionPayment)
            .where(SubscriptionPayment.subscription_id == sub.id)
            .order_by(SubscriptionPayment.reference_month.desc())
            .limit(6)
        )
        pays = pays_result.scalars().all()
        payments_by_sub[str(sub.id)] = [
            {
                "reference_month": p.reference_month,
                "status": p.status,
                "amount_brl": p.amount_cents / 100,
                "paid_at": _iso(p.paid_at),
                "payment_method": p.payment_method,
            }
            for p in pays
        ]

    # Formatar resposta
    accepted_proposals = [p for p in proposals if p.status in ("accepted", "signed")]
    all_proposals_data = [
        {
            "id": str(p.id),
            "title": p.title,
            "status": p.status,
            "total_value": p.total_value,
            "created_at": _iso(p.created_at),
            "slug": p.slug,
        }
        for p in proposals
    ]

    timeline = [
        {
            "title": t.title,
            "description": t.description,
            "status": t.status,
            "priority": t.priority,
            "created_at": _iso(t.created_at),
            "completed_at": _iso(t.completed_at),
        }
        for t in tasks
    ]

    subscriptions_data = [
        {
            "id": str(sub.id),
            "description": sub.description,
            "amount_brl": sub.amount_cents / 100,
            "billing_day": sub.billing_day,
            "status": sub.status,
            "payments": payments_by_sub.get(str(sub.id), []),
        }
        for sub in subscriptions
    ]

    return {
        "client": {
            "name": contact.name or contact.push_name,
            "slug": slug,
            "pipeline_stage": contact.pipeline_stage,
            "company": contact.company,
            "monthly_revenue": contact.monthly_revenue,
            "next_action": contact.next_action,
        },
        "project": {
            "name": project.name if project else None,
            "status": project.status if project else None,
            "description": project.description if project else None,
        } if project else None,
        "proposals": all_proposals_data,
        "accepted_proposals": [p for p in all_proposals_data if p["status"] in ("accepted", "signed")],
        "timeline": timeline,
        "subscriptions": subscriptions_data,
    }


@router.get("/")
async def list_clientes(db: AsyncSession = Depends(get_db)) -> list[dict]:
    """Lista clientes disponíveis (para o Diego saber as URLs)."""
    result = await db.execute(
        select(Contact)
        .where(Contact.is_group == False, Contact.ignored == False)
        .order_by(Contact.name)
    )
    contacts = result.scalars().all()
    return [
        {
            "name": c.name or c.push_name,
            "slug": _slugify(c.name or c.push_name or ""),
            "pipeline_stage": c.pipeline_stage,
        }
        for c in contacts
        if (c.name or c.push_name)
    ]
