"""
Orquestra - Social Publishing Router
Unified multi-platform video distribution: Instagram Reels + TikTok.
"""

import base64
import hashlib
import hmac
import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, desc, update, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.services.social_publish import (
    get_publisher,
    get_social_credentials,
    get_valid_access_token,
    save_social_credentials,
    PUBLISHERS,
)

logger = logging.getLogger(__name__)

router = APIRouter()

DEFAULT_PROJECT = "GuyFolkz"
STATE_TTL = 1800  # 30 minutes


def _state_secret() -> str:
    return settings.APP_SECRET_KEY or "orquestra-social-oauth"


def _encode_state(platform: str, project_name: str, extra: dict | None = None) -> str:
    payload = {
        "platform": platform,
        "project_name": project_name,
        "iat": int(time.time()),
        **(extra or {}),
    }
    payload_json = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    payload_b64 = base64.urlsafe_b64encode(payload_json).decode("utf-8").rstrip("=")
    signature = hmac.new(
        _state_secret().encode("utf-8"),
        payload_b64.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"{payload_b64}.{signature}"


def _decode_state(state: str) -> dict[str, Any]:
    try:
        payload_b64, signature = state.split(".", 1)
    except ValueError as exc:
        raise ValueError("Invalid OAuth state format") from exc

    expected = hmac.new(
        _state_secret().encode("utf-8"),
        payload_b64.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(signature, expected):
        raise ValueError("Invalid OAuth state signature")

    padded = payload_b64 + "=" * (-len(payload_b64) % 4)
    payload = json.loads(base64.urlsafe_b64decode(padded.encode("utf-8")).decode("utf-8"))
    issued_at = int(payload.get("iat", 0))
    if not issued_at or int(time.time()) - issued_at > STATE_TTL:
        raise ValueError("OAuth state expired")
    return payload


# ─── Pydantic Models ─────────────────────────────────────────────────

class PublishRequest(BaseModel):
    platforms: list[str] = Field(..., description="Platforms to publish to: instagram, tiktok")
    video_url: str = Field(..., description="Public URL of the video file")
    title: str = ""
    description: str = ""
    tags: list[str] = Field(default_factory=list)
    project_name: str = DEFAULT_PROJECT


class PublishResult(BaseModel):
    platform: str
    status: str
    platform_video_id: str = ""
    platform_url: str = ""
    error: str = ""


class AccountInfo(BaseModel):
    platform: str
    account_id: str = ""
    username: str = ""
    name: str = ""
    profile_picture_url: str = ""
    followers_count: int = 0
    is_connected: bool = False


# ─── OAuth Endpoints ─────────────────────────────────────────────────

@router.get("/oauth/{platform}/authorize")
async def oauth_authorize(
    platform: str,
    request: Request,
    project_name: str = Query(DEFAULT_PROJECT),
):
    """Start OAuth flow for Instagram or TikTok."""
    if platform not in PUBLISHERS:
        return JSONResponse(
            status_code=400,
            content={"error": f"Unsupported platform: {platform}. Supported: {list(PUBLISHERS.keys())}"},
        )

    publisher = get_publisher(platform)
    redirect_uri = _build_redirect_uri(request, platform)
    state = _encode_state(platform, project_name)
    auth_url = publisher.get_authorization_url(redirect_uri, state)

    return {"authorization_url": auth_url, "state": state}


@router.get("/oauth/{platform}/callback")
async def oauth_callback(
    platform: str,
    request: Request,
    code: str = Query(...),
    state: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """OAuth callback handler. Exchanges code for tokens and saves credentials."""
    try:
        state_data = _decode_state(state)
    except ValueError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})

    if state_data.get("platform") != platform:
        return JSONResponse(status_code=400, content={"error": "Platform mismatch in state"})

    project_name = state_data.get("project_name", DEFAULT_PROJECT)
    publisher = get_publisher(platform)
    redirect_uri = _build_redirect_uri(request, platform)

    try:
        tokens = await publisher.exchange_code(code, redirect_uri)
        account_info = await publisher.get_account_info(tokens["access_token"])

        creds = {
            "access_token": tokens["access_token"],
            "refresh_token": tokens.get("refresh_token", ""),
            "expires_at": int(time.time()) + tokens.get("expires_in", 86400),
            "account_id": account_info.get("account_id", ""),
            "username": account_info.get("username", ""),
            "connected_at": datetime.now(timezone.utc).isoformat(),
        }
        await save_social_credentials(db, project_name, platform, creds)
        await db.commit()

        # Redirect to frontend social page
        frontend_url = settings.CLIENT_PORTAL_URL or "https://guyyfolkz.mbest.site"
        return RedirectResponse(
            url=f"{frontend_url}/social?connected={platform}&account={account_info.get('username', '')}"
        )

    except Exception as e:
        logger.error("[SOCIAL] OAuth callback error for %s: %s", platform, e)
        return JSONResponse(status_code=500, content={"error": str(e)})


# ─── Account Management ─────────────────────────────────────────────

@router.get("/accounts")
async def list_accounts(
    project_name: str = Query(DEFAULT_PROJECT),
    db: AsyncSession = Depends(get_db),
):
    """List all connected social accounts for a project."""
    accounts = []
    for platform in PUBLISHERS:
        creds = await get_social_credentials(db, project_name, platform)
        accounts.append({
            "platform": platform,
            "is_connected": bool(creds.get("access_token")),
            "username": creds.get("username", ""),
            "account_id": creds.get("account_id", ""),
            "connected_at": creds.get("connected_at", ""),
        })

    # Also check YouTube (already in projects.credentials.youtube)
    yt_creds = await get_social_credentials(db, project_name, "youtube")
    accounts.append({
        "platform": "youtube",
        "is_connected": bool(yt_creds.get("refresh_token")),
        "username": yt_creds.get("channel_id", ""),
        "account_id": yt_creds.get("channel_id", ""),
        "connected_at": "",
    })

    return {"accounts": accounts}


@router.delete("/accounts/{platform}")
async def disconnect_account(
    platform: str,
    project_name: str = Query(DEFAULT_PROJECT),
    db: AsyncSession = Depends(get_db),
):
    """Disconnect a social account."""
    await save_social_credentials(db, project_name, platform, {})
    await db.commit()
    return {"status": "disconnected", "platform": platform}


# ─── Publishing ──────────────────────────────────────────────────────

@router.post("/publish")
async def publish_video(
    body: PublishRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Publish video to multiple platforms simultaneously.
    Requires video to be accessible via public URL.
    """
    results = []

    for platform in body.platforms:
        if platform == "youtube":
            results.append(PublishResult(
                platform="youtube",
                status="skipped",
                error="Use /api/youtube/upload for YouTube uploads",
            ).model_dump())
            continue

        if platform not in PUBLISHERS:
            results.append(PublishResult(
                platform=platform,
                status="error",
                error=f"Unsupported platform: {platform}",
            ).model_dump())
            continue

        try:
            access_token = await get_valid_access_token(db, body.project_name, platform)
            creds = await get_social_credentials(db, body.project_name, platform)
            publisher = get_publisher(platform)

            result = await publisher.upload_video(
                access_token=access_token,
                video_path="",  # Not used for URL-based uploads
                title=body.title,
                description=body.description,
                tags=body.tags,
                video_url=body.video_url,
                account_id=creds.get("account_id", ""),
            )

            results.append(PublishResult(
                platform=platform,
                status=result.get("status", "published"),
                platform_video_id=result.get("platform_video_id", ""),
                platform_url=result.get("platform_url", ""),
            ).model_dump())

            logger.info("[SOCIAL] Published to %s: %s", platform, result.get("platform_video_id"))

        except Exception as e:
            logger.error("[SOCIAL] Failed to publish to %s: %s", platform, e)
            results.append(PublishResult(
                platform=platform,
                status="error",
                error=str(e),
            ).model_dump())

    return {"results": results}


@router.post("/publish/upload")
async def publish_video_upload(
    platforms: str = Form(..., description="Comma-separated: instagram,tiktok"),
    title: str = Form(""),
    description: str = Form(""),
    tags: str = Form(""),
    project_name: str = Form(DEFAULT_PROJECT),
    video: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload and publish video file directly to multiple platforms.
    For TikTok (supports direct file upload).
    For Instagram, the video needs to be hosted at a public URL.
    """
    import tempfile

    platform_list = [p.strip() for p in platforms.split(",") if p.strip()]
    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []

    # Save uploaded file temporarily
    ext = os.path.splitext(video.filename or "")[1] or ".mp4"
    fd, temp_path = tempfile.mkstemp(prefix="social_", suffix=ext)
    os.close(fd)

    try:
        with open(temp_path, "wb") as f:
            while True:
                chunk = await video.read(1024 * 1024)
                if not chunk:
                    break
                f.write(chunk)
        await video.close()

        results = []
        for platform in platform_list:
            if platform not in PUBLISHERS:
                results.append({"platform": platform, "status": "error", "error": f"Unsupported: {platform}"})
                continue

            try:
                access_token = await get_valid_access_token(db, project_name, platform)
                creds = await get_social_credentials(db, project_name, platform)
                publisher = get_publisher(platform)

                result = await publisher.upload_video(
                    access_token=access_token,
                    video_path=temp_path,
                    title=title,
                    description=description,
                    tags=tag_list,
                    account_id=creds.get("account_id", ""),
                )
                results.append({
                    "platform": platform,
                    "status": result.get("status", "published"),
                    "platform_video_id": result.get("platform_video_id", ""),
                    "platform_url": result.get("platform_url", ""),
                })
            except Exception as e:
                logger.error("[SOCIAL] Upload failed for %s: %s", platform, e)
                results.append({"platform": platform, "status": "error", "error": str(e)})

        return {"results": results}

    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


# ─── Status & History ────────────────────────────────────────────────

@router.get("/platforms")
async def list_platforms():
    """List available publishing platforms and their requirements."""
    return {
        "platforms": [
            {
                "id": "instagram",
                "name": "Instagram Reels",
                "icon": "instagram",
                "requires_url": True,
                "max_duration_seconds": 900,  # 15 min
                "supported_formats": ["mp4", "mov"],
                "aspect_ratio": "9:16",
                "oauth_configured": bool(settings.INSTAGRAM_APP_ID),
            },
            {
                "id": "tiktok",
                "name": "TikTok",
                "icon": "tiktok",
                "requires_url": False,
                "max_duration_seconds": 600,  # 10 min
                "supported_formats": ["mp4", "webm"],
                "aspect_ratio": "9:16",
                "oauth_configured": bool(settings.TIKTOK_CLIENT_KEY),
            },
            {
                "id": "youtube",
                "name": "YouTube Shorts",
                "icon": "youtube",
                "requires_url": False,
                "max_duration_seconds": 60,
                "supported_formats": ["mp4", "webm", "mov"],
                "aspect_ratio": "9:16",
                "oauth_configured": bool(settings.YOUTUBE_OAUTH_CLIENT_ID),
            },
        ]
    }


# ─── Helpers ─────────────────────────────────────────────────────────

def _build_redirect_uri(request: Request, platform: str) -> str:
    """Build OAuth redirect URI. Uses env var if set, otherwise auto-detect."""
    env_key = f"{platform.upper()}_OAUTH_REDIRECT_URI"
    env_val = getattr(settings, env_key, "")
    if env_val:
        return env_val

    # Auto-detect from request
    base = str(request.base_url).rstrip("/")
    return f"{base}/api/social/oauth/{platform}/callback"
