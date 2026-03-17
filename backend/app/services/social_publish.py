"""
Orquestra - Social Publishing Service
Unified publisher for Instagram Reels and TikTok.
Uses OAuth2 for both platforms.
"""

import asyncio
import hashlib
import json
import logging
import os
import secrets
import time
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Project

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT = httpx.Timeout(120.0, connect=30.0)


# ─── Base Publisher ──────────────────────────────────────────────────

class BasePublisher(ABC):
    """Base class for social media publishers."""

    platform: str = ""

    @abstractmethod
    def get_authorization_url(self, redirect_uri: str, state: str) -> str:
        """Build OAuth authorization URL."""

    @abstractmethod
    async def exchange_code(self, code: str, redirect_uri: str) -> dict[str, Any]:
        """Exchange auth code for tokens. Returns {access_token, refresh_token, expires_in, ...}."""

    @abstractmethod
    async def refresh_access_token(self, refresh_token: str) -> dict[str, Any]:
        """Refresh expired access token."""

    @abstractmethod
    async def upload_video(
        self,
        access_token: str,
        video_path: str,
        title: str,
        description: str,
        tags: list[str] | None = None,
        **kwargs,
    ) -> dict[str, Any]:
        """Upload video. Returns {platform_video_id, platform_url, status, ...}."""

    @abstractmethod
    async def get_account_info(self, access_token: str) -> dict[str, Any]:
        """Get connected account info."""


# ─── Instagram Publisher (Meta Graph API) ────────────────────────────

