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


class MemberProfile(BaseModel):
    enrollment_id: str
    email: str
    name: str
    phone: str | None
    tier: str
    role: str
    enrolled_at: str | None


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
    # Diego's phone = admin
    if phone and phone.strip().endswith("5551993448124"):
        return "admin"
    if tier == "pro":
        return "member"
    return "free"


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


@router.post("/auth/login")
async def auth_login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    """Generate a 6-digit code for a pro member's email.
    MVP: code is logged to stdout, not actually emailed.
    """
    email = req.email.lower().strip()

    # Check if email exists in playbook_enrollments with tier='pro'
    result = await db.execute(
        text("SELECT id, name, tier, phone FROM playbook_enrollments WHERE LOWER(email) = :email LIMIT 1"),
        {"email": email},
    )
    row = result.first()

    if not row:
        # Don't reveal whether email exists — return same response
        logger.info("[COMMUNITY] Login attempt for unknown email: %s", email)
        return {"status": "code_sent"}

    if row.tier != "pro":
        logger.info("[COMMUNITY] Login attempt for non-pro member: %s (tier=%s)", email, row.tier)
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
    phone = pending_data.get("phone") if "pending_data" in dir() else row.phone
    if row.phone:
        try:
            from app.services.whatsapp import send_whatsapp_message
            import asyncio
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
    phone = req.phone.strip()

    result = await db.execute(
        text("SELECT id, name, email, tier, phone FROM playbook_enrollments WHERE phone = :phone LIMIT 1"),
        {"phone": phone},
    )
    row = result.first()

    if not row or row.tier != "pro":
        raise HTTPException(status_code=403, detail="Phone not found or not pro member")

    enrollment_id = str(row.id)
    email = row.email or ""
    role = _determine_role(row.tier, row.phone)
    token = _make_jwt(enrollment_id, email, role)

    logger.info("[COMMUNITY] Phone login: %s (role=%s)", phone, role)

    return TokenResponse(
        token=token,
        enrollment_id=enrollment_id,
        name=row.name or "Membro",
        role=role,
    )


@router.get("/me", response_model=MemberProfile)
async def get_me(
    member: CurrentMember = Depends(require_member),
    db: AsyncSession = Depends(get_db),
):
    """Return current member profile from enrollment data."""
    result = await db.execute(
        text("SELECT id, name, email, phone, tier, enrolled_at FROM playbook_enrollments WHERE id = CAST(:id AS uuid)"),
        {"id": member.enrollment_id},
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Member not found")

    return MemberProfile(
        enrollment_id=str(row.id),
        email=row.email or member.email,
        name=row.name or "Membro",
        phone=row.phone,
        tier=row.tier,
        role=member.role,
        enrolled_at=row.enrolled_at.isoformat() if row.enrolled_at else None,
    )


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

    logger.info("[COMMUNITY] Post %s deleted by %s", post_id[:8], member.email)
    return {"ok": True}


@router.post("/post/{post_id}/like")
async def toggle_like(
    post_id: str,
    member: CurrentMember = Depends(require_member),
    db: AsyncSession = Depends(get_db),
):
    """Toggle like on a post. Returns new like state and count."""
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

    # Pro-only resources require authentication
    if resource.tier == "pro" and member is None:
        raise HTTPException(status_code=401, detail="Pro membership required to download this resource")

    # Increment download count
    await db.execute(
        text("UPDATE community_resources SET downloads_count = downloads_count + 1 WHERE id = CAST(:rid AS uuid)"),
        {"rid": resource_id},
    )

    logger.info("[COMMUNITY] Resource '%s' downloaded (count=%d)", resource.title, resource.downloads_count + 1)

    return {
        "download_url": resource.download_url,
        "title": resource.title,
        "downloads_count": resource.downloads_count + 1,
    }
