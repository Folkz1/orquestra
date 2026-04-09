"""
Community Platform — GuyFolkz (Skool-style)
Auth: magic-link by email (MVP: code logged, not emailed)
Feed: posts, comments, likes
Members: list active members
Resources: downloadable files for pro tier

Auth endpoints:
  POST /auth/login    — Generate 6-digit code for email (pro members only)
  POST /auth/verify   — Validate code, return JWT
  GET  /me            — Current member profile

Feed endpoints:
  GET    /feed                    — Paginated feed (pinned first)
  POST   /post                   — Create post (auth required)
  DELETE /post/{post_id}          — Delete post (own or admin)
  POST   /post/{post_id}/like    — Toggle like
  GET    /post/{post_id}/comments — List comments
  POST   /post/{post_id}/comment  — Add comment (auth required)
  DELETE /comment/{comment_id}    — Delete comment (own or admin)

Members:
  GET /members — List active members

Resources:
  GET  /resources                       — List resources
  POST /resource/{resource_id}/download — Increment count + return URL
"""

import logging
import random
import time
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

import jwt
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import text, select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db

logger = logging.getLogger(__name__)

router = APIRouter()

MANUAL_TRIAL_HOURS = 6
MANUAL_TRIAL_PAYMENT_METHOD = "manual_whatsapp_pending"
MANUAL_PAID_PAYMENT_METHOD = "manual_whatsapp_paid"
TRIAL_REDIRECT_URL = "/membros?trial=1"
DEFAULT_ADMIN_PHONES = ("5551993448124", "51993448124")

# ─── JWT Config ──────────────────────────────────────────────────────────

COMMUNITY_JWT_SECRET = settings.APP_SECRET_KEY or "community-dev-secret"
COMMUNITY_JWT_ALGORITHM = "HS256"
COMMUNITY_JWT_EXPIRE_HOURS = 72

# ─── In-memory code store (MVP — no email sending) ──────────────────────

# { email: { "code": "123456", "expires": timestamp } }
_pending_codes: dict[str, dict] = {}
CODE_EXPIRY_SECONDS = 600  # 10 minutes


# ─── Pydantic Schemas ───────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: str = Field(..., max_length=320)


class VerifyRequest(BaseModel):
    email: str = Field(..., max_length=320)
    code: str = Field(..., min_length=6, max_length=6)


class TokenResponse(BaseModel):
    token: str
    enrollment_id: str
    name: str
    role: str


class CommunityLeadRequest(BaseModel):
    phone: str = Field(..., min_length=8, max_length=20)
    name: str = Field("", max_length=255)
    email: str = Field("", max_length=320)


class CommunityLeadResponse(BaseModel):
    status: str
    redirect_url: str | None = None
    expires_at: str | None = None
    phone: str
    access_mode: str
    message: str


class MemberProfile(BaseModel):
    enrollment_id: str
    email: str
    name: str
    phone: str | None
    tier: str
    role: str
    enrolled_at: str | None
    is_active: bool = True
    subscription_status: str | None = None
    current_period_end: str | None = None
    expires_at: str | None = None
    payment_method: str | None = None
    access_mode: str = "free"
    has_billing_portal: bool = False


class PostCreate(BaseModel):
    content_md: str = Field(..., min_length=1, max_length=20000)
    post_type: str = Field("discussion", max_length=50)


class CommentCreate(BaseModel):
    content_md: str = Field(..., min_length=1, max_length=5000)


class PostOut(BaseModel):
    id: str
    author_name: str
    author_role: str
    content_md: str
    post_type: str
    likes_count: int
    comments_count: int
    pinned: bool
    created_at: str
    liked_by_me: bool = False


class CommentOut(BaseModel):
    id: str
    post_id: str
    author_name: str
    content_md: str
    likes_count: int
    created_at: str


class MemberOut(BaseModel):
    enrollment_id: str
    name: str
    role: str
    enrolled_at: str | None
    post_count: int


class ResourceOut(BaseModel):
    id: str
    title: str
    description: str | None
    resource_type: str | None
    tier: str
    downloads_count: int
    created_at: str


# ─── Auth dependency ────────────────────────────────────────────────────

class CurrentMember:
    """Decoded JWT payload for a community member."""

    def __init__(self, enrollment_id: str, email: str, role: str):
        self.enrollment_id = enrollment_id
        self.email = email
        self.role = role


async def get_current_member(request: Request) -> Optional[CurrentMember]:
    """Extract and decode community JWT from Authorization header.
    Returns None if no token or invalid — some endpoints allow anonymous read.
    """
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header[7:]
    try:
        payload = jwt.decode(token, COMMUNITY_JWT_SECRET, algorithms=[COMMUNITY_JWT_ALGORITHM])
        return CurrentMember(
            enrollment_id=payload["enrollment_id"],
            email=payload["email"],
            role=payload.get("role", "member"),
        )
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError, KeyError):
        return None


