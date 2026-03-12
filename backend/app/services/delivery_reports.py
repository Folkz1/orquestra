from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Contact, DeliveryReport, Message, Proposal
from app.services.llm import chat_completion
from app.services.whatsapp import send_whatsapp_message

logger = logging.getLogger(__name__)

PAYMENT_TERMS = ("pix", "pagamento", "comprovante", "pago", "paguei", "transferi")


def _parse_json_response(text: str) -> dict:
    match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", text, re.DOTALL)
    if match:
        return json.loads(match.group(1).strip())

    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1:
        return json.loads(text[start : end + 1])

    raise ValueError("LLM response did not contain valid JSON")


def _ensure_list(value: object) -> list[dict]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _ensure_dict(value: object) -> dict:
    return value if isinstance(value, dict) else {}


def _parse_money(value: object) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    if not value:
        return 0.0

    raw = str(value).strip()
    has_comma = "," in raw
    normalized = re.sub(r"[^\d,.-]", "", raw)
    if has_comma:
        normalized = normalized.replace(".", "").replace(",", ".")

    try:
        return float(normalized)
    except ValueError:
        return 0.0


def _message_body(message: Message) -> str:
    parts = []
    if message.content:
        parts.append(message.content.strip())
    if message.transcription and message.transcription.strip() not in parts:
        parts.append(f"[transcricao] {message.transcription.strip()}")
    body = "\n".join(part for part in parts if part).strip()
    return body[:700]


def _format_messages(messages: list[Message]) -> str:
    if not messages:
        return "Sem mensagens recentes."

    lines: list[str] = []
    for message in messages:
        direction = "Cliente" if message.direction == "incoming" else "Diego"
        timestamp = message.timestamp.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        body = _message_body(message) or "[sem texto]"
        lines.append(f"[{timestamp}] {direction} ({message.message_type}): {body}")
    return "\n".join(lines)


async def _resolve_contact(db: AsyncSession, proposal: Proposal) -> Contact | None:
    if proposal.contact_id:
        return await db.get(Contact, proposal.contact_id)

    if proposal.client_phone:
        digits = re.sub(r"\D", "", proposal.client_phone)
        stmt = select(Contact).where(Contact.phone.contains(digits[-10:])).limit(1)
        result = await db.execute(stmt)
        return result.scalar_one_or_none()

    return None


async def _get_recent_messages(db: AsyncSession, contact_id: UUID, limit: int = 50) -> list[Message]:
    stmt = (
        select(Message)
        .where(Message.contact_id == contact_id)
        .order_by(desc(Message.timestamp))
        .limit(limit)
    )
    result = await db.execute(stmt)
    messages = list(result.scalars().all())
    messages.reverse()
    return messages


async def _get_payment_messages(db: AsyncSession, contact_id: UUID, limit: int = 20) -> list[Message]:
    filters = [Message.content.ilike(f"%{term}%") for term in PAYMENT_TERMS]
    filters.extend(Message.transcription.ilike(f"%{term}%") for term in PAYMENT_TERMS)

    stmt = (
        select(Message)
        .where(Message.contact_id == contact_id)
        .where(or_(*filters))
        .order_by(desc(Message.timestamp))
        .limit(limit)
    )
    result = await db.execute(stmt)
    messages = list(result.scalars().all())
    messages.reverse()
    return messages


def _normalize_report_payload(payload: dict, proposal: Proposal) -> dict:
    financial_summary = _ensure_dict(payload.get("financial_summary"))

    proposed_value = financial_summary.get("proposed")
    if proposed_value in (None, "", 0):
        financial_summary["proposed"] = _parse_money(proposal.total_value)

    extras_total = _parse_money(financial_summary.get("extras_total"))
    proposed_total = _parse_money(financial_summary.get("proposed"))
    total = _parse_money(financial_summary.get("total")) or proposed_total + extras_total
    paid = _parse_money(financial_summary.get("paid"))
    pending = _parse_money(financial_summary.get("pending"))
    if not pending:
        pending = max(total - paid, 0)

    financial_summary["extras_total"] = extras_total
    financial_summary["proposed"] = proposed_total
    financial_summary["total"] = total
    financial_summary["paid"] = paid
    financial_summary["pending"] = pending
    financial_summary["payments"] = [
        payment for payment in financial_summary.get("payments", []) if isinstance(payment, dict)
    ]

    return {
        "proposed_scope": _ensure_list(payload.get("proposed_scope")),
        "delivered_scope": _ensure_list(payload.get("delivered_scope")),
        "extras": _ensure_list(payload.get("extras")),
        "financial_summary": financial_summary,
        "comparison_analysis": str(payload.get("comparison_analysis") or "").strip(),
    }


