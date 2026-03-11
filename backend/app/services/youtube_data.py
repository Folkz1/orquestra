"""
Orquestra - YouTube Data API service
OAuth2, uploads, metadata updates, and channel analytics.
"""

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import mimetypes
import os
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode

import httpx
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.config import settings
from app.models import Project

logger = logging.getLogger(__name__)

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
YOUTUBE_API_BASE_URL = "https://www.googleapis.com/youtube/v3"
YOUTUBE_ANALYTICS_BASE_URL = "https://youtubeanalytics.googleapis.com/v2"
DEFAULT_TIMEOUT = httpx.Timeout(60.0, connect=30.0)
DEFAULT_YOUTUBE_SCOPES = [
    "https://www.googleapis.com/auth/youtube",
    "https://www.googleapis.com/auth/yt-analytics.readonly",
]
STATE_TTL_SECONDS = 1800
_UNSET = object()


def _parse_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _state_secret() -> str:
    return settings.APP_SECRET_KEY or "orquestra-youtube-oauth"


def get_oauth_scopes() -> list[str]:
    raw_scopes = settings.YOUTUBE_OAUTH_SCOPES.strip()
    if not raw_scopes:
        return list(DEFAULT_YOUTUBE_SCOPES)
    scopes = [scope.strip() for scope in raw_scopes.split(",") if scope.strip()]
    return scopes or list(DEFAULT_YOUTUBE_SCOPES)


def encode_oauth_state(project_name: str) -> str:
    payload = {
        "project_name": project_name,
        "iat": int(time.time()),
    }
    payload_json = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    payload_b64 = base64.urlsafe_b64encode(payload_json).decode("utf-8").rstrip("=")
    signature = hmac.new(
        _state_secret().encode("utf-8"),
        payload_b64.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"{payload_b64}.{signature}"


def decode_oauth_state(state: str) -> dict[str, Any]:
    try:
        payload_b64, signature = state.split(".", 1)
    except ValueError as exc:
        raise ValueError("Invalid OAuth state format") from exc

    expected_signature = hmac.new(
        _state_secret().encode("utf-8"),
        payload_b64.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(signature, expected_signature):
        raise ValueError("Invalid OAuth state signature")

    padded = payload_b64 + "=" * (-len(payload_b64) % 4)
    payload = json.loads(base64.urlsafe_b64decode(padded.encode("utf-8")).decode("utf-8"))
    issued_at = int(payload.get("iat", 0))
    if not issued_at or int(time.time()) - issued_at > STATE_TTL_SECONDS:
        raise ValueError("OAuth state expired")
    return payload


async def get_project_by_name(db: AsyncSession, project_name: str) -> Project:
    stmt = select(Project).where(Project.name == project_name)
    result = await db.execute(stmt)
    project = result.scalar_one_or_none()
    if not project:
        raise ValueError(f"Project '{project_name}' not found")
    return project


async def get_or_create_project_by_name(db: AsyncSession, project_name: str) -> Project:
    stmt = select(Project).where(Project.name == project_name)
    result = await db.execute(stmt)
    project = result.scalar_one_or_none()
    if project:
        return project

    project = Project(
        name=project_name,
        description="Auto-created for YouTube OAuth integration",
        credentials={},
    )
    db.add(project)
    await db.flush()
    await db.refresh(project)
    logger.info("[YOUTUBE_DATA] Auto-created project=%s for OAuth flow", project_name)
    return project


def resolve_oauth_client_config(project: Project) -> tuple[str, str]:
    youtube_credentials = dict((project.credentials or {}).get("youtube") or {})
    client_id = youtube_credentials.get("client_id") or settings.YOUTUBE_OAUTH_CLIENT_ID
    client_secret = youtube_credentials.get("client_secret") or settings.YOUTUBE_OAUTH_CLIENT_SECRET

    if not client_id or not client_secret:
        raise ValueError(
            "YouTube OAuth client_id/client_secret not configured. "
            "Set them in project.credentials.youtube or in YOUTUBE_OAUTH_CLIENT_ID/YOUTUBE_OAUTH_CLIENT_SECRET."
        )

    return client_id, client_secret


def build_oauth_authorization_url(client_id: str, redirect_uri: str, state: str) -> str:
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(get_oauth_scopes()),
        "access_type": "offline",
        "include_granted_scopes": "true",
        "prompt": "consent",
        "state": state,
    }
    return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"


async def exchange_oauth_code(
    client_id: str,
    client_secret: str,
    code: str,
    redirect_uri: str,
) -> dict[str, Any]:
    payload = {
        "client_id": client_id,
        "client_secret": client_secret,
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": redirect_uri,
    }

    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        response = await client.post(GOOGLE_TOKEN_URL, data=payload)
        response.raise_for_status()

    data = response.json()
    if "access_token" not in data:
        raise ValueError("Google OAuth callback did not return access_token")
    return data


async def save_youtube_oauth_credentials(
    db: AsyncSession,
    project_name: str,
    client_id: str,
    client_secret: str,
    refresh_token: str,
    channel_id: str,
) -> dict[str, Any]:
    project = await get_or_create_project_by_name(db, project_name)
    current_credentials = dict(project.credentials or {})
    youtube_credentials = dict(current_credentials.get("youtube") or {})
    youtube_credentials.update(
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "channel_id": channel_id,
        }
    )
    current_credentials["youtube"] = youtube_credentials

    project.credentials = current_credentials
    flag_modified(project, "credentials")
    await db.flush()
    await db.refresh(project)

    logger.info("[YOUTUBE_DATA] Saved OAuth credentials for project=%s", project_name)
    return youtube_credentials