class InstagramPublisher(BasePublisher):
    """
    Instagram Reels publishing via Meta Graph API.

    Requires:
    - Facebook App with instagram_content_publish permission
    - Instagram Professional Account (Business or Creator)
    - Facebook Page connected to Instagram account

    Flow:
    1. OAuth → Facebook Login → get user access token
    2. Exchange for long-lived token (60 days)
    3. Get Instagram Business Account ID via /me/accounts
    4. Create media container (POST /{ig-user-id}/media)
    5. Publish container (POST /{ig-user-id}/media_publish)
    """

    platform = "instagram"

    GRAPH_API_VERSION = "v21.0"
    GRAPH_API_BASE = f"https://graph.facebook.com/{GRAPH_API_VERSION}"
    OAUTH_URL = "https://www.facebook.com/v21.0/dialog/oauth"
    TOKEN_URL = f"https://graph.facebook.com/{GRAPH_API_VERSION}/oauth/access_token"

    REQUIRED_SCOPES = [
        "instagram_basic",
        "instagram_content_publish",
        "pages_show_list",
        "pages_read_engagement",
    ]

    def get_authorization_url(self, redirect_uri: str, state: str) -> str:
        params = {
            "client_id": settings.INSTAGRAM_APP_ID,
            "redirect_uri": redirect_uri,
            "state": state,
            "scope": ",".join(self.REQUIRED_SCOPES),
            "response_type": "code",
        }
        return f"{self.OAUTH_URL}?{urlencode(params)}"

    async def exchange_code(self, code: str, redirect_uri: str) -> dict[str, Any]:
        """Exchange code for short-lived token, then exchange for long-lived token."""
        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
            # Step 1: Short-lived token
            resp = await client.get(
                self.TOKEN_URL,
                params={
                    "client_id": settings.INSTAGRAM_APP_ID,
                    "client_secret": settings.INSTAGRAM_APP_SECRET,
                    "redirect_uri": redirect_uri,
                    "code": code,
                },
            )
            resp.raise_for_status()
            short_data = resp.json()
            short_token = short_data["access_token"]

            # Step 2: Long-lived token (60 days)
            resp2 = await client.get(
                f"{self.GRAPH_API_BASE}/oauth/access_token",
                params={
                    "grant_type": "fb_exchange_token",
                    "client_id": settings.INSTAGRAM_APP_ID,
                    "client_secret": settings.INSTAGRAM_APP_SECRET,
                    "fb_exchange_token": short_token,
                },
            )
            resp2.raise_for_status()
            long_data = resp2.json()

            return {
                "access_token": long_data["access_token"],
                "token_type": long_data.get("token_type", "bearer"),
                "expires_in": long_data.get("expires_in", 5184000),  # 60 days default
            }

    async def refresh_access_token(self, refresh_token: str) -> dict[str, Any]:
        """Refresh long-lived token (before it expires)."""
        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
            resp = await client.get(
                f"{self.GRAPH_API_BASE}/oauth/access_token",
                params={
                    "grant_type": "fb_exchange_token",
                    "client_id": settings.INSTAGRAM_APP_ID,
                    "client_secret": settings.INSTAGRAM_APP_SECRET,
                    "fb_exchange_token": refresh_token,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            return {
                "access_token": data["access_token"],
                "expires_in": data.get("expires_in", 5184000),
            }

    async def get_account_info(self, access_token: str) -> dict[str, Any]:
        """Get Instagram Business Account ID via Facebook Pages."""
        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
            # Get pages
            resp = await client.get(
                f"{self.GRAPH_API_BASE}/me/accounts",
                params={"access_token": access_token, "fields": "id,name,instagram_business_account"},
            )
            resp.raise_for_status()
            pages = resp.json().get("data", [])

            for page in pages:
                ig_account = page.get("instagram_business_account")
                if ig_account:
                    # Get IG account details
                    ig_resp = await client.get(
                        f"{self.GRAPH_API_BASE}/{ig_account['id']}",
                        params={
                            "access_token": access_token,
                            "fields": "id,username,name,profile_picture_url,followers_count,media_count",
                        },
                    )
                    ig_resp.raise_for_status()
                    ig_data = ig_resp.json()
                    return {
                        "account_id": ig_data["id"],
                        "username": ig_data.get("username", ""),
                        "name": ig_data.get("name", ""),
                        "profile_picture_url": ig_data.get("profile_picture_url", ""),
                        "followers_count": ig_data.get("followers_count", 0),
                        "media_count": ig_data.get("media_count", 0),
                        "page_id": page["id"],
                        "page_name": page.get("name", ""),
                    }

            raise ValueError("No Instagram Business Account found. Connect a Professional account to a Facebook Page first.")

    async def upload_video(
        self,
        access_token: str,
        video_path: str,
        title: str,
        description: str,
        tags: list[str] | None = None,
        **kwargs,
    ) -> dict[str, Any]:
        """
        Upload Reel to Instagram.
        Requires video to be accessible via public URL or uploaded via resumable upload.
        """
        ig_user_id = kwargs.get("account_id")
        if not ig_user_id:
            info = await self.get_account_info(access_token)
            ig_user_id = info["account_id"]

        video_url = kwargs.get("video_url")
        if not video_url:
            raise ValueError("Instagram requires a public video_url for Reels upload. Upload the video to a public URL first.")

        # Build caption with hashtags
        hashtags = " ".join(f"#{tag.replace(' ', '')}" for tag in (tags or []))
        caption = f"{description}\n\n{hashtags}".strip() if hashtags else description

        async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=30.0)) as client:
            # Step 1: Create media container
            container_resp = await client.post(
                f"{self.GRAPH_API_BASE}/{ig_user_id}/media",
                data={
                    "media_type": "REELS",
                    "video_url": video_url,
                    "caption": caption,
                    "share_to_feed": "true",
                    "access_token": access_token,
                },
            )
            container_resp.raise_for_status()
            container_id = container_resp.json()["id"]
            logger.info("[INSTAGRAM] Created media container %s", container_id)

            # Step 2: Wait for processing (poll status)
            for attempt in range(30):  # max 5 minutes
                status_resp = await client.get(
                    f"{self.GRAPH_API_BASE}/{container_id}",
                    params={"fields": "status_code,status", "access_token": access_token},
                )
                status_resp.raise_for_status()
                status_data = status_resp.json()
                status_code = status_data.get("status_code", "")

                if status_code == "FINISHED":
                    break
                elif status_code == "ERROR":
                    error_msg = status_data.get("status", "Unknown error during processing")
                    raise RuntimeError(f"Instagram processing failed: {error_msg}")

                logger.info("[INSTAGRAM] Container %s status: %s (attempt %d)", container_id, status_code, attempt + 1)
                await asyncio.sleep(10)
            else:
                raise TimeoutError("Instagram video processing timed out after 5 minutes")

            # Step 3: Publish
            publish_resp = await client.post(
                f"{self.GRAPH_API_BASE}/{ig_user_id}/media_publish",
                data={"creation_id": container_id, "access_token": access_token},
            )
            publish_resp.raise_for_status()
            media_id = publish_resp.json()["id"]

            # Get permalink
            permalink_resp = await client.get(
                f"{self.GRAPH_API_BASE}/{media_id}",
                params={"fields": "permalink,shortcode", "access_token": access_token},
            )
            permalink_data = permalink_resp.json() if permalink_resp.status_code == 200 else {}

            return {
                "platform_video_id": media_id,
                "platform_url": permalink_data.get("permalink", f"https://www.instagram.com/reel/{permalink_data.get('shortcode', media_id)}/"),
                "status": "published",
                "container_id": container_id,
            }


# ─── TikTok Publisher (Content Posting API) ──────────────────────────

