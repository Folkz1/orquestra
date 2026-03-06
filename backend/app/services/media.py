"""
Orquestra - Media Service
Download media from Evolution API and save to disk.
"""

import base64
import logging
import os

import aiofiles
import httpx

from app.config import settings

logger = logging.getLogger(__name__)


def _resolve_instance(raw_payload: dict | None) -> tuple[str, str, str]:
    """
    Resolve the correct Evolution instance name, API key, and base URL from the webhook payload.
    Falls back to the default EVOLUTION_INSTANCE/EVOLUTION_API_KEY/EVOLUTION_API_URL if no match.

    Returns:
        (instance_name, apikey, base_url)
    """
    import json as _json

    instance = settings.EVOLUTION_INSTANCE
    apikey = settings.EVOLUTION_API_KEY
    base_url = settings.EVOLUTION_API_URL

    if raw_payload:
        # Prefer server_url + apikey directly from webhook payload (Evolution v2)
        payload_url = raw_payload.get("server_url")
        payload_key = raw_payload.get("apikey")
        payload_instance = raw_payload.get("instance")

        if payload_url and payload_key:
            base_url = payload_url.rstrip("/")
            apikey = payload_key
            if payload_instance:
                instance = payload_instance
            logger.info("[MEDIA] Resolved from payload: instance=%s url=%s", instance, base_url)
            return instance, apikey, base_url

        # Fallback: check EVOLUTION_INSTANCES map
        if payload_instance and settings.EVOLUTION_INSTANCES:
            try:
                instances_map = _json.loads(settings.EVOLUTION_INSTANCES)
                if payload_instance in instances_map:
                    entry = instances_map[payload_instance]
                    if isinstance(entry, dict):
                        instance = payload_instance
                        apikey = entry.get("apikey", apikey)
                        base_url = entry.get("url", base_url)
                    elif isinstance(entry, str):
                        instance = payload_instance
                        apikey = entry
                    logger.info("[MEDIA] Using instance '%s' from EVOLUTION_INSTANCES", instance)
            except _json.JSONDecodeError:
                pass

    return instance, apikey, base_url


async def download_media_from_evolution(
    message_id: str, raw_payload: dict | None = None
) -> bytes:
    """
    Download media from Evolution API.

    Strategy (Evolution API v2):
    1. POST /chat/getBase64FromMediaMessage/{instance} (v2 endpoint)
    2. GET /message/getBase64/{instance}/{id} (v1 fallback)

    Automatically resolves the correct instance and API key from the webhook payload
    when multiple instances are configured via EVOLUTION_INSTANCES.

    Args:
        message_id: The Evolution message ID to fetch media for.
        raw_payload: Original webhook payload (used to extract remoteJid/fromMe for v2).

    Returns:
        Raw bytes of the media file.
    """
    instance, apikey, base_url = _resolve_instance(raw_payload)
    headers = {"apikey": apikey}

    # Try v2 endpoint: POST /chat/getBase64FromMediaMessage/{instance}
    if raw_payload:
        key = raw_payload.get("data", {}).get("key", {})
        remote_jid = key.get("remoteJid", "")
        from_me = key.get("fromMe", False)

        if remote_jid:
            v2_url = f"{base_url}/chat/getBase64FromMediaMessage/{instance}"
            v2_body = {
                "message": {
                    "key": {
                        "id": message_id,
                        "remoteJid": remote_jid,
                        "fromMe": from_me,
                    }
                },
                "convertToMp4": False,
            }
            try:
                async with httpx.AsyncClient(timeout=60.0) as client:
                    response = await client.post(
                        v2_url, headers={**headers, "Content-Type": "application/json"}, json=v2_body
                    )
                    response.raise_for_status()

                data = response.json()
                b64_string = data if isinstance(data, str) else data.get("base64", "")
                if b64_string:
                    if "," in b64_string:
                        b64_string = b64_string.split(",", 1)[1]
                    logger.info("[MEDIA] Downloaded via v2 endpoint for %s", message_id)
                    return base64.b64decode(b64_string)
            except Exception as exc:
                logger.warning("[MEDIA] v2 getBase64 failed for %s: %s, trying v1...", message_id, exc)

    # Fallback: v1 endpoint GET /message/getBase64/{instance}/{id}
    v1_url = f"{base_url}/message/getBase64/{instance}/{message_id}"
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.get(v1_url, headers=headers)
        response.raise_for_status()

    data = response.json()
    b64_string = data if isinstance(data, str) else data.get("base64", "")
    if not b64_string:
        raise ValueError(f"No base64 data in Evolution response for message {message_id}")

    if "," in b64_string:
        b64_string = b64_string.split(",", 1)[1]

    return base64.b64decode(b64_string)


async def save_media(content: bytes, filename: str) -> str:
    """
    Save media bytes to disk in the configured upload directory.

    Args:
        content: Raw bytes to write.
        filename: Target filename (e.g., "audio_abc123.ogg").

    Returns:
        Full path to the saved file.
    """
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    file_path = os.path.join(settings.UPLOAD_DIR, filename)

    async with aiofiles.open(file_path, "wb") as f:
        await f.write(content)

    logger.info("[MEDIA] Saved %d bytes to %s", len(content), file_path)
    return file_path
