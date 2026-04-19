"""
Orquestra - Subscription Alerts Task
Verifica assinaturas pendentes e notifica Diego via WhatsApp no dia 15 de cada mês.
"""

import json
import logging
import urllib.request
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import async_session
from app.models import Subscription, SubscriptionPayment

logger = logging.getLogger(__name__)

EVOLUTION_BASE = settings.EVOLUTION_API_URL
EVOLUTION_KEY = settings.EVOLUTION_API_KEY
DIEGO_PHONE = settings.OWNER_WHATSAPP or "5551934481245"


def _send_whatsapp(instance: str, apikey: str, phone: str, text: str) -> bool:
    """Envia mensagem WhatsApp via Evolution API usando urllib (Windows-safe UTF-8)."""
    try:
        data = json.dumps({"number": phone, "text": text}).encode("utf-8")
        req = urllib.request.Request(
            f"{EVOLUTION_BASE}/message/sendText/{instance}",
            data=data,
            headers={
                "Content-Type": "application/json",
                "apikey": apikey,
            },
            method="POST",
        )
        urllib.request.urlopen(req, timeout=10)
        return True
    except Exception as exc:
        logger.error("[SUB_ALERTS] Erro ao enviar WhatsApp: %s", exc)
        return False


async def check_and_alert_pending_subscriptions(db: AsyncSession) -> dict:
    """
    Verifica assinaturas ativas com pagamento pendente no mês atual.
    Envia alerta WhatsApp para Diego.
    Retorna sumário do resultado.
    """
    now = datetime.now(timezone.utc)
    current_month = now.strftime("%Y-%m")

    stmt = select(Subscription).where(Subscription.status == "active")
    result = await db.execute(stmt)
    subs = result.scalars().all()

    pending = []

    for sub in subs:
        pay_result = await db.execute(
            select(SubscriptionPayment).where(
                SubscriptionPayment.subscription_id == sub.id,
                SubscriptionPayment.reference_month == current_month,
            )
        )
        payment = pay_result.scalar_one_or_none()

        if not payment or payment.status != "paid":
            pending.append(sub)

            # Criar registro pending se não existir
            if not payment:
                new_payment = SubscriptionPayment(
                    subscription_id=sub.id,
                    reference_month=current_month,
                    amount_cents=sub.amount_cents,
                    status="pending",
                )
                db.add(new_payment)

    await db.commit()

    if not pending:
        logger.info("[SUB_ALERTS] Todas as assinaturas de %s estão pagas.", current_month)
        return {"checked": len(subs), "alerts_sent": 0, "pending_subscriptions": []}

    # Montar mensagem
    total_pending = sum(s.amount_cents for s in pending) / 100
    lines = [
        f"Jarbas aqui. Assinaturas pendentes em {current_month}:",
        "",
    ]
    for sub in pending:
        lines.append(f"• {sub.client_name}: R${sub.amount_cents/100:.0f}/mês")

    lines += [
        "",
        f"Total pendente: R${total_pending:.0f}",
        "Acesse /assinaturas para registrar os recebimentos.",
    ]
    message = "\n".join(lines)

    sent = _send_whatsapp(
        instance="guyfolkiz",
        apikey=EVOLUTION_KEY,
        phone=DIEGO_PHONE,
        text=message,
    )

    logger.info(
        "[SUB_ALERTS] %d assinaturas pendentes em %s. Alerta enviado: %s",
        len(pending), current_month, sent
    )

    return {
        "checked": len(subs),
        "alerts_sent": 1 if sent else 0,
        "pending_subscriptions": [s.client_name for s in pending],
    }


async def run_subscription_alerts():
    """Entry point para APScheduler."""
    logger.info("[SUB_ALERTS] Iniciando verificação de assinaturas pendentes...")
    async with async_session() as db:
        try:
            result = await check_and_alert_pending_subscriptions(db)
            logger.info("[SUB_ALERTS] Resultado: %s", result)
        except Exception as exc:
            logger.error("[SUB_ALERTS] Erro: %s", exc)