def require_member(member: Optional[CurrentMember] = Depends(get_current_member)) -> CurrentMember:
    """Dependency that REQUIRES a valid community JWT."""
    if member is None:
        raise HTTPException(status_code=401, detail="Community authentication required")
    return member


# ─── Helpers ─────────────────────────────────────────────────────────────

def _determine_role(tier: str, phone: str | None = None) -> str:
    """Determine member role based on tier and identity."""
    normalized_phone = _normalize_phone(phone)
    owner_phone = _normalize_phone(settings.OWNER_WHATSAPP)
    admin_phones = set(DEFAULT_ADMIN_PHONES)
    if owner_phone:
        admin_phones.add(owner_phone)

    if normalized_phone in admin_phones:
        return "admin"
    if tier == "pro":
        return "member"
    return "free"


def _normalize_phone(phone: str | None) -> str:
    digits = "".join(ch for ch in (phone or "") if ch.isdigit())
    return digits


def _normalize_email(email: str | None) -> str | None:
    clean = (email or "").strip().lower()
    return clean or None


def _owner_whatsapp_target() -> str | None:
    owner_phone = _normalize_phone(settings.OWNER_WHATSAPP)
    if owner_phone:
        return owner_phone
    for phone in DEFAULT_ADMIN_PHONES:
        normalized = _normalize_phone(phone)
        if normalized:
            return normalized
    return None


def _row_value(row, key: str):
    if row is None:
        return None
    if isinstance(row, dict):
        return row.get(key)
    if hasattr(row, key):
        return getattr(row, key)
    try:
        return row[key]
    except Exception:
        return None


def _access_mode_from_record(row) -> str:
    payment_method = (_row_value(row, "payment_method") or "").strip()
    expires_at = _row_value(row, "expires_at")
    tier = (_row_value(row, "tier") or "free").strip()
    is_active = _row_value(row, "is_active")
    active = True if is_active is None else bool(is_active)
    now = datetime.now(timezone.utc)

    if payment_method == MANUAL_TRIAL_PAYMENT_METHOD:
        if not active or (expires_at and expires_at <= now):
            return "expired_trial"
        return "manual_trial"

    if tier == "pro" and active:
        if payment_method == MANUAL_PAID_PAYMENT_METHOD:
            return "paid_manual"
        return "member"

    return "free"


def _has_active_content_access(row) -> bool:
    return _access_mode_from_record(row) in {"manual_trial", "paid_manual", "member"}


def _trial_expired_detail() -> dict:
    return {
        "code": "trial_expired",
        "message": "Seu acesso de 6 horas expirou. Responde meu WhatsApp para concluir a assinatura.",
    }


def _role_for_enrollment(row) -> str:
    role = _determine_role(_row_value(row, "tier") or "free", _row_value(row, "phone"))
    if role == "admin":
        return role
    if _access_mode_from_record(row) == "manual_trial":
        return "trial"
    if _has_active_content_access(row):
        return "member"
    return "free"


async def _get_enrollment_by_phone(db: AsyncSession, phone: str):
    normalized_phone = _normalize_phone(phone)
    if not normalized_phone:
        return None

    result = await db.execute(
        text(
            """
            SELECT id, name, email, tier, phone, is_active, enrolled_at, expires_at,
                   payment_method, notes
            FROM playbook_enrollments
            WHERE phone = :phone
            LIMIT 1
            """
        ),
        {"phone": normalized_phone},
    )
    return result.mappings().first()


async def _get_enrollment_by_id(db: AsyncSession, enrollment_id: str):
    result = await db.execute(
        text(
            """
            SELECT id, name, email, tier, phone, is_active, enrolled_at, expires_at,
                   payment_method, notes
            FROM playbook_enrollments
            WHERE id = CAST(:id AS uuid)
            LIMIT 1
            """
        ),
        {"id": enrollment_id},
    )
    return result.mappings().first()


async def _require_content_access(db: AsyncSession, member: CurrentMember):
    enrollment = await _get_enrollment_by_id(db, member.enrollment_id)
    if not enrollment:
        raise HTTPException(status_code=404, detail="Member not found")

    access_mode = _access_mode_from_record(enrollment)
    if access_mode == "expired_trial":
        raise HTTPException(status_code=403, detail=_trial_expired_detail())
    if not _has_active_content_access(enrollment) and member.role != "admin":
        raise HTTPException(status_code=403, detail="Community access not active")

    return enrollment, access_mode


