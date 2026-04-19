"""
Stripe Checkout Router - Community subscription payments.

This router owns the public checkout flow, webhook processing, and the
post-checkout status handoff the frontend uses to auto-unlock the member area.
"""

import logging
import re
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.config import settings
from app.database import async_session

logger = logging.getLogger(__name__)

router = APIRouter()

ACTIVE_SUBSCRIPTION_STATUSES = {"active", "trialing", "past_due"}


class CheckoutRequest(BaseModel):
    phone: str = Field(..., max_length=20, description="WhatsApp phone for enrollment")
    name: str = Field("", max_length=255)
    email: str = Field("", max_length=255)


class CheckoutResponse(BaseModel):
    checkout_url: str
    session_id: str


class CheckoutStatusResponse(BaseModel):
    session_id: str
    status: str
    payment_status: str | None = None
    phone: str | None = None
    customer_email: str | None = None
    subscription_status: str | None = None
    current_period_end: str | None = None
    member_ready: bool = False
    member_name: str | None = None
    tier: str | None = None
    role: str | None = None
    community_token: str | None = None


class PortalRequest(BaseModel):
    customer_id: str


def _normalize_phone(phone: str | None) -> str:
    return re.sub(r"\D", "", phone or "")


def _normalize_email(email: str | None) -> str | None:
    clean = (email or "").strip().lower()
    return clean or None


def _is_active_subscription(status: str | None) -> bool:
    return (status or "").strip().lower() in ACTIVE_SUBSCRIPTION_STATUSES


def _make_community_jwt(enrollment_id: str, email: str, role: str) -> str:
    import jwt
    from datetime import timedelta

    payload = {
        "enrollment_id": enrollment_id,
        "email": email,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=72),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, settings.APP_SECRET_KEY or "community-dev-secret", algorithm="HS256")


def _determine_role(tier: str | None, phone: str | None = None) -> str:
    if phone and phone.strip().endswith("5551993448124"):
        return "admin"
    if tier == "pro":
        return "member"
    return "free"


def _timestamp_to_datetime(value) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromtimestamp(int(value), tz=timezone.utc)
    except (TypeError, ValueError, OSError):
        return None


def _build_success_url(phone: str) -> str:
    url = (settings.COMMUNITY_SUCCESS_URL or "").strip()
    if not url:
        raise HTTPException(status_code=503, detail="Community success URL not configured")
    if "enrolled=" not in url:
        url = f"{url}{'&' if '?' in url else '?'}enrolled=true"
    if "session_id={CHECKOUT_SESSION_ID}" not in url:
        url = f"{url}{'&' if '?' in url else '?'}session_id={{CHECKOUT_SESSION_ID}}"
    if "phone=" not in url:
        url = f"{url}{'&' if '?' in url else '?'}phone={phone}"
    return url


async def _get_enrollment_by_phone(phone: str) -> dict | None:
    normalized_phone = _normalize_phone(phone)
    if not normalized_phone:
        return None

    async with async_session() as db:
        result = await db.execute(
            text(
                """
                SELECT id, name, email, phone, tier, is_active,
                       stripe_customer_id, stripe_subscription_id,
                       subscription_status, current_period_end
                FROM playbook_enrollments
                WHERE phone = :phone
                LIMIT 1
                """
            ),
            {"phone": normalized_phone},
        )
        row = result.mappings().first()
        return dict(row) if row else None