async def generate_delivery_report(
    db: AsyncSession,
    proposal: Proposal,
    report: DeliveryReport | None = None,
) -> DeliveryReport:
    if proposal.status not in {"accepted", "viewed"}:
        raise ValueError("Delivery report so pode ser gerado para propostas viewed ou accepted")

    if not settings.OPENROUTER_API_KEY:
        raise RuntimeError("OPENROUTER_API_KEY nao configurada")

    contact = await _resolve_contact(db, proposal)
    if not contact:
        raise ValueError("Contato vinculado nao encontrado para essa proposta")

    recent_messages = await _get_recent_messages(db, contact.id)
    payment_messages = await _get_payment_messages(db, contact.id)

    prompt = (
        "Analise a proposta comercial e a conversa com o cliente.\n\n"
        "PROPOSTA ORIGINAL:\n"
        f"{proposal.content}\n\n"
        "DIGEST DO CLIENTE (resumo historico):\n"
        f"{contact.notes or 'Sem digest salvo.'}\n\n"
        "ULTIMAS 50 MENSAGENS:\n"
        f"{_format_messages(recent_messages)}\n\n"
        "MENSAGENS SOBRE PAGAMENTO:\n"
        f"{_format_messages(payment_messages)}\n\n"
        "Retorne APENAS um JSON valido com esta estrutura:\n"
        "{\n"
        '  "proposed_scope": [{"item": "...", "description": "...", "category": "core"}],\n'
        '  "delivered_scope": [{"item": "...", "description": "...", "category": "core|upgrade|extra", "in_proposal": true}],\n'
        '  "extras": [{"item": "...", "description": "...", "value": "R$ 200", "accepted": true, "date": "2026-03-05"}],\n'
        '  "financial_summary": {"proposed": 1200, "extras_total": 300, "total": 1500, "paid": 700, "pending": 800, "payments": [{"value": 700, "date": "2026-03-06", "method": "PIX"}]},\n'
        '  "comparison_analysis": "Texto curto comparando proposta vs entrega, destacando upgrades e extras."\n'
        "}\n\n"
        "Regras:\n"
        "- Use category=core quando foi entregue conforme o escopo.\n"
        "- Use category=upgrade quando entregou melhor que o proposto.\n"
        "- Use category=extra quando nao estava no escopo original.\n"
        "- Sempre marque delivered_scope.in_proposal como true ou false.\n"
        "- Se faltar certeza em algum valor, sinalize na description e mantenha o JSON valido.\n"
        "- Responda somente com JSON."
    )

    response_text = await chat_completion(
        [
            {
                "role": "system",
                "content": (
                    "Voce analisa escopo comercial, mensagens de WhatsApp e saldo financeiro. "
                    "Seu trabalho e transformar isso em um JSON confiavel para auditoria de entrega."
                ),
            },
            {"role": "user", "content": prompt},
        ],
        model=settings.MODEL_DELIVERY_REPORT,
        temperature=0.1,
        max_tokens=4000,
    )

    payload = _normalize_report_payload(_parse_json_response(response_text), proposal)

    target = report or DeliveryReport(proposal_id=proposal.id, contact_id=contact.id)
    target.contact_id = contact.id
    target.proposed_scope = payload["proposed_scope"]
    target.delivered_scope = payload["delivered_scope"]
    target.extras = payload["extras"]
    target.financial_summary = payload["financial_summary"]
    target.comparison_analysis = payload["comparison_analysis"]
    target.status = "draft"
    target.generated_at = datetime.now(timezone.utc)

    if report is None:
        db.add(target)

    await db.flush()
    await db.refresh(target)
    logger.info("[DELIVERY_REPORT] Generated report for proposal %s", proposal.id)
    return target