async def _require_social_access(db: AsyncSession, member: CurrentMember):
    enrollment, access_mode = await _require_content_access(db, member)
    if access_mode == "manual_trial" and member.role != "admin":
        raise HTTPException(
            status_code=403,
            detail={"code": "trial_content_only", "message": "O trial de 6 horas libera apenas o conteudo."},
        )
    return enrollment, access_mode


async def _notify_owner_about_lead(*, phone: str, name: str, email: str | None, status: str, expires_at: datetime | None):
    owner_target = _owner_whatsapp_target()
    if not owner_target:
        logger.info("[COMMUNITY] OWNER_WHATSAPP not configured, lead stored without WhatsApp alert")
        return

    try:
        from app.services.whatsapp import send_whatsapp_message

        expires_text = expires_at.astimezone(timezone.utc).strftime("%d/%m %H:%M UTC") if expires_at else "sem expiracao"
        message = (
            "*Lead da comunidade*\n\n"
            f"Status: {status}\n"
            f"Nome: {name or 'Nao informado'}\n"
            f"WhatsApp: {phone}\n"
            f"Email: {email or 'Nao informado'}\n"
            f"Expira: {expires_text}"
        )
        await send_whatsapp_message(owner_target, message)
    except Exception as exc:
        logger.warning("[COMMUNITY] Failed to send owner WhatsApp alert for %s: %s", phone, exc)


def _generate_code() -> str:
    return f"{random.randint(0, 999999):06d}"


def _make_jwt(enrollment_id: str, email: str, role: str) -> str:
    payload = {
        "enrollment_id": enrollment_id,
        "email": email,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=COMMUNITY_JWT_EXPIRE_HOURS),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, COMMUNITY_JWT_SECRET, algorithm=COMMUNITY_JWT_ALGORITHM)


# ─── AUTH ENDPOINTS ──────────────────────────────────────────────────────


@router.post("/lead", response_model=CommunityLeadResponse)
async def capture_community_lead(req: CommunityLeadRequest, db: AsyncSession = Depends(get_db)):
    """Capture a lead, create or reuse a 6-hour manual trial, and alert the owner on WhatsApp."""
    phone = _normalize_phone(req.phone)
    if len(phone) < 12:
        raise HTTPException(status_code=400, detail={"message": "Informe um WhatsApp valido com DDI."})

    email = _normalize_email(req.email)
    name = (req.name or "").strip() or "Membro"
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(hours=MANUAL_TRIAL_HOURS)
    note = f"[community_manual_lead {now.isoformat()}]"

    enrollment = await _get_enrollment_by_phone(db, phone)
    access_mode = _access_mode_from_record(enrollment)

    if enrollment and (_role_for_enrollment(enrollment) == "admin" or access_mode in {"paid_manual", "member"}):
        return CommunityLeadResponse(
            status="already_active",
            redirect_url="/membros",
            expires_at=_row_value(enrollment, "expires_at").isoformat() if _row_value(enrollment, "expires_at") else None,
            phone=phone,
            access_mode=access_mode,
            message="Teu acesso ja esta ativo. Pode entrar direto na area de membros.",
        )

    if enrollment and access_mode == "manual_trial":
        await db.execute(
            text(
                """
                UPDATE playbook_enrollments
                SET name = COALESCE(NULLIF(:name, ''), name),
                    email = COALESCE(NULLIF(:email, ''), email),
                    notes = CASE
                        WHEN COALESCE(notes, '') = '' THEN :note
                        ELSE notes || E'\n' || :note
                    END
                WHERE id = CAST(:id AS uuid)
                """
            ),
            {"id": str(enrollment["id"]), "name": name, "email": email, "note": note},
        )
        await db.commit()
        await _notify_owner_about_lead(
            phone=phone,
            name=name,
            email=email,
            status="trial_reused",
            expires_at=_row_value(enrollment, "expires_at"),
        )
        return CommunityLeadResponse(
            status="trial_reused",
            redirect_url=TRIAL_REDIRECT_URL,
            expires_at=_row_value(enrollment, "expires_at").isoformat() if _row_value(enrollment, "expires_at") else None,
            phone=phone,
            access_mode="manual_trial",
            message="Teu acesso ainda esta ativo. Entrando na area de membros agora.",
        )

    if enrollment and access_mode == "expired_trial":
        await db.execute(
            text(
                """
                UPDATE playbook_enrollments
                SET name = COALESCE(NULLIF(:name, ''), name),
                    email = COALESCE(NULLIF(:email, ''), email),
                    notes = CASE
                        WHEN COALESCE(notes, '') = '' THEN :note
                        ELSE notes || E'\n' || :note
                    END
                WHERE id = CAST(:id AS uuid)
                """
            ),
            {"id": str(enrollment["id"]), "name": name, "email": email, "note": note},
        )
        await db.commit()
        await _notify_owner_about_lead(
            phone=phone,
            name=name,
            email=email,
            status="trial_expired_returning_lead",
            expires_at=_row_value(enrollment, "expires_at"),
        )
        return CommunityLeadResponse(
            status="trial_already_used",
            redirect_url=None,
            expires_at=_row_value(enrollment, "expires_at").isoformat() if _row_value(enrollment, "expires_at") else None,
            phone=phone,
            access_mode="expired_trial",
            message="Teu acesso gratuito ja foi usado. Vou te chamar no WhatsApp para concluir a assinatura.",
        )

    if enrollment:
        await db.execute(
            text(
                """
                UPDATE playbook_enrollments
                SET tier = 'pro',
                    is_active = true,
                    expires_at = :expires_at,
                    payment_method = :payment_method,
                    name = COALESCE(NULLIF(:name, ''), name),
                    email = COALESCE(NULLIF(:email, ''), email),
                    notes = CASE
                        WHEN COALESCE(notes, '') = '' THEN :note
                        ELSE notes || E'\n' || :note
                    END
                WHERE id = CAST(:id AS uuid)
                """
            ),
            {
                "id": str(enrollment["id"]),
                "expires_at": expires_at,
                "payment_method": MANUAL_TRIAL_PAYMENT_METHOD,
                "name": name,
                "email": email,
                "note": note,
            },
        )
    else:
        await db.execute(
            text(
                """
                INSERT INTO playbook_enrollments (
                    phone, name, email, tier, is_active, enrolled_at, expires_at, payment_method, notes
                )
                VALUES (
                    :phone, :name, :email, 'pro', true, :enrolled_at, :expires_at, :payment_method, :note
                )
                """
            ),
            {
                "phone": phone,
                "name": name,
                "email": email,
                "enrolled_at": now,
                "expires_at": expires_at,
                "payment_method": MANUAL_TRIAL_PAYMENT_METHOD,
                "note": note,
            },
        )

    await db.commit()
    await _notify_owner_about_lead(
        phone=phone,
        name=name,
        email=email,
        status="trial_started",
        expires_at=expires_at,
    )

    return CommunityLeadResponse(
        status="trial_started",
        redirect_url=TRIAL_REDIRECT_URL,
        expires_at=expires_at.isoformat(),
        phone=phone,
        access_mode="manual_trial",
        message="Teu acesso foi liberado por 6 horas. Entrando na area de membros agora.",
    )