async def _upsert_member_subscription(
    phone: str,
    name: str,
    email: str | None,
    stripe_customer_id: str | None,
    stripe_subscription_id: str | None,
    subscription_status: str,
    current_period_end: datetime | None,
):
    normalized_phone = _normalize_phone(phone)
    normalized_email = _normalize_email(email)
    active = _is_active_subscription(subscription_status)
    tier = "pro" if active else "free"
    now = datetime.now(timezone.utc)

    if not normalized_phone:
        logger.warning("[STRIPE] Tried to upsert member without phone")
        return

    async with async_session() as db:
        params = {
            "phone": normalized_phone,
            "customer_id": stripe_customer_id,
            "subscription_id": stripe_subscription_id,
            "name": (name or "").strip() or "Membro",
            "email": normalized_email,
            "tier": tier,
            "is_active": active,
            "subscription_status": subscription_status or ("active" if active else "inactive"),
            "current_period_end": current_period_end,
            "expires_at": current_period_end,
            "now": now,
        }

        result = await db.execute(
            text(
                """
                SELECT id
                FROM playbook_enrollments
                WHERE phone = :phone
                   OR (:customer_id IS NOT NULL AND stripe_customer_id = :customer_id)
                   OR (:subscription_id IS NOT NULL AND stripe_subscription_id = :subscription_id)
                LIMIT 1
                """
            ),
            params,
        )
        existing = result.first()

        if existing:
            await db.execute(
                text(
                    """
                    UPDATE playbook_enrollments
                    SET
                        phone = :phone,
                        name = COALESCE(NULLIF(:name, ''), name),
                        email = COALESCE(NULLIF(:email, ''), email),
                        tier = :tier,
                        is_active = :is_active,
                        stripe_customer_id = COALESCE(:customer_id, stripe_customer_id),
                        stripe_subscription_id = COALESCE(:subscription_id, stripe_subscription_id),
                        subscription_status = :subscription_status,
                        current_period_end = :current_period_end,
                        expires_at = :expires_at,
                        payment_method = 'stripe',
                        updated_at = :now
                    WHERE id = CAST(:id AS uuid)
                    """
                ),
                {**params, "id": str(existing.id)},
            )
        else:
            await db.execute(
                text(
                    """
                    INSERT INTO playbook_enrollments (
                        phone, name, email, tier, is_active,
                        enrolled_at, expires_at, payment_method, notes,
                        created_at, updated_at,
                        stripe_customer_id, stripe_subscription_id,
                        subscription_status, current_period_end
                    )
                    VALUES (
                        :phone, :name, :email, :tier, :is_active,
                        :now, :expires_at, 'stripe', 'Assinatura via Stripe',
                        :now, :now,
                        :customer_id, :subscription_id,
                        :subscription_status, :current_period_end
                    )
                    """
                ),
                params,
            )

        await db.commit()

    logger.info(
        "[STRIPE] Enrollment synced phone=%s customer=%s subscription=%s status=%s",
        normalized_phone,
        stripe_customer_id,
        stripe_subscription_id,
        subscription_status,
    )


async def _sync_member_subscription_status(
    *,
    customer_id: str | None = None,
    subscription_id: str | None = None,
    subscription_status: str,
    current_period_end: datetime | None = None,
):
    clauses = []
    params = {
        "customer_id": customer_id,
        "subscription_id": subscription_id,
        "subscription_status": subscription_status or "inactive",
        "current_period_end": current_period_end,
        "expires_at": current_period_end,
        "tier": "pro" if _is_active_subscription(subscription_status) else "free",
        "is_active": _is_active_subscription(subscription_status),
        "now": datetime.now(timezone.utc),
    }

    if customer_id:
        clauses.append("stripe_customer_id = :customer_id")
    if subscription_id:
        clauses.append("stripe_subscription_id = :subscription_id")

    if not clauses:
        return

    async with async_session() as db:
        result = await db.execute(
            text(
                f"""
                UPDATE playbook_enrollments
                SET
                    tier = :tier,
                    is_active = :is_active,
                    subscription_status = :subscription_status,
                    current_period_end = COALESCE(:current_period_end, current_period_end),
                    expires_at = COALESCE(:expires_at, expires_at),
                    payment_method = 'stripe',
                    updated_at = :now
                WHERE {" OR ".join(clauses)}
                """
            ),
            params,
        )
        await db.commit()

    logger.info(
        "[STRIPE] Subscription state synced customer=%s subscription=%s status=%s affected=%s",
        customer_id,
        subscription_id,
        subscription_status,
        result.rowcount,
    )


async def _downgrade_member(stripe_customer_id: str):
    await _sync_member_subscription_status(
        customer_id=stripe_customer_id,
        subscription_status="canceled",
    )


