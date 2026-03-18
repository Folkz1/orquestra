"""
Orquestra - Subscriptions Router
Controle de assinaturas mensais recorrentes de clientes.
"""

import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Subscription, SubscriptionPayment
from app.schemas import (
    SubscriptionCreate,
    SubscriptionUpdate,
    SubscriptionResponse,
    SubscriptionPaymentResponse,
    RegisterPaymentRequest,
    SubscriptionAlertResult,
)

logger = logging.getLogger(__name__)
router = APIRouter()


def _to_response(sub: Subscription) -> SubscriptionResponse:
    return SubscriptionResponse(
        id=sub.id,
        client_name=sub.client_name,
        description=sub.description,
        amount_cents=sub.amount_cents,
        currency=sub.currency,
        billing_day=sub.billing_day,
        status=sub.status,
        evolution_instance=sub.evolution_instance,
        alert_phone=sub.alert_phone,
        notes=sub.notes,
        contact_id=sub.contact_id,
        project_id=sub.project_id,
        contact_name=sub.contact.name if sub.contact else None,
        project_name=sub.project.name if sub.project else None,
        payments=[SubscriptionPaymentResponse.model_validate(p) for p in (sub.payments or [])],
        created_at=sub.created_at,
        updated_at=sub.updated_at,
    )


# ─── CRUD Subscriptions ───────────────────────────────────────────────────

@router.get("", response_model=list[SubscriptionResponse])
async def list_subscriptions(
    status: Optional[str] = Query(None, description="active, paused, cancelled"),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Subscription).order_by(Subscription.client_name)
    if status:
        stmt = stmt.where(Subscription.status == status)
    result = await db.execute(stmt)
    subs = result.scalars().all()
    return [_to_response(s) for s in subs]


@router.post("", response_model=SubscriptionResponse, status_code=201)
async def create_subscription(
    body: SubscriptionCreate,
    db: AsyncSession = Depends(get_db),
):
    sub = Subscription(
        client_name=body.client_name,
        description=body.description,
        amount_cents=body.amount_cents,
        currency=body.currency,
        billing_day=body.billing_day,
        contact_id=body.contact_id,
        project_id=body.project_id,
        evolution_instance=body.evolution_instance,
        alert_phone=body.alert_phone,
        notes=body.notes,
        status=body.status,
    )
    db.add(sub)
    await db.commit()
    await db.refresh(sub)
    logger.info("[SUBSCRIPTIONS] Criada assinatura %s para %s", sub.id, sub.client_name)
    return _to_response(sub)