@router.post("/auth/login")
async def auth_login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    """Generate a 6-digit code for a pro member's email.
    MVP: code is logged to stdout, not actually emailed.
    """
    email = req.email.lower().strip()

    # Check if email exists in playbook_enrollments with tier='pro'
    result = await db.execute(
        text(
            """
            SELECT id, name, tier, phone, is_active
            FROM playbook_enrollments
            WHERE LOWER(email) = :email
            LIMIT 1
            """
        ),
        {"email": email},
    )
    row = result.first()

    if not row:
        # Don't reveal whether email exists — return same response
        logger.info("[COMMUNITY] Login attempt for unknown email: %s", email)
        return {"status": "code_sent"}

    if row.tier != "pro" or row.is_active is False:
        logger.info("[COMMUNITY] Login attempt for non-pro/inactive member: %s (tier=%s)", email, row.tier)
        return {"status": "code_sent"}

    code = _generate_code()
    _pending_codes[email] = {
        "code": code,
        "expires": time.time() + CODE_EXPIRY_SECONDS,
        "enrollment_id": str(row.id),
        "name": row.name or "Membro",
        "phone": row.phone,
        "tier": row.tier,
    }

    # Enviar codigo via WhatsApp se tiver telefone
    if row.phone:
        try:
            from app.services.whatsapp import send_whatsapp_message
            await send_whatsapp_message(
                row.phone,
                f"Seu codigo de acesso GuyFolkz: *{code}*\n\nVale por 10 minutos.",
            )
            logger.info("[COMMUNITY] Auth code sent via WhatsApp to %s", email)
        except Exception as exc:
            logger.warning("[COMMUNITY] Failed to send WhatsApp code to %s: %s — code logged", email, exc)
            logger.info("[COMMUNITY] *** AUTH CODE for %s: %s ***", email, code)
    else:
        logger.info("[COMMUNITY] No phone for %s, code logged: %s", email, code)

    return {"status": "code_sent"}