@router.post("/checkout", response_model=CheckoutResponse)
async def create_checkout_session(req: CheckoutRequest):
    """Create a Stripe Checkout session for the community subscription."""
    if not settings.STRIPE_SECRET_KEY or not settings.STRIPE_PRICE_ID:
        raise HTTPException(status_code=503, detail="Stripe not configured")

    phone = _normalize_phone(req.phone)
    if len(phone) < 12:
        raise HTTPException(status_code=400, detail="Informe um WhatsApp valido com DDI")

    import stripe
    stripe.api_key = settings.STRIPE_SECRET_KEY

    try:
        session = stripe.checkout.Session.create(
            mode="subscription",
            payment_method_types=["card"],
            line_items=[{"price": settings.STRIPE_PRICE_ID, "quantity": 1}],
            success_url=_build_success_url(phone),
            cancel_url=settings.COMMUNITY_CANCEL_URL,
            client_reference_id=phone,
            metadata={
                "phone": phone,
                "name": req.name.strip(),
                "email": _normalize_email(req.email) or "",
                "source": "community_landing",
            },
            customer_email=_normalize_email(req.email),
        )

        if settings.OWNER_WHATSAPP:
            try:
                from app.services.whatsapp import send_whatsapp_message

                msg = (
                    "*Novo lead na comunidade!*\n\n"
                    f"Nome: {req.name.strip() or 'Nao informado'}\n"
                    f"WhatsApp: {phone}\n"
                    f"Email: {_normalize_email(req.email) or 'Nao informado'}\n\n"
                    f"Link de pagamento:\n{session.url}"
                )
                await send_whatsapp_message(settings.OWNER_WHATSAPP, msg)
                logger.info("[STRIPE] Lead notification sent to owner: %s", phone)
            except Exception as exc:
                logger.warning("[STRIPE] Failed to send lead notification: %s", exc)

        return CheckoutResponse(checkout_url=session.url, session_id=session.id)
    except stripe.error.StripeError as exc:
        logger.error("[STRIPE] Checkout error: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/checkout/status", response_model=CheckoutStatusResponse)
async def checkout_status(session_id: str = Query(..., min_length=8)):
    """Return Stripe session status plus enrollment unlock status for the frontend."""
    if not settings.STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Stripe not configured")

    import stripe
    stripe.api_key = settings.STRIPE_SECRET_KEY

    try:
        session = stripe.checkout.Session.retrieve(session_id, expand=["subscription"])
    except stripe.error.StripeError as exc:
        logger.error("[STRIPE] Failed to retrieve session %s: %s", session_id, exc)
        raise HTTPException(status_code=400, detail=str(exc))

    metadata = session.get("metadata", {}) or {}
    phone = _normalize_phone(metadata.get("phone") or session.get("client_reference_id") or "")
    subscription = session.get("subscription")
    subscription_status = None
    current_period_end = None

    if subscription:
        subscription_status = subscription.get("status")
        current_period_end = _timestamp_to_datetime(subscription.get("current_period_end"))

    enrollment = await _get_enrollment_by_phone(phone)
    member_ready = False
    member_name = None
    tier = None
    role = None
    community_token = None

    session_paid = (
        session.get("payment_status") == "paid"
        or session.get("status") == "complete"
    )

    if session_paid and enrollment and enrollment.get("tier") == "pro" and enrollment.get("is_active", True):
        member_ready = True
        member_name = enrollment.get("name") or "Membro"
        tier = enrollment.get("tier")
        role = _determine_role(enrollment.get("tier"), enrollment.get("phone"))
        community_token = _make_community_jwt(
            str(enrollment["id"]),
            enrollment.get("email") or "",
            role,
        )

    return CheckoutStatusResponse(
        session_id=session.get("id", session_id),
        status=session.get("status", ""),
        payment_status=session.get("payment_status"),
        phone=phone or None,
        customer_email=session.get("customer_email") or _normalize_email(metadata.get("email")),
        subscription_status=subscription_status or (enrollment.get("subscription_status") if enrollment else None),
        current_period_end=(
            current_period_end.isoformat()
            if current_period_end
            else (
                enrollment.get("current_period_end").isoformat()
                if enrollment and enrollment.get("current_period_end")
                else None
            )
        ),
        member_ready=member_ready,
        member_name=member_name,
        tier=tier,
        role=role,
        community_token=community_token,
    )