@router.get("/{sub_id}", response_model=SubscriptionResponse)
async def get_subscription(sub_id: UUID, db: AsyncSession = Depends(get_db)):
    sub = await db.get(Subscription, sub_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Assinatura não encontrada")
    return _to_response(sub)


@router.patch("/{sub_id}", response_model=SubscriptionResponse)
async def update_subscription(
    sub_id: UUID,
    body: SubscriptionUpdate,
    db: AsyncSession = Depends(get_db),
):
    sub = await db.get(Subscription, sub_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Assinatura não encontrada")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(sub, field, value)
    sub.updated_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(sub)
    return _to_response(sub)


@router.delete("/{sub_id}", status_code=204)
async def delete_subscription(sub_id: UUID, db: AsyncSession = Depends(get_db)):
    sub = await db.get(Subscription, sub_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Assinatura não encontrada")
    await db.delete(sub)
    await db.commit()


# ─── Payments ─────────────────────────────────────────────────────────────

@router.get("/{sub_id}/payments", response_model=list[SubscriptionPaymentResponse])
async def list_payments(sub_id: UUID, db: AsyncSession = Depends(get_db)):
    stmt = (
        select(SubscriptionPayment)
        .where(SubscriptionPayment.subscription_id == sub_id)
        .order_by(SubscriptionPayment.reference_month.desc())
    )
    result = await db.execute(stmt)
    return [SubscriptionPaymentResponse.model_validate(p) for p in result.scalars().all()]


@router.post("/{sub_id}/payments", response_model=SubscriptionPaymentResponse, status_code=201)
async def register_payment(
    sub_id: UUID,
    body: RegisterPaymentRequest,
    db: AsyncSession = Depends(get_db),
):
    sub = await db.get(Subscription, sub_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Assinatura não encontrada")

    # Verificar se já existe pagamento para o mês
    existing = await db.execute(
        select(SubscriptionPayment).where(
            SubscriptionPayment.subscription_id == sub_id,
            SubscriptionPayment.reference_month == body.reference_month,
        )
    )
    payment = existing.scalar_one_or_none()

    if payment:
        # Atualizar existente
        payment.status = "paid"
        payment.paid_at = datetime.now(timezone.utc)
        payment.payment_method = body.payment_method
        payment.notes = body.notes
        if body.amount_cents:
            payment.amount_cents = body.amount_cents
        payment.updated_at = datetime.now(timezone.utc)
    else:
        payment = SubscriptionPayment(
            subscription_id=sub_id,
            reference_month=body.reference_month,
            amount_cents=body.amount_cents or sub.amount_cents,
            status="paid",
            paid_at=datetime.now(timezone.utc),
            payment_method=body.payment_method,
            notes=body.notes,
        )
        db.add(payment)

    await db.commit()
    await db.refresh(payment)
    logger.info(
        "[SUBSCRIPTIONS] Pagamento registrado: %s %s - %s",
        sub.client_name, body.reference_month, payment.status
    )
    return SubscriptionPaymentResponse.model_validate(payment)


# ─── Dashboard Summary ────────────────────────────────────────────────────

@router.get("/summary/dashboard")
async def subscriptions_dashboard(db: AsyncSession = Depends(get_db)):
    """Retorna visão consolidada de todas as assinaturas ativas com status do mês atual."""
    from calendar import monthrange

    now = datetime.now(timezone.utc)
    current_month = now.strftime("%Y-%m")

    stmt = select(Subscription).where(Subscription.status == "active")
    result = await db.execute(stmt)
    subs = result.scalars().all()

    rows = []
    total_mrr = 0
    total_received = 0
    total_pending = 0

    for sub in subs:
        # Verificar pagamento do mês atual
        pay_result = await db.execute(
            select(SubscriptionPayment).where(
                SubscriptionPayment.subscription_id == sub.id,
                SubscriptionPayment.reference_month == current_month,
            )
        )
        payment = pay_result.scalar_one_or_none()

        pay_status = payment.status if payment else "pending"
        total_mrr += sub.amount_cents

        if pay_status == "paid":
            total_received += sub.amount_cents
        else:
            total_pending += sub.amount_cents

        # Histórico dos últimos 3 meses
        hist_result = await db.execute(
            select(SubscriptionPayment)
            .where(SubscriptionPayment.subscription_id == sub.id)
            .order_by(SubscriptionPayment.reference_month.desc())
            .limit(3)
        )
        history = [SubscriptionPaymentResponse.model_validate(p) for p in hist_result.scalars().all()]

        rows.append({
            "id": str(sub.id),
            "client_name": sub.client_name,
            "description": sub.description,
            "amount_cents": sub.amount_cents,
            "amount_brl": sub.amount_cents / 100,
            "billing_day": sub.billing_day,
            "current_month_status": pay_status,
            "paid_at": payment.paid_at.isoformat() if payment and payment.paid_at else None,
            "contact_name": sub.contact.name if sub.contact else None,
            "history": [h.model_dump() for h in history],
        })

    return {
        "current_month": current_month,
        "total_active": len(subs),
        "mrr_cents": total_mrr,
        "mrr_brl": total_mrr / 100,
        "received_cents": total_received,
        "received_brl": total_received / 100,
        "pending_cents": total_pending,
        "pending_brl": total_pending / 100,
        "subscriptions": rows,
    }


# ─── Manual Alert Trigger ─────────────────────────────────────────────────

@router.post("/alerts/check", response_model=SubscriptionAlertResult)
async def trigger_alert_check(db: AsyncSession = Depends(get_db)):
    """Dispara verificação manual de assinaturas pendentes e envia alertas WhatsApp."""
    from app.tasks.subscription_alerts import check_and_alert_pending_subscriptions
    result = await check_and_alert_pending_subscriptions(db)
    return result