@router.post("/auth/verify", response_model=TokenResponse)
async def auth_verify(req: VerifyRequest):
    """Validate the 6-digit code and return a JWT."""
    email = req.email.lower().strip()
    pending = _pending_codes.get(email)

    if not pending:
        raise HTTPException(status_code=401, detail="No pending code for this email")

    # Check expiry
    if time.time() > pending["expires"]:
        _pending_codes.pop(email, None)
        raise HTTPException(status_code=401, detail="Code expired")

    if pending["code"] != req.code:
        raise HTTPException(status_code=401, detail="Invalid code")

    # Code is valid — clean up and issue JWT
    _pending_codes.pop(email, None)

    enrollment_id = pending["enrollment_id"]
    name = pending["name"]
    role = _determine_role(pending["tier"], pending.get("phone"))

    token = _make_jwt(enrollment_id, email, role)

    logger.info("[COMMUNITY] Verified login: %s (role=%s)", email, role)

    return TokenResponse(
        token=token,
        enrollment_id=enrollment_id,
        name=name,
        role=role,
    )


class PhoneLoginRequest(BaseModel):
    phone: str = Field(..., min_length=8, max_length=20)


@router.post("/auth/login-phone", response_model=TokenResponse)
async def auth_login_phone(req: PhoneLoginRequest, db: AsyncSession = Depends(get_db)):
    """Issue JWT directly for a phone number that exists in playbook_enrollments as pro.
    Used by CommunityMembers.jsx to bridge WhatsApp-based auth to community JWT.
    """
    phone = _normalize_phone(req.phone)

    row = await _get_enrollment_by_phone(db, phone)
    if not row:
        raise HTTPException(status_code=403, detail="Phone not found or not pro member")

    access_mode = _access_mode_from_record(row)
    if access_mode == "expired_trial":
        raise HTTPException(status_code=403, detail=_trial_expired_detail())
    if not _has_active_content_access(row) and _role_for_enrollment(row) != "admin":
        raise HTTPException(status_code=403, detail="Phone not found or not pro member")

    enrollment_id = str(row["id"])
    email = row["email"] or ""
    role = _role_for_enrollment(row)
    token = _make_jwt(enrollment_id, email, role)

    logger.info("[COMMUNITY] Phone login: %s (role=%s)", phone, role)

    return TokenResponse(
        token=token,
        enrollment_id=enrollment_id,
        name=row["name"] or "Membro",
        role=role,
    )


@router.get("/me", response_model=MemberProfile)
async def get_me(
    member: CurrentMember = Depends(require_member),
    db: AsyncSession = Depends(get_db),
):
    """Return current member profile from enrollment data."""
    row = await _get_enrollment_by_id(db, member.enrollment_id)
    if not row:
        raise HTTPException(status_code=404, detail="Member not found")

    access_mode = _access_mode_from_record(row)
    if access_mode == "expired_trial":
        raise HTTPException(status_code=403, detail=_trial_expired_detail())

    return MemberProfile(
        enrollment_id=str(row["id"]),
        email=row["email"] or member.email,
        name=row["name"] or "Membro",
        phone=row["phone"],
        tier=row["tier"],
        role=member.role,
        enrolled_at=row["enrolled_at"].isoformat() if row["enrolled_at"] else None,
        is_active=True if row["is_active"] is None else bool(row["is_active"]),
        subscription_status=None,
        current_period_end=None,
        expires_at=row["expires_at"].isoformat() if row["expires_at"] else None,
        payment_method=row["payment_method"],
        access_mode=access_mode,
        has_billing_portal=False,
    )


@router.post("/billing/portal")
async def create_billing_portal(
    member: CurrentMember = Depends(require_member),
    db: AsyncSession = Depends(get_db),
):
    """Manual WhatsApp flow does not expose a billing portal."""
    raise HTTPException(status_code=410, detail="Billing portal desabilitado neste fluxo manual")


# ─── FEED ENDPOINTS ─────────────────────────────────────────────────────