async def get_youtube_credentials(db: AsyncSession, project_name: str) -> dict[str, Any]:
    """Fetch credentials.youtube from the projects table."""
    project = await get_project_by_name(db, project_name)
    youtube_credentials = dict((project.credentials or {}).get("youtube") or {})
    if not youtube_credentials:
        raise ValueError(f"YouTube credentials not configured for project '{project_name}'")

    required_keys = ["client_id", "client_secret", "refresh_token"]
    missing = [key for key in required_keys if not youtube_credentials.get(key)]
    if missing:
        raise ValueError(
            f"Incomplete YouTube credentials for project '{project_name}'. Missing: {', '.join(missing)}"
        )

    return youtube_credentials


async def get_project_access_token(
    db: AsyncSession,
    project_name: str,
) -> tuple[str, dict[str, Any]]:
    youtube_credentials = await get_youtube_credentials(db, project_name)
    access_token = await refresh_access_token(
        youtube_credentials["client_id"],
        youtube_credentials["client_secret"],
        youtube_credentials["refresh_token"],
    )
    return access_token, youtube_credentials


async def refresh_access_token(
    client_id: str,
    client_secret: str,
    refresh_token: str,
) -> str:
    """Exchange a refresh_token for a fresh access_token."""
    payload = {
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    }

    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        response = await client.post(GOOGLE_TOKEN_URL, data=payload)
        response.raise_for_status()

    data = response.json()
    access_token = data.get("access_token")
    if not access_token:
        raise ValueError("Unable to refresh YouTube access token")
    return access_token


def _pick_thumbnail_url(thumbnails: dict[str, Any]) -> str:
    for key in ["maxres", "standard", "high", "medium", "default"]:
        thumb = thumbnails.get(key)
        if thumb and thumb.get("url"):
            return thumb["url"]
    return ""