class TikTokPublisher(BasePublisher):
    """
    TikTok video publishing via Content Posting API.

    Requires:
    - TikTok Developer App with video.publish scope
    - App approved for Content Posting API

    Flow:
    1. OAuth → TikTok Login → authorization code
    2. Exchange code for access_token + refresh_token
    3. Init upload (POST /v2/post/publish/inbox/video/init/)
    4. Upload video chunks to upload_url
    5. TikTok processes and publishes
    """

    platform = "tiktok"

    OAUTH_URL = "https://www.tiktok.com/v2/auth/authorize/"
    TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/"
    API_BASE = "https://open.tiktokapis.com"

    REQUIRED_SCOPES = ["user.info.basic", "video.publish", "video.upload"]

    def get_authorization_url(self, redirect_uri: str, state: str) -> str:
        # TikTok uses PKCE
        code_verifier = secrets.token_urlsafe(64)
        code_challenge = hashlib.sha256(code_verifier.encode()).hexdigest()

        params = {
            "client_key": settings.TIKTOK_CLIENT_KEY,
            "redirect_uri": redirect_uri,
            "state": state,
            "scope": ",".join(self.REQUIRED_SCOPES),
            "response_type": "code",
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }
        # Store code_verifier for later exchange (returned in state metadata)
        return f"{self.OAUTH_URL}?{urlencode(params)}"

    async def exchange_code(self, code: str, redirect_uri: str, **kwargs) -> dict[str, Any]:
        code_verifier = kwargs.get("code_verifier", "")

        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
            resp = await client.post(
                self.TOKEN_URL,
                data={
                    "client_key": settings.TIKTOK_CLIENT_KEY,
                    "client_secret": settings.TIKTOK_CLIENT_SECRET,
                    "code": code,
                    "grant_type": "authorization_code",
                    "redirect_uri": redirect_uri,
                    "code_verifier": code_verifier,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            resp.raise_for_status()
            data = resp.json()

            return {
                "access_token": data["access_token"],
                "refresh_token": data.get("refresh_token", ""),
                "expires_in": data.get("expires_in", 86400),
                "open_id": data.get("open_id", ""),
                "scope": data.get("scope", ""),
            }

    async def refresh_access_token(self, refresh_token: str) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
            resp = await client.post(
                self.TOKEN_URL,
                data={
                    "client_key": settings.TIKTOK_CLIENT_KEY,
                    "client_secret": settings.TIKTOK_CLIENT_SECRET,
                    "grant_type": "refresh_token",
                    "refresh_token": refresh_token,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            resp.raise_for_status()
            data = resp.json()
            return {
                "access_token": data["access_token"],
                "refresh_token": data.get("refresh_token", refresh_token),
                "expires_in": data.get("expires_in", 86400),
            }

    async def get_account_info(self, access_token: str) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
            resp = await client.get(
                f"{self.API_BASE}/v2/user/info/",
                headers={"Authorization": f"Bearer {access_token}"},
                params={"fields": "open_id,union_id,avatar_url,display_name,follower_count,video_count"},
            )
            resp.raise_for_status()
            data = resp.json().get("data", {}).get("user", {})
            return {
                "account_id": data.get("open_id", ""),
                "username": data.get("display_name", ""),
                "name": data.get("display_name", ""),
                "profile_picture_url": data.get("avatar_url", ""),
                "followers_count": data.get("follower_count", 0),
                "video_count": data.get("video_count", 0),
            }

    async def upload_video(
        self,
        access_token: str,
        video_path: str,
        title: str,
        description: str,
        tags: list[str] | None = None,
        **kwargs,
    ) -> dict[str, Any]:
        """
        Upload video to TikTok via Content Posting API (direct post).
        Uses FILE_UPLOAD method for local files.
        """
        file_size = os.path.getsize(video_path)
        chunk_size = min(file_size, 64 * 1024 * 1024)  # max 64MB per chunk
        total_chunks = (file_size + chunk_size - 1) // chunk_size

        # Build title with hashtags
        hashtags = " ".join(f"#{tag.replace(' ', '')}" for tag in (tags or []))
        full_title = f"{description[:150]}\n{hashtags}".strip() if hashtags else description[:300]

        async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=60.0)) as client:
            # Step 1: Initialize upload
            init_resp = await client.post(
                f"{self.API_BASE}/v2/post/publish/video/init/",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json; charset=UTF-8",
                },
                json={
                    "post_info": {
                        "title": full_title[:150],
                        "privacy_level": kwargs.get("privacy_level", "PUBLIC_TO_EVERYONE"),
                        "disable_duet": False,
                        "disable_comment": False,
                        "disable_stitch": False,
                    },
                    "source_info": {
                        "source": "FILE_UPLOAD",
                        "video_size": file_size,
                        "chunk_size": chunk_size,
                        "total_chunk_count": total_chunks,
                    },
                },
            )
            init_resp.raise_for_status()
            init_data = init_resp.json().get("data", {})
            publish_id = init_data.get("publish_id", "")
            upload_url = init_data.get("upload_url", "")

            if not upload_url:
                raise RuntimeError(f"TikTok init failed: {init_resp.json()}")

            logger.info("[TIKTOK] Upload initialized: publish_id=%s, chunks=%d", publish_id, total_chunks)

            # Step 2: Upload video chunks
            with open(video_path, "rb") as f:
                for chunk_idx in range(total_chunks):
                    chunk_data = f.read(chunk_size)
                    start_byte = chunk_idx * chunk_size
                    end_byte = start_byte + len(chunk_data) - 1

                    upload_resp = await client.put(
                        upload_url,
                        content=chunk_data,
                        headers={
                            "Content-Type": "video/mp4",
                            "Content-Range": f"bytes {start_byte}-{end_byte}/{file_size}",
                        },
                    )
                    upload_resp.raise_for_status()
                    logger.info("[TIKTOK] Uploaded chunk %d/%d", chunk_idx + 1, total_chunks)

            # Step 3: Check publish status
            for attempt in range(30):
                status_resp = await client.post(
                    f"{self.API_BASE}/v2/post/publish/status/fetch/",
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Content-Type": "application/json",
                    },
                    json={"publish_id": publish_id},
                )
                status_resp.raise_for_status()
                status_data = status_resp.json().get("data", {})
                pub_status = status_data.get("status", "PROCESSING")

                if pub_status == "PUBLISH_COMPLETE":
                    return {
                        "platform_video_id": publish_id,
                        "platform_url": "",  # TikTok doesn't return URL immediately
                        "status": "published",
                    }
                elif pub_status in ("FAILED", "PUBLISH_FAILED"):
                    fail_reason = status_data.get("fail_reason", "Unknown")
                    raise RuntimeError(f"TikTok publish failed: {fail_reason}")

                logger.info("[TIKTOK] Publish status: %s (attempt %d)", pub_status, attempt + 1)
                await asyncio.sleep(10)

            return {
                "platform_video_id": publish_id,
                "platform_url": "",
                "status": "processing",
            }