@router.get("/feed")
async def get_feed(
    limit: int = Query(20, le=100),
    offset: int = Query(0),
    member: Optional[CurrentMember] = Depends(get_current_member),
    db: AsyncSession = Depends(get_db),
):
    """Paginated feed. Pinned posts always on top, then newest first."""
    # Total count
    count_result = await db.execute(text("SELECT COUNT(*) FROM community_posts"))
    total = count_result.scalar()

    # Fetch posts — pinned first, then by created_at desc
    result = await db.execute(
        text("""
            SELECT id, author_enrollment_id, author_name, author_role,
                   content_md, post_type, likes_count, comments_count,
                   pinned, created_at
            FROM community_posts
            ORDER BY pinned DESC, created_at DESC
            LIMIT :limit OFFSET :offset
        """),
        {"limit": limit, "offset": offset},
    )
    rows = result.fetchall()

    # If logged in, check which posts the member liked
    liked_post_ids: set[str] = set()
    if member and rows:
        post_ids = [str(r.id) for r in rows]
        likes_result = await db.execute(
            text("""
                SELECT post_id FROM community_likes
                WHERE enrollment_id = CAST(:eid AS uuid) AND post_id IS NOT NULL
            """),
            {"eid": member.enrollment_id},
        )
        liked_post_ids = {str(r.post_id) for r in likes_result.fetchall()}

    posts = [
        PostOut(
            id=str(r.id),
            author_name=r.author_name,
            author_role=r.author_role,
            content_md=r.content_md,
            post_type=r.post_type,
            likes_count=r.likes_count,
            comments_count=r.comments_count,
            pinned=r.pinned,
            created_at=r.created_at.isoformat() if r.created_at else "",
            liked_by_me=str(r.id) in liked_post_ids,
        ).model_dump()
        for r in rows
    ]

    return {"total": total, "posts": posts}


@router.post("/post")
async def create_post(
    data: PostCreate,
    member: CurrentMember = Depends(require_member),
    db: AsyncSession = Depends(get_db),
):
    """Create a new community post (auth required)."""
    await _require_social_access(db, member)

    # Get author name from enrollment
    enroll = await db.execute(
        text("SELECT name FROM playbook_enrollments WHERE id = CAST(:id AS uuid)"),
        {"id": member.enrollment_id},
    )
    row = enroll.first()
    author_name = row.name if row else "Membro"

    result = await db.execute(
        text("""
            INSERT INTO community_posts (author_enrollment_id, author_name, author_role, content_md, post_type)
            VALUES (CAST(:eid AS uuid), :name, :role, :content, :ptype)
            RETURNING id, author_name, author_role, content_md, post_type,
                      likes_count, comments_count, pinned, created_at
        """),
        {
            "eid": member.enrollment_id,
            "name": author_name,
            "role": member.role,
            "content": data.content_md,
            "ptype": data.post_type,
        },
    )
    r = result.first()
    await db.commit()

    logger.info("[COMMUNITY] Post created by %s: %s", author_name, str(r.id)[:8])

    return PostOut(
        id=str(r.id),
        author_name=r.author_name,
        author_role=r.author_role,
        content_md=r.content_md,
        post_type=r.post_type,
        likes_count=r.likes_count,
        comments_count=r.comments_count,
        pinned=r.pinned,
        created_at=r.created_at.isoformat() if r.created_at else "",
    ).model_dump()


@router.delete("/post/{post_id}")
async def delete_post(
    post_id: str,
    member: CurrentMember = Depends(require_member),
    db: AsyncSession = Depends(get_db),
):
    """Delete a post — own post or admin can delete any."""
    result = await db.execute(
        text("SELECT id, author_enrollment_id FROM community_posts WHERE id = CAST(:pid AS uuid)"),
        {"pid": post_id},
    )
    post = result.first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    await _require_social_access(db, member)

    # Check ownership or admin
    is_owner = str(post.author_enrollment_id) == member.enrollment_id
    if not is_owner and member.role != "admin":
        raise HTTPException(status_code=403, detail="Not authorized to delete this post")

    # Delete associated likes and comments (cascade handles comments, but likes reference post_id)
    await db.execute(
        text("DELETE FROM community_likes WHERE post_id = CAST(:pid AS uuid)"),
        {"pid": post_id},
    )
    await db.execute(
        text("DELETE FROM community_posts WHERE id = CAST(:pid AS uuid)"),
        {"pid": post_id},
    )
    await db.commit()

    logger.info("[COMMUNITY] Post %s deleted by %s", post_id[:8], member.email)
    return {"ok": True}