def _fallback_whatsapp_message(report: DeliveryReport, proposal: Proposal, contact: Contact | None) -> str:
    finance = report.financial_summary or {}
    extras = report.extras or []
    delivered = report.delivered_scope or []

    def group_items(category: str) -> list[str]:
        return [str(item.get("item") or "Item").strip() for item in delivered if item.get("category") == category]

    lines = [
        "*Relatorio de Entrega*",
        f"Projeto: {proposal.title}",
        f"Cliente: {(contact.name if contact and contact.name else proposal.client_name) or 'Cliente'}",
        "",
        "*Entregue conforme proposta*",
    ]

    core_items = group_items("core")
    lines.extend([f"- {item}" for item in core_items[:6]] or ["- Nenhum item confirmado com clareza"])

    upgrade_items = group_items("upgrade")
    if upgrade_items:
        lines.extend(["", "*Upgrades entregues*", *[f"- {item}" for item in upgrade_items[:6]]])

    if extras:
        lines.extend(["", "*Extras realizados*"])
        for extra in extras[:8]:
            label = str(extra.get("item") or "Extra").strip()
            value = str(extra.get("value") or "valor a confirmar").strip()
            lines.append(f"- {label} ({value})")

    lines.extend([
        "",
        "*Financeiro*",
        f"Proposta: R$ {int(_parse_money(finance.get('proposed')))}",
        f"Extras: R$ {int(_parse_money(finance.get('extras_total')))}",
        f"Total: R$ {int(_parse_money(finance.get('total')))}",
        f"Pago: R$ {int(_parse_money(finance.get('paid')))}",
        f"Pendente: R$ {int(_parse_money(finance.get('pending')))}",
    ])

    if report.comparison_analysis:
        lines.extend(["", report.comparison_analysis.strip()])

    return "\n".join(lines)[:3900]


async def build_delivery_report_whatsapp_message(
    report: DeliveryReport,
    proposal: Proposal,
    contact: Contact | None,
) -> str:
    if not settings.OPENROUTER_API_KEY:
        return _fallback_whatsapp_message(report, proposal, contact)

    report_json = json.dumps(
        {
            "proposed_scope": report.proposed_scope,
            "delivered_scope": report.delivered_scope,
            "extras": report.extras,
            "financial_summary": report.financial_summary,
            "comparison_analysis": report.comparison_analysis,
        },
        ensure_ascii=False,
    )

    prompt = (
        "Formate uma mensagem de WhatsApp profissional, curta e objetiva em portugues do Brasil.\n"
        "Ela sera enviada ao cliente para mostrar comparacao entre proposta e entrega.\n"
        "Use blocos curtos, sem markdown complexo alem de negrito simples do WhatsApp.\n"
        "Destacar:\n"
        "1. O que estava na proposta\n"
        "2. O que foi entregue melhor que o proposto\n"
        "3. Quais extras entraram\n"
        "4. Resumo financeiro\n\n"
        f"CLIENTE: {(contact.name if contact and contact.name else proposal.client_name) or proposal.client_name}\n"
        f"PROJETO: {proposal.title}\n"
        f"DADOS DO RELATORIO:\n{report_json}\n\n"
        "Mensagem final com no maximo 2800 caracteres."
    )

    text = await chat_completion(
        [
            {
                "role": "system",
                "content": "Voce escreve mensagens curtas e claras de fechamento comercial para WhatsApp.",
            },
            {"role": "user", "content": prompt},
        ],
        model=settings.MODEL_DELIVERY_WHATSAPP,
        temperature=0.2,
        max_tokens=900,
    )
    return text.strip()[:3900] or _fallback_whatsapp_message(report, proposal, contact)


async def send_delivery_report_to_client(
    db: AsyncSession,
    report: DeliveryReport,
    proposal: Proposal,
) -> str:
    contact = await _resolve_contact(db, proposal)
    phone = (contact.phone if contact and contact.phone else proposal.client_phone or "").strip()
    if not phone:
        raise ValueError("Nao ha telefone para enviar o relatorio")

    message = await build_delivery_report_whatsapp_message(report, proposal, contact)
    sent = await send_whatsapp_message(phone, message)
    if not sent:
        raise RuntimeError("Falha ao enviar mensagem no WhatsApp")

    logger.info("[DELIVERY_REPORT] Sent report %s to %s", report.id, phone)
    return message
