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
from app.models import Contact, DeliveryReport, Project, ProjectTask, Proposal, Subscription, SubscriptionPayment

logger = logging.getLogger(__name__)
router = APIRouter()

COMPLETED_DELIVERY_STATUSES = {"completed", "done", "delivered"}
ACTIVE_DELIVERY_STATUSES = {"in_progress"}
PENDING_DELIVERY_STATUSES = {"validated", "review", "planned", "todo", "blocked"}


def _slugify(text: str) -> str:
    """Normaliza texto para slug: lowercase, sem acentos, somente alphanum e hífen."""
    nfkd = unicodedata.normalize("NFKD", text or "")
    ascii_str = nfkd.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", ascii_str.lower()).strip("-")


def _iso(dt) -> str | None:
    return dt.isoformat() if dt else None


def _normalize_delivery_status(status: str | None) -> str:
    value = (status or "").strip().lower()
    aliases = {
        "done": "completed",
        "delivered": "completed",
        "validado": "validated",
    }
    return aliases.get(value, value or "completed")


def _is_completed_delivery_status(status: str | None) -> bool:
    return _normalize_delivery_status(status) in COMPLETED_DELIVERY_STATUSES


def _build_delivery_timeline(deliveries: list[DeliveryReport]) -> list[dict[str, Any]]:
    timeline: list[dict[str, Any]] = []
    for report in deliveries:
        item_date = _iso(report.updated_at or report.generated_at or report.created_at)
        for item in report.delivered_scope or []:
            if not isinstance(item, dict):
                continue
            status = _normalize_delivery_status(item.get("status"))
            category = (item.get("category") or "core").lower()
            timeline.append({
                "title": item.get("item") or item.get("description") or "Entrega",
                "description": item.get("description"),
                "status": status,
                "priority": "high" if category == "core" else "medium",
                "created_at": item_date,
                "completed_at": item_date if _is_completed_delivery_status(status) else None,
            })
    return timeline


def _append_next_step(
    steps: list[dict[str, Any]],
    seen_titles: set[str],
    title: str | None,
    description: str | None,
    priority: str,
    status: str,
) -> None:
    normalized_title = (title or "").strip()
    if not normalized_title:
        return
    dedupe_key = normalized_title.lower()
    if dedupe_key in seen_titles:
        return
    seen_titles.add(dedupe_key)
    steps.append({
        "title": normalized_title,
        "description": description,
        "priority": priority,
        "status": status,
    })


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