@router.post("/post/{post_id}/like")
async def toggle_like(
    post_id: str,
    member: CurrentMember = Depends(require_member),
    db: AsyncSession = Depends(get_db),
):
    """Toggle like on a post. Returns new like state and count."""
    await _require_social_access(db, member)

    # Check post exists
    post_check = await db.execute(
        text("SELECT id FROM community_posts WHERE id = CAST(:pid AS uuid)"),
        {"pid": post_id},
    )
    if not post_check.first():
        raise HTTPException(status_code=404, detail="Post not found")

    # Check if already liked
    existing = await db.execute(
        text("""
            SELECT id FROM community_likes
            WHERE enrollment_id = CAST(:eid AS uuid) AND post_id = CAST(:pid AS uuid)
        """),
        {"eid": member.enrollment_id, "pid": post_id},
    )

    if existing.first():
        # Unlike
        await db.execute(
            text("""
                DELETE FROM community_likes
                WHERE enrollment_id = CAST(:eid AS uuid) AND post_id = CAST(:pid AS uuid)
            """),
            {"eid": member.enrollment_id, "pid": post_id},
        )
        await db.execute(
            text("UPDATE community_posts SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = CAST(:pid AS uuid)"),
            {"pid": post_id},
        )
        liked = False
    else:
        # Like
        await db.execute(
            text("""
                INSERT INTO community_likes (enrollment_id, post_id)
                VALUES (CAST(:eid AS uuid), CAST(:pid AS uuid))
            """),
            {"eid": member.enrollment_id, "pid": post_id},
        )
        await db.execute(
            text("UPDATE community_posts SET likes_count = likes_count + 1 WHERE id = CAST(:pid AS uuid)"),
            {"pid": post_id},
        )
        liked = True

    await db.commit()

    # Get updated count
    count_result = await db.execute(
        text("SELECT likes_count FROM community_posts WHERE id = CAST(:pid AS uuid)"),
        {"pid": post_id},
    )
    new_count = count_result.scalar()

    return {"liked": liked, "likes_count": new_count}


@router.get("/post/{post_id}/comments")
async def get_comments(
    post_id: str,
    limit: int = Query(50, le=200),
    offset: int = Query(0),
    db: AsyncSession = Depends(get_db),
):
    """List comments for a post, oldest first."""
    # Check post exists
    post_check = await db.execute(
        text("SELECT id FROM community_posts WHERE id = CAST(:pid AS uuid)"),
        {"pid": post_id},
    )
    if not post_check.first():
        raise HTTPException(status_code=404, detail="Post not found")

    result = await db.execute(
        text("""
            SELECT id, post_id, author_name, content_md, likes_count, created_at
            FROM community_comments
            WHERE post_id = CAST(:pid AS uuid)
            ORDER BY created_at ASC
            LIMIT :limit OFFSET :offset
        """),
        {"pid": post_id, "limit": limit, "offset": offset},
    )
    rows = result.fetchall()

    count_result = await db.execute(
        text("SELECT COUNT(*) FROM community_comments WHERE post_id = CAST(:pid AS uuid)"),
        {"pid": post_id},
    )
    total = count_result.scalar()

    comments = [
        CommentOut(
            id=str(r.id),
            post_id=str(r.post_id),
            author_name=r.author_name,
            content_md=r.content_md,
            likes_count=r.likes_count,
            created_at=r.created_at.isoformat() if r.created_at else "",
        ).model_dump()
        for r in rows
    ]

    return {"total": total, "comments": comments}


@router.post("/post/{post_id}/comment")
async def create_comment(
    post_id: str,
    data: CommentCreate,
    member: CurrentMember = Depends(require_member),
    db: AsyncSession = Depends(get_db),
):
    """Add a comment to a post (auth required)."""
    await _require_social_access(db, member)

    # Check post exists
    post_check = await db.execute(
        text("SELECT id FROM community_posts WHERE id = CAST(:pid AS uuid)"),
        {"pid": post_id},
    )
    if not post_check.first():
        raise HTTPException(status_code=404, detail="Post not found")

    # Get author name
    enroll = await db.execute(
        text("SELECT name FROM playbook_enrollments WHERE id = CAST(:id AS uuid)"),
        {"id": member.enrollment_id},
    )
    row = enroll.first()
    author_name = row.name if row else "Membro"

    # Insert comment
    result = await db.execute(
        text("""
            INSERT INTO community_comments (post_id, author_enrollment_id, author_name, content_md)
            VALUES (CAST(:pid AS uuid), CAST(:eid AS uuid), :name, :content)
            RETURNING id, post_id, author_name, content_md, likes_count, created_at
        """),
        {
            "pid": post_id,
            "eid": member.enrollment_id,
            "name": author_name,
            "content": data.content_md,
        },
    )
    r = result.first()

    # Increment comments_count on the post
    await db.execute(
        text("UPDATE community_posts SET comments_count = comments_count + 1 WHERE id = CAST(:pid AS uuid)"),
        {"pid": post_id},
    )
    await db.commit()

    logger.info("[COMMUNITY] Comment on post %s by %s", post_id[:8], author_name)

    return CommentOut(
        id=str(r.id),
        post_id=str(r.post_id),
        author_name=r.author_name,
        content_md=r.content_md,
        likes_count=r.likes_count,
        created_at=r.created_at.isoformat() if r.created_at else "",
    ).model_dump()