# ─── Publisher Registry ──────────────────────────────────────────────

PUBLISHERS: dict[str, BasePublisher] = {
    "instagram": InstagramPublisher(),
    "tiktok": TikTokPublisher(),
}


def get_publisher(platform: str) -> BasePublisher:
    publisher = PUBLISHERS.get(platform)
    if not publisher:
        raise ValueError(f"Unsupported platform: {platform}. Supported: {list(PUBLISHERS.keys())}")
    return publisher


# ─── Credential helpers ──────────────────────────────────────────────

async def get_social_credentials(
    db: AsyncSession, project_name: str, platform: str
) -> dict[str, Any]:
    """Get stored OAuth credentials for a platform from project JSONB."""
    stmt = select(Project).where(Project.name == project_name)
    result = await db.execute(stmt)
    project = result.scalar_one_or_none()
    if not project:
        return {}
    creds = (project.credentials or {}).get(platform, {})
    return creds


async def save_social_credentials(
    db: AsyncSession, project_name: str, platform: str, creds: dict[str, Any]
) -> None:
    """Save OAuth credentials for a platform into project JSONB."""
    from sqlalchemy.orm.attributes import flag_modified

    stmt = select(Project).where(Project.name == project_name)
    result = await db.execute(stmt)
    project = result.scalar_one_or_none()
    if not project:
        raise ValueError(f"Project '{project_name}' not found")

    all_creds = dict(project.credentials or {})
    all_creds[platform] = creds
    project.credentials = all_creds
    flag_modified(project, "credentials")
    await db.flush()
    logger.info("[SOCIAL] Saved %s credentials for project %s", platform, project_name)


async def get_valid_access_token(
    db: AsyncSession, project_name: str, platform: str
) -> str:
    """Get a valid access token, refreshing if expired."""
    creds = await get_social_credentials(db, project_name, platform)
    if not creds:
        raise ValueError(f"No {platform} credentials configured for project '{project_name}'")

    access_token = creds.get("access_token", "")
    expires_at = creds.get("expires_at", 0)
    refresh_token = creds.get("refresh_token", "")

    # Check if token is expired (with 5 min buffer)
    if expires_at and time.time() > (expires_at - 300) and refresh_token:
        publisher = get_publisher(platform)
        new_tokens = await publisher.refresh_access_token(refresh_token)
        creds["access_token"] = new_tokens["access_token"]
        creds["expires_at"] = int(time.time()) + new_tokens.get("expires_in", 86400)
        if new_tokens.get("refresh_token"):
            creds["refresh_token"] = new_tokens["refresh_token"]
        await save_social_credentials(db, project_name, platform, creds)
        access_token = creds["access_token"]

    return access_token