@router.get("/{slug}/entregas")
async def get_cliente_entregas(slug: str, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """
    Página pública de entregas e resultados do cliente.
    Dashboard para apresentação em calls: KPIs, progresso, timeline,
    comparativos, financeiro, próximos passos.
    Sem autenticação.
    """
    contact = await _find_contact(slug, db)
    if not contact:
        raise HTTPException(status_code=404, detail=f"Cliente '{slug}' não encontrado")

    project = None
    if contact.project_id:
        project = await db.get(Project, contact.project_id)

    # Propostas do cliente
    proposals_result = await db.execute(
        select(Proposal)
        .where(Proposal.contact_id == contact.id)
        .order_by(Proposal.created_at.desc())
    )
    proposals = proposals_result.scalars().all()
    proposal_ids = [p.id for p in proposals]

    # Delivery reports vinculados às propostas
    deliveries = []
    if proposal_ids:
        dr_result = await db.execute(
            select(DeliveryReport)
            .where(DeliveryReport.proposal_id.in_(proposal_ids))
            .order_by(DeliveryReport.updated_at.desc())
        )
        deliveries = dr_result.scalars().all()

    # Tasks do projeto
    tasks = []
    if project:
        tasks_result = await db.execute(
            select(ProjectTask)
            .where(ProjectTask.project_id == project.id)
            .order_by(ProjectTask.created_at.desc())
        )
        tasks = tasks_result.scalars().all()

    # Assinaturas
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

    # Calcular KPIs agregados com base no status real do delivery report
    total_proposed = sum(len(d.proposed_scope or []) for d in deliveries)
    total_delivered = 0
    total_extras = 0
    for d in deliveries:
        for item in d.delivered_scope or []:
            if not isinstance(item, dict):
                continue
            status = _normalize_delivery_status(item.get("status"))
            in_proposal = item.get("in_proposal")
            if in_proposal is None:
                in_proposal = (item.get("category") or "core").lower() == "core"
            if in_proposal and _is_completed_delivery_status(status):
                total_delivered += 1
            elif not in_proposal and _is_completed_delivery_status(status):
                total_extras += 1
    completion_pct = round((total_delivered / total_proposed * 100) if total_proposed > 0 else 0)

    # Financeiro agregado
    total_value_proposed = 0
    total_value_paid = 0
    total_value_pending = 0
    for d in deliveries:
        fs = d.financial_summary or {}
        total_value_proposed += _parse_money(fs.get("proposed", 0))
        total_value_paid += _parse_money(fs.get("paid", 0))
        total_value_pending += _parse_money(fs.get("pending", 0))

    # Se não tiver delivery reports, usar valor das propostas aceitas
    if not deliveries:
        for p in proposals:
            if p.status in ("accepted", "signed") and p.total_value:
                total_value_proposed += _parse_money(p.total_value)

    # Deliveries formatadas
    deliveries_data = []
    proposal_map = {p.id: p for p in proposals}
    for d in deliveries:
        prop = proposal_map.get(d.proposal_id)
        deliveries_data.append({
            "proposal_title": prop.title if prop else None,
            "proposal_slug": prop.slug if prop else None,
            "proposed_scope": list(d.proposed_scope or []),
            "delivered_scope": list(d.delivered_scope or []),
            "extras": list(d.extras or []),
            "financial_summary": dict(d.financial_summary or {}),
            "comparison_analysis": d.comparison_analysis,
            "status": d.status,
            "generated_at": _iso(d.generated_at),
        })

    # Timeline e contadores de tarefas: usar delivery report quando existir,
    # porque as tasks do projeto podem refletir outro fluxo operacional.
    if deliveries:
        timeline = _build_delivery_timeline(deliveries)
        completed_tasks = [t for t in timeline if t["status"] in COMPLETED_DELIVERY_STATUSES]
        in_progress_tasks = [t for t in timeline if t["status"] in ACTIVE_DELIVERY_STATUSES]
        pending_tasks = [t for t in timeline if t["status"] in PENDING_DELIVERY_STATUSES]
    else:
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
        completed_tasks = [t for t in tasks if t.status in ("done", "completed")]
        in_progress_tasks = [t for t in tasks if t.status == "in_progress"]
        pending_tasks = [t for t in tasks if t.status in ("todo", "blocked", "review")]

    # Próximos passos: itens não concluídos do delivery report e expansões mapeadas
    next_steps: list[dict[str, Any]] = []
    next_step_titles: set[str] = set()
    if deliveries:
        for d in deliveries:
            for item in d.delivered_scope or []:
                if not isinstance(item, dict):
                    continue
                status = _normalize_delivery_status(item.get("status"))
                if status in COMPLETED_DELIVERY_STATUSES:
                    continue
                _append_next_step(
                    next_steps,
                    next_step_titles,
                    item.get("item"),
                    item.get("description"),
                    "high" if item.get("in_proposal", True) else "medium",
                    status,
                )
            for extra in d.extras or []:
                if not isinstance(extra, dict):
                    continue
                _append_next_step(
                    next_steps,
                    next_step_titles,
                    extra.get("item"),
                    extra.get("description"),
                    "medium" if extra.get("accepted") else "low",
                    "planned" if extra.get("accepted") else "todo",
                )
    else:
        next_steps = [
            {"title": t.title, "description": t.description, "priority": t.priority, "status": t.status}
            for t in tasks
            if t.status in ("todo", "in_progress", "review", "blocked")
        ]
        next_step_titles = {(step["title"] or "").strip().lower() for step in next_steps}

    if contact.next_action and (contact.next_action or "").strip().lower() not in next_step_titles:
        next_steps.insert(0, {
            "title": contact.next_action,
            "description": None,
            "priority": "high",
            "status": "planned",
        })

    # Assinaturas
    subscriptions_data = []
    for sub in subscriptions:
        pays_result = await db.execute(
            select(SubscriptionPayment)
            .where(SubscriptionPayment.subscription_id == sub.id)
            .order_by(SubscriptionPayment.reference_month.desc())
            .limit(6)
        )
        pays = pays_result.scalars().all()
        subscriptions_data.append({
            "description": sub.description,
            "amount_brl": sub.amount_cents / 100,
            "billing_day": sub.billing_day,
            "payments": [
                {
                    "reference_month": p.reference_month,
                    "status": p.status,
                    "amount_brl": p.amount_cents / 100,
                    "paid_at": _iso(p.paid_at),
                }
                for p in pays
            ],
        })

    return {
        "client": {
            "name": contact.name or contact.push_name,
            "slug": slug,
            "company": contact.company,
            "pipeline_stage": contact.pipeline_stage,
        },
        "project": {
            "name": project.name if project else None,
            "status": project.status if project else None,
            "description": project.description if project else None,
        } if project else None,
        "kpis": {
            "total_proposed": total_proposed,
            "total_delivered": total_delivered,
            "total_extras": total_extras,
            "completion_pct": completion_pct,
            "tasks_completed": len(completed_tasks),
            "tasks_in_progress": len(in_progress_tasks),
            "tasks_pending": len(pending_tasks),
            "total_value_proposed": total_value_proposed,
            "total_value_paid": total_value_paid,
            "total_value_pending": total_value_pending,
        },
        "deliveries": deliveries_data,
        "timeline": timeline,
        "next_steps": next_steps,
        "subscriptions": subscriptions_data,
    }


def _parse_money(value) -> float:
    """Converte valores monetários diversos para float."""
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        cleaned = value.replace("R$", "").replace(".", "").replace(",", ".").strip()
        try:
            return float(cleaned)
        except ValueError:
            return 0.0
    return 0.0


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