@router.delete("/comment/{comment_id}")
async def delete_comment(
    comment_id: str,
    member: CurrentMember = Depends(require_member),
    db: AsyncSession = Depends(get_db),
):
    """Delete a comment — own comment or admin can delete any."""
    result = await db.execute(
        text("SELECT id, post_id, author_enrollment_id FROM community_comments WHERE id = CAST(:cid AS uuid)"),
        {"cid": comment_id},
    )
    comment = result.first()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")

    await _require_social_access(db, member)

    is_owner = str(comment.author_enrollment_id) == member.enrollment_id
    if not is_owner and member.role != "admin":
        raise HTTPException(status_code=403, detail="Not authorized to delete this comment")

    # Delete associated likes
    await db.execute(
        text("DELETE FROM community_likes WHERE comment_id = CAST(:cid AS uuid)"),
        {"cid": comment_id},
    )
    # Delete comment
    await db.execute(
        text("DELETE FROM community_comments WHERE id = CAST(:cid AS uuid)"),
        {"cid": comment_id},
    )
    # Decrement comments_count
    await db.execute(
        text("UPDATE community_posts SET comments_count = GREATEST(comments_count - 1, 0) WHERE id = CAST(:pid AS uuid)"),
        {"pid": str(comment.post_id)},
    )
    await db.commit()

    logger.info("[COMMUNITY] Comment %s deleted by %s", comment_id[:8], member.email)
    return {"ok": True}


# ─── MEMBERS ─────────────────────────────────────────────────────────────


@router.get("/members")
async def list_members(
    db: AsyncSession = Depends(get_db),
):
    """List all active pro members with post count."""
    result = await db.execute(
        text("""
            SELECT
                e.id AS enrollment_id,
                e.name,
                e.tier,
                e.phone,
                e.enrolled_at,
                COALESCE(pc.post_count, 0) AS post_count
            FROM playbook_enrollments e
            LEFT JOIN (
                SELECT author_enrollment_id, COUNT(*) AS post_count
                FROM community_posts
                GROUP BY author_enrollment_id
            ) pc ON pc.author_enrollment_id = e.id
            WHERE e.tier = 'pro' AND (e.is_active IS NULL OR e.is_active = true)
            ORDER BY e.enrolled_at ASC
        """)
    )
    rows = result.fetchall()

    members = [
        MemberOut(
            enrollment_id=str(r.enrollment_id),
            name=r.name or "Membro",
            role=_determine_role(r.tier, r.phone),
            enrolled_at=r.enrolled_at.isoformat() if r.enrolled_at else None,
            post_count=r.post_count,
        ).model_dump()
        for r in rows
    ]

    return {"total": len(members), "members": members}


# ─── RESOURCES ───────────────────────────────────────────────────────────


@router.get("/resources")
async def list_resources(
    db: AsyncSession = Depends(get_db),
):
    """List all community resources."""
    result = await db.execute(
        text("""
            SELECT id, title, description, resource_type, tier, downloads_count, created_at
            FROM community_resources
            ORDER BY created_at DESC
        """)
    )
    rows = result.fetchall()

    resources = [
        ResourceOut(
            id=str(r.id),
            title=r.title,
            description=r.description,
            resource_type=r.resource_type,
            tier=r.tier,
            downloads_count=r.downloads_count,
            created_at=r.created_at.isoformat() if r.created_at else "",
        ).model_dump()
        for r in rows
    ]

    return {"total": len(resources), "resources": resources}


@router.post("/resource/{resource_id}/download")
async def download_resource(
    resource_id: str,
    member: Optional[CurrentMember] = Depends(get_current_member),
    db: AsyncSession = Depends(get_db),
):
    """Increment download count and return download URL.
    Pro resources require auth; free resources are open.
    """
    result = await db.execute(
        text("SELECT id, title, tier, download_url, downloads_count FROM community_resources WHERE id = CAST(:rid AS uuid)"),
        {"rid": resource_id},
    )
    resource = result.first()

    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")

    # Pro-only resources require authentication and live access validation.
    if resource.tier == "pro":
        if member is None:
            raise HTTPException(status_code=401, detail="Pro membership required to download this resource")
        await _require_content_access(db, member)

    # Increment download count
    await db.execute(
        text("UPDATE community_resources SET downloads_count = downloads_count + 1 WHERE id = CAST(:rid AS uuid)"),
        {"rid": resource_id},
    )
    await db.commit()

    logger.info("[COMMUNITY] Resource '%s' downloaded (count=%d)", resource.title, resource.downloads_count + 1)

    return {
        "download_url": resource.download_url,
        "title": resource.title,
        "downloads_count": resource.downloads_count + 1,
    }