@router.post("/webhook")
async def stripe_webhook(request: Request):
    """Handle Stripe webhook events and keep community enrollment in sync."""
    if not settings.STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Stripe not configured")

    import stripe
    stripe.api_key = settings.STRIPE_SECRET_KEY

    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    try:
        if settings.STRIPE_WEBHOOK_SECRET:
            event = stripe.Webhook.construct_event(
                payload, sig_header, settings.STRIPE_WEBHOOK_SECRET,
            )
        else:
            import json

            event = stripe.Event.construct_from(json.loads(payload), stripe.api_key)
    except (ValueError, stripe.error.SignatureVerificationError) as exc:
        logger.error("[STRIPE] Webhook signature failed: %s", exc)
        raise HTTPException(status_code=400, detail="Invalid signature")

    event_type = event.get("type", "")
    logger.info("[STRIPE] Event: %s", event_type)

    if event_type == "checkout.session.completed":
        session = event["data"]["object"]
        metadata = session.get("metadata", {}) or {}
        phone = _normalize_phone(metadata.get("phone") or session.get("client_reference_id") or "")
        name = (metadata.get("name") or "").strip()
        customer_email = _normalize_email(session.get("customer_email") or metadata.get("email"))
        customer_id = session.get("customer", "")
        subscription_id = session.get("subscription", "")
        subscription_status = "active"
        current_period_end = None

        if subscription_id:
            try:
                subscription = stripe.Subscription.retrieve(subscription_id)
                subscription_status = subscription.get("status", "active")
                current_period_end = _timestamp_to_datetime(subscription.get("current_period_end"))
            except stripe.error.StripeError as exc:
                logger.warning("[STRIPE] Failed to retrieve subscription %s: %s", subscription_id, exc)

        if phone:
            await _upsert_member_subscription(
                phone=phone,
                name=name,
                email=customer_email,
                stripe_customer_id=customer_id,
                stripe_subscription_id=subscription_id,
                subscription_status=subscription_status,
                current_period_end=current_period_end,
            )

    elif event_type in {"customer.subscription.created", "customer.subscription.updated"}:
        subscription = event["data"]["object"]
        await _sync_member_subscription_status(
            customer_id=subscription.get("customer"),
            subscription_id=subscription.get("id"),
            subscription_status=subscription.get("status", "inactive"),
            current_period_end=_timestamp_to_datetime(subscription.get("current_period_end")),
        )

    elif event_type == "invoice.paid":
        invoice = event["data"]["object"]
        await _sync_member_subscription_status(
            customer_id=invoice.get("customer"),
            subscription_id=invoice.get("subscription"),
            subscription_status="active",
        )

    elif event_type == "invoice.payment_failed":
        invoice = event["data"]["object"]
        customer_id = invoice.get("customer", "")
        customer_email = invoice.get("customer_email", "")
        attempt_count = invoice.get("attempt_count", 0)
        logger.warning(
            "[STRIPE] Payment failed: customer=%s email=%s attempt=%d",
            customer_id,
            customer_email,
            attempt_count,
        )
        await _sync_member_subscription_status(
            customer_id=customer_id,
            subscription_id=invoice.get("subscription"),
            subscription_status="past_due",
        )

    elif event_type == "customer.subscription.deleted":
        subscription = event["data"]["object"]
        customer_id = subscription.get("customer", "")
        if customer_id:
            await _downgrade_member(customer_id)

    return {"received": True}


@router.post("/portal")
async def create_portal_session(req: PortalRequest):
    """Create Stripe billing portal session for subscription management."""
    if not settings.STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Stripe not configured")
    if not req.customer_id.strip():
        raise HTTPException(status_code=400, detail="Customer ID is required")

    import stripe
    stripe.api_key = settings.STRIPE_SECRET_KEY

    try:
        session = stripe.billing_portal.Session.create(
            customer=req.customer_id.strip(),
            return_url=settings.COMMUNITY_SUCCESS_URL,
        )
        return {"portal_url": session.url}
    except stripe.error.StripeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