def _normalize_publish_at(publish_at: str) -> str:
    try:
        normalized = datetime.fromisoformat(publish_at.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("publish_at must be a valid ISO 8601 datetime") from exc

    if normalized.tzinfo is None:
        normalized = normalized.replace(tzinfo=timezone.utc)
    normalized = normalized.astimezone(timezone.utc)

    if normalized <= datetime.now(timezone.utc):
        raise ValueError("publish_at must be in the future")

    return normalized.isoformat().replace("+00:00", "Z")


def _build_google_credentials(access_token: str) -> Credentials:
    return Credentials(token=access_token, scopes=get_oauth_scopes())


def _upload_video_sync(
    access_token: str,
    file_path: str,
    title: str,
    description: str,
    tags: list[str],
    category_id: str,
    privacy_status: str,
) -> dict[str, Any]:
    youtube = build(
        "youtube",
        "v3",
        credentials=_build_google_credentials(access_token),
        cache_discovery=False,
    )
    media = MediaFileUpload(file_path, chunksize=8 * 1024 * 1024, resumable=True)
    body = {
        "snippet": {
            "title": title,
            "description": description,
            "tags": tags,
            "categoryId": category_id,
        },
        "status": {
            "privacyStatus": privacy_status,
            "selfDeclaredMadeForKids": False,
        },
    }

    request = youtube.videos().insert(
        part="snippet,status",
        body=body,
        media_body=media,
    )

    response = None
    while response is None:
        status, response = request.next_chunk(num_retries=3)
        if status:
            logger.info("[YOUTUBE_DATA] Upload progress %.2f%%", status.progress() * 100)

    return response


async def upload_video(
    access_token: str,
    file_path: str,
    title: str,
    description: str,
    tags: list[str],
    category_id: str = "28",
    privacy_status: str = "private",
    thumbnail_path: str | None = None,
) -> dict[str, Any]:
    """Upload a video using the resumable YouTube upload flow."""
    if not os.path.exists(file_path):
        raise ValueError(f"Video file not found: {file_path}")

    response = await asyncio.to_thread(
        _upload_video_sync,
        access_token,
        file_path,
        title,
        description,
        tags,
        category_id,
        privacy_status,
    )
    video_id = response.get("id")
    if not video_id:
        raise ValueError("YouTube upload did not return video_id")

    thumbnail_set = False
    if thumbnail_path:
        try:
            thumbnail_set = await set_thumbnail(access_token, video_id, thumbnail_path)
        except Exception as exc:  # pragma: no cover - best effort only
            logger.error("[YOUTUBE_DATA] Thumbnail upload failed for %s: %s", video_id, exc)

    return {
        "video_id": video_id,
        "url": f"https://www.youtube.com/watch?v={video_id}",
        "privacy_status": privacy_status,
        "status": "uploaded",
        "thumbnail_set": thumbnail_set,
    }


def _set_thumbnail_sync(access_token: str, video_id: str, thumbnail_path: str) -> bool:
    youtube = build(
        "youtube",
        "v3",
        credentials=_build_google_credentials(access_token),
        cache_discovery=False,
    )
    mimetype = mimetypes.guess_type(thumbnail_path)[0] or "image/png"
    media = MediaFileUpload(thumbnail_path, mimetype=mimetype, resumable=False)
    request = youtube.thumbnails().set(videoId=video_id, media_body=media)
    response = request.execute(num_retries=3)
    return bool(response)


async def set_thumbnail(access_token: str, video_id: str, thumbnail_path: str) -> bool:
    """Set a custom thumbnail for a video."""
    if not os.path.exists(thumbnail_path):
        raise ValueError(f"Thumbnail file not found: {thumbnail_path}")
    return await asyncio.to_thread(_set_thumbnail_sync, access_token, video_id, thumbnail_path)


async def _google_json_request(
    method: str,
    url: str,
    access_token: str,
    *,
    params: dict[str, Any] | None = None,
    json_body: dict[str, Any] | None = None,
    data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {access_token}"}

    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        response = await client.request(
            method,
            url,
            params=params,
            json=json_body,
            data=data,
            headers=headers,
        )

    if response.is_error:
        detail = response.text
        try:
            error_json = response.json()
            detail = error_json.get("error", {}).get("message") or detail
        except ValueError:
            pass
        logger.error("[YOUTUBE_DATA] Google API error %s %s: %s", method, url, detail)
        raise ValueError(f"Google API error ({response.status_code}): {detail}")

    if not response.content:
        return {}
    return response.json()


async def _fetch_video_resource(access_token: str, video_id: str) -> dict[str, Any]:
    data = await _google_json_request(
        "GET",
        f"{YOUTUBE_API_BASE_URL}/videos",
        access_token,
        params={
            "part": "snippet,status,statistics,contentDetails",
            "id": video_id,
        },
    )
    items = data.get("items", [])
    if not items:
        raise ValueError(f"Video '{video_id}' not found")
    return items[0]


def _build_mutable_snippet(snippet: dict[str, Any]) -> dict[str, Any]:
    mutable = {
        "title": snippet.get("title", ""),
        "description": snippet.get("description", ""),
        "categoryId": snippet.get("categoryId") or "28",
    }
    if snippet.get("tags"):
        mutable["tags"] = list(snippet["tags"])
    if snippet.get("defaultLanguage"):
        mutable["defaultLanguage"] = snippet["defaultLanguage"]
    if snippet.get("defaultAudioLanguage"):
        mutable["defaultAudioLanguage"] = snippet["defaultAudioLanguage"]
    return mutable


def _build_mutable_status(status: dict[str, Any]) -> dict[str, Any]:
    mutable: dict[str, Any] = {
        "privacyStatus": status.get("privacyStatus", "private"),
        "selfDeclaredMadeForKids": bool(status.get("selfDeclaredMadeForKids", False)),
    }
    if "embeddable" in status:
        mutable["embeddable"] = status["embeddable"]
    if "publicStatsViewable" in status:
        mutable["publicStatsViewable"] = status["publicStatsViewable"]
    if status.get("license"):
        mutable["license"] = status["license"]
    if status.get("publishAt"):
        mutable["publishAt"] = status["publishAt"]
    return mutable


async def _update_video_resource(
    access_token: str,
    video_id: str,
    *,
    title: str | None | object = _UNSET,
    description: str | None | object = _UNSET,
    tags: list[str] | None | object = _UNSET,
    privacy_status: str | None | object = _UNSET,
    publish_at: str | None | object = _UNSET,
) -> dict[str, Any]:
    current = await _fetch_video_resource(access_token, video_id)
    snippet = _build_mutable_snippet(current.get("snippet", {}))
    status = _build_mutable_status(current.get("status", {}))

    if title is not _UNSET:
        snippet["title"] = title or ""
    if description is not _UNSET:
        snippet["description"] = description or ""
    if tags is not _UNSET:
        if tags is None:
            snippet.pop("tags", None)
        else:
            snippet["tags"] = tags
    if privacy_status is not _UNSET and privacy_status is not None:
        status["privacyStatus"] = privacy_status
    if publish_at is not _UNSET:
        if publish_at is None:
            status.pop("publishAt", None)
        else:
            status["publishAt"] = _normalize_publish_at(publish_at)

    body = {
        "id": video_id,
        "snippet": snippet,
        "status": status,
    }
    data = await _google_json_request(
        "PUT",
        f"{YOUTUBE_API_BASE_URL}/videos",
        access_token,
        params={"part": "snippet,status"},
        json_body=body,
    )
    item = data or body
    item_status = item.get("status", status)

    return {
        "video_id": video_id,
        "title": item.get("snippet", {}).get("title", snippet.get("title", "")),
        "description": item.get("snippet", {}).get("description", snippet.get("description", "")),
        "tags": item.get("snippet", {}).get("tags", snippet.get("tags", [])),
        "privacy_status": item_status.get("privacyStatus", status.get("privacyStatus", "private")),
        "publish_at": item_status.get("publishAt"),
        "url": f"https://www.youtube.com/watch?v={video_id}",
    }


async def update_video_metadata(
    access_token: str,
    video_id: str,
    title: str | None | object = _UNSET,
    description: str | None | object = _UNSET,
    tags: list[str] | None | object = _UNSET,
    privacy_status: str | None | object = _UNSET,
) -> dict[str, Any]:
    """Update title/description/tags/privacy for an existing video."""
    return await _update_video_resource(
        access_token,
        video_id,
        title=title,
        description=description,
        tags=tags,
        privacy_status=privacy_status,
    )


async def publish_video(access_token: str, video_id: str) -> dict[str, Any]:
    return await _update_video_resource(
        access_token,
        video_id,
        privacy_status="public",
        publish_at=None,
    )


async def get_channel_stats(access_token: str, channel_id: str) -> dict[str, Any]:
    """Return high-level channel statistics."""
    params = {
        "part": "snippet,statistics,contentDetails",
    }
    if channel_id:
        params["id"] = channel_id
    else:
        params["mine"] = "true"

    data = await _google_json_request(
        "GET",
        f"{YOUTUBE_API_BASE_URL}/channels",
        access_token,
        params=params,
    )
    items = data.get("items", [])
    if not items:
        raise ValueError("Unable to fetch channel details")

    item = items[0]
    stats = item.get("statistics", {})
    snippet = item.get("snippet", {})
    content_details = item.get("contentDetails", {})
    return {
        "channel_id": item.get("id", channel_id),
        "title": snippet.get("title", ""),
        "subscribers": _parse_int(stats.get("subscriberCount")),
        "total_views": _parse_int(stats.get("viewCount")),
        "total_videos": _parse_int(stats.get("videoCount")),
        "custom_url": snippet.get("customUrl", ""),
        "uploads_playlist_id": content_details.get("relatedPlaylists", {}).get("uploads", ""),
        "hidden_subscriber_count": bool(stats.get("hiddenSubscriberCount", False)),
    }


async def _get_video_analytics_metrics(access_token: str, video_id: str, start_date: str) -> dict[str, Any]:
    data = await _google_json_request(
        "GET",
        f"{YOUTUBE_ANALYTICS_BASE_URL}/reports",
        access_token,
        params={
            "ids": "channel==MINE",
            "startDate": start_date,
            "endDate": datetime.now(timezone.utc).date().isoformat(),
            "metrics": "views,likes,comments,estimatedMinutesWatched,averageViewDuration",
            "dimensions": "video",
            "filters": f"video=={video_id}",
        },
    )
    rows = data.get("rows", [])
    if not rows:
        return {}
    row = rows[0]
    return {
        "views": _parse_int(row[1] if len(row) > 1 else 0),
        "likes": _parse_int(row[2] if len(row) > 2 else 0),
        "comments": _parse_int(row[3] if len(row) > 3 else 0),
        "watch_time": _parse_int(row[4] if len(row) > 4 else 0),
        "average_view_duration": _parse_int(row[5] if len(row) > 5 else 0),
    }


async def get_video_analytics(access_token: str, video_id: str) -> dict[str, Any]:
    """Return view and engagement analytics for one video."""
    item = await _fetch_video_resource(access_token, video_id)
    snippet = item.get("snippet", {})
    status = item.get("status", {})
    statistics = item.get("statistics", {})

    analytics_metrics: dict[str, Any] = {}
    published_at = snippet.get("publishedAt", "")
    start_date = published_at[:10] if published_at else datetime.now(timezone.utc).date().isoformat()
    try:
        analytics_metrics = await _get_video_analytics_metrics(access_token, video_id, start_date)
    except Exception as exc:  # pragma: no cover - depends on Analytics API enablement
        logger.warning("[YOUTUBE_DATA] Analytics API unavailable for %s: %s", video_id, exc)

    return {
        "video_id": video_id,
        "title": snippet.get("title", ""),
        "views": analytics_metrics.get("views", _parse_int(statistics.get("viewCount"))),
        "likes": analytics_metrics.get("likes", _parse_int(statistics.get("likeCount"))),
        "comments": analytics_metrics.get("comments", _parse_int(statistics.get("commentCount"))),
        "watch_time": analytics_metrics.get("watch_time"),
        "average_view_duration": analytics_metrics.get("average_view_duration"),
        "privacy_status": status.get("privacyStatus", "private"),
        "published_at": published_at,
        "thumbnail_url": _pick_thumbnail_url(snippet.get("thumbnails", {})),
        "url": f"https://www.youtube.com/watch?v={video_id}",
    }


async def list_channel_videos(
    access_token: str,
    channel_id: str,
    max_results: int = 20,
) -> list[dict[str, Any]]:
    """List the latest uploaded videos with basic stats."""
    channel_stats = await get_channel_stats(access_token, channel_id)
    uploads_playlist_id = channel_stats.get("uploads_playlist_id")
    if not uploads_playlist_id:
        return []

    playlist_data = await _google_json_request(
        "GET",
        f"{YOUTUBE_API_BASE_URL}/playlistItems",
        access_token,
        params={
            "part": "contentDetails",
            "playlistId": uploads_playlist_id,
            "maxResults": min(max_results, 50),
        },
    )
    video_ids = [
        item.get("contentDetails", {}).get("videoId")
        for item in playlist_data.get("items", [])
        if item.get("contentDetails", {}).get("videoId")
    ]
    if not video_ids:
        return []

    videos_data = await _google_json_request(
        "GET",
        f"{YOUTUBE_API_BASE_URL}/videos",
        access_token,
        params={
            "part": "snippet,statistics,status",
            "id": ",".join(video_ids),
        },
    )
    videos_by_id = {item["id"]: item for item in videos_data.get("items", [])}

    videos: list[dict[str, Any]] = []
    for video_id in video_ids:
        item = videos_by_id.get(video_id)
        if not item:
            continue
        snippet = item.get("snippet", {})
        status = item.get("status", {})
        statistics = item.get("statistics", {})
        videos.append(
            {
                "video_id": video_id,
                "title": snippet.get("title", ""),
                "views": _parse_int(statistics.get("viewCount")),
                "likes": _parse_int(statistics.get("likeCount")),
                "comments": _parse_int(statistics.get("commentCount")),
                "published_at": snippet.get("publishedAt", ""),
                "privacy_status": status.get("privacyStatus", "private"),
                "thumbnail_url": _pick_thumbnail_url(snippet.get("thumbnails", {})),
                "url": f"https://www.youtube.com/watch?v={video_id}",
            }
        )
    return videos


async def get_video_detail(access_token: str, video_id: str) -> dict[str, Any]:
    item = await _fetch_video_resource(access_token, video_id)
    snippet = item.get("snippet", {})
    status = item.get("status", {})
    statistics = item.get("statistics", {})
    analytics = await get_video_analytics(access_token, video_id)

    return {
        "video_id": video_id,
        "title": snippet.get("title", ""),
        "description": snippet.get("description", ""),
        "tags": snippet.get("tags", []),
        "views": _parse_int(statistics.get("viewCount")),
        "likes": _parse_int(statistics.get("likeCount")),
        "comments": _parse_int(statistics.get("commentCount")),
        "published_at": snippet.get("publishedAt", ""),
        "privacy_status": status.get("privacyStatus", "private"),
        "thumbnail_url": _pick_thumbnail_url(snippet.get("thumbnails", {})),
        "url": f"https://www.youtube.com/watch?v={video_id}",
        "analytics": analytics,
    }


async def schedule_video(
    access_token: str,
    video_id: str,
    publish_at: str,
) -> dict[str, Any]:
    """Schedule a private video to be published later."""
    updated = await _update_video_resource(
        access_token,
        video_id,
        privacy_status="private",
        publish_at=publish_at,
    )
    updated["status"] = "scheduled"
    return updated


async def fetch_current_channel_id(access_token: str) -> str:
    data = await _google_json_request(
        "GET",
        f"{YOUTUBE_API_BASE_URL}/channels",
        access_token,
        params={"part": "id", "mine": "true"},
    )
    items = data.get("items", [])
    if not items:
        raise ValueError("Unable to resolve authenticated YouTube channel_id")
    return items[0].get("id", "")
