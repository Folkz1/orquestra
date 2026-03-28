"""
Stripe Checkout Router - Community subscription payments

Endpoints:
  POST /checkout  — Create Stripe Checkout session (R$67/month)
  POST /webhook   — Handle Stripe events (payment succeeded → enroll pro)
  POST /portal    — Create Stripe billing portal session
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.config import settings
from app.database import async_session

logger = logging.getLogger(__name__)

router = APIRouter()


class CheckoutRequest(BaseModel):
    phone: str = Field(..., max_length=20, description="WhatsApp phone for enrollment")
    name: str = Field("", max_length=255)
    email: str = Field("", max_length=255)


class CheckoutResponse(BaseModel):
    checkout_url: str
    session_id: str


class PortalRequest(BaseModel):
    customer_id: str


# ─── Create Checkout Session ─────────────────────────────────────────────


@router.post("/checkout", response_model=CheckoutResponse)
async def create_checkout_session(req: CheckoutRequest):
    """Create a Stripe Checkout session for community subscription."""
    if not settings.STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Stripe not configured")

    import stripe
    stripe.api_key = settings.STRIPE_SECRET_KEY

    try:
        session = stripe.checkout.Session.create(
            mode="subscription",
            payment_method_types=["card"],
            line_items=[{
                "price": settings.STRIPE_PRICE_ID,
                "quantity": 1,
            }],
            success_url=settings.COMMUNITY_SUCCESS_URL,
            cancel_url=settings.COMMUNITY_CANCEL_URL,
            metadata={
                "phone": req.phone,
                "name": req.name,
                "source": "community_landing",
            },
            customer_email=req.email or None,
        )
        return CheckoutResponse(
            checkout_url=session.url,
            session_id=session.id,
        )
    except stripe.error.StripeError as e:
        logger.error("[STRIPE] Checkout error: %s", e)
        raise HTTPException(status_code=400, detail=str(e))


# ─── Stripe Webhook ──────────────────────────────────────────────────────


@router.post("/webhook")
async def stripe_webhook(request: Request):
    """Handle Stripe webhook events — auto-enroll on payment success."""
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
            event = stripe.Event.construct_from(
                json.loads(payload), stripe.api_key,
            )
    except (ValueError, stripe.error.SignatureVerificationError) as e:
        logger.error("[STRIPE] Webhook signature failed: %s", e)
        raise HTTPException(status_code=400, detail="Invalid signature")

    event_type = event.get("type", "")
    logger.info("[STRIPE] Event: %s", event_type)

    if event_type == "checkout.session.completed":
        session = event["data"]["object"]
        metadata = session.get("metadata", {})
        phone = metadata.get("phone", "")
        name = metadata.get("name", "")
        customer_email = session.get("customer_email", "")
        customer_id = session.get("customer", "")

        if phone:
            await _enroll_pro_member(phone, name, customer_email, customer_id)

    elif event_type == "invoice.payment_failed":
        invoice = event["data"]["object"]
        customer_id = invoice.get("customer", "")
        customer_email = invoice.get("customer_email", "")
        attempt_count = invoice.get("attempt_count", 0)
        logger.warning(
            "[STRIPE] Payment failed: customer=%s email=%s attempt=%d",
            customer_id, customer_email, attempt_count,
        )

    elif event_type == "customer.subscription.deleted":
        # Downgrade on cancellation
        sub = event["data"]["object"]
        customer_id = sub.get("customer", "")
        if customer_id:
            await _downgrade_member(customer_id)

    return {"received": True}


async def _enroll_pro_member(phone: str, name: str, email: str, stripe_customer_id: str):
    """Enroll or upgrade user to pro tier in playbook."""
    async with async_session() as db:
        # Check if already enrolled
        from sqlalchemy import text
        row = await db.execute(
            text("SELECT id, tier FROM playbook_enrollments WHERE phone = :phone"),
            {"phone": phone},
        )
        existing = row.first()

        if existing:
            # Upgrade to pro
            await db.execute(
                text("UPDATE playbook_enrollments SET tier = 'pro', updated_at = :now WHERE phone = :phone"),
                {"phone": phone, "now": datetime.now(timezone.utc)},
            )
        else:
            # New enrollment
            await db.execute(
                text("""
                    INSERT INTO playbook_enrollments (phone, name, email, tier, enrolled_at, created_at, updated_at)
                    VALUES (:phone, :name, :email, 'pro', :now, :now, :now)
                """),
                {"phone": phone, "name": name, "email": email, "now": datetime.now(timezone.utc)},
            )
        await db.commit()
        logger.info("[STRIPE] Enrolled pro: %s (%s)", phone, name)


async def _downgrade_member(stripe_customer_id: str):
    """Downgrade member when subscription cancelled (future: match by customer_id)."""
    logger.info("[STRIPE] Subscription cancelled for customer: %s", stripe_customer_id)


# ─── Billing Portal ──────────────────────────────────────────────────────


@router.post("/portal")
async def create_portal_session(req: PortalRequest):
    """Create Stripe billing portal session for subscription management."""
    if not settings.STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Stripe not configured")

    import stripe
    stripe.api_key = settings.STRIPE_SECRET_KEY

    try:
        session = stripe.billing_portal.Session.create(
            customer=req.customer_id,
            return_url=settings.COMMUNITY_SUCCESS_URL,
        )
        return {"portal_url": session.url}
    except stripe.error.StripeError as e:
        raise HTTPException(status_code=400, detail=str(e))
