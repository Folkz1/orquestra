"""
Orquestra - Notion Import Service
Imports pages from Notion databases into Orquestra's memory (RAG).
"""

import logging

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.services.memory import store_memory

logger = logging.getLogger(__name__)

NOTION_BASE_URL = "https://api.notion.com/v1"


def _notion_headers() -> dict:
    """Build Notion API request headers."""
    return {
        "Authorization": f"Bearer {settings.NOTION_API_KEY}",
        "Notion-Version": settings.NOTION_API_VERSION,
        "Content-Type": "application/json",
    }


async def list_databases() -> list[dict]:
    """
    List all databases accessible by the Notion integration.
    Uses Notion Search API with filter for databases, paginated.
    """
    if not settings.NOTION_API_KEY:
        return []

    databases = []
    start_cursor = None

    async with httpx.AsyncClient(timeout=30.0) as client:
        while True:
            payload = {
                "filter": {"value": "database", "property": "object"},
                "page_size": 100,
            }
            if start_cursor:
                payload["start_cursor"] = start_cursor

            resp = await client.post(
                f"{NOTION_BASE_URL}/search",
                headers=_notion_headers(),
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()

            for db in data.get("results", []):
                title_parts = db.get("title", [])
                title = "".join(p.get("plain_text", "") for p in title_parts) or "Untitled"
                databases.append({
                    "id": db["id"],
                    "title": title,
                    "url": db.get("url", ""),
                })

            if not data.get("has_more"):
                break
            start_cursor = data.get("next_cursor")

    logger.info("[NOTION] Found %d databases", len(databases))
    return databases


async def _list_database_pages(database_id: str) -> list[dict]:
    """Query all pages in a Notion database, paginated."""
    pages = []
    start_cursor = None

    async with httpx.AsyncClient(timeout=30.0) as client:
        while True:
            payload = {"page_size": 100}
            if start_cursor:
                payload["start_cursor"] = start_cursor

            resp = await client.post(
                f"{NOTION_BASE_URL}/databases/{database_id}/query",
                headers=_notion_headers(),
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()

            for page in data.get("results", []):
                # Extract title from properties
                title = _extract_page_title(page)
                pages.append({
                    "id": page["id"],
                    "title": title,
                    "url": page.get("url", ""),
                    "last_edited": page.get("last_edited_time", ""),
                })

            if not data.get("has_more"):
                break
            start_cursor = data.get("next_cursor")

    return pages


def _extract_page_title(page: dict) -> str:
    """Extract the title from a Notion page's properties."""
    props = page.get("properties", {})
    for prop in props.values():
        if prop.get("type") == "title":
            title_parts = prop.get("title", [])
            return "".join(p.get("plain_text", "") for p in title_parts) or "Untitled"
    return "Untitled"


async def _get_page_content(page_id: str) -> str:
    """Fetch all blocks from a page and extract text content."""
    blocks_text = []
    start_cursor = None

    async with httpx.AsyncClient(timeout=30.0) as client:
        while True:
            url = f"{NOTION_BASE_URL}/blocks/{page_id}/children?page_size=100"
            if start_cursor:
                url += f"&start_cursor={start_cursor}"

            resp = await client.get(url, headers=_notion_headers())
            resp.raise_for_status()
            data = resp.json()

            for block in data.get("results", []):
                text = _extract_block_text(block)
                if text:
                    blocks_text.append(text)

            if not data.get("has_more"):
                break
            start_cursor = data.get("next_cursor")

    return "\n".join(blocks_text)


def _extract_block_text(block: dict) -> str:
    """Extract text from a single Notion block."""
    block_type = block.get("type", "")
    block_data = block.get(block_type, {})

    # Most text blocks have a "rich_text" array
    rich_text = block_data.get("rich_text", [])
    if rich_text:
        text = "".join(rt.get("plain_text", "") for rt in rich_text)
        # Add markdown-style prefixes
        if block_type.startswith("heading_1"):
            return f"# {text}"
        elif block_type.startswith("heading_2"):
            return f"## {text}"
        elif block_type.startswith("heading_3"):
            return f"### {text}"
        elif block_type == "bulleted_list_item":
            return f"- {text}"
        elif block_type == "numbered_list_item":
            return f"1. {text}"
        elif block_type == "to_do":
            checked = block_data.get("checked", False)
            return f"[{'x' if checked else ' '}] {text}"
        elif block_type == "quote":
            return f"> {text}"
        elif block_type == "code":
            lang = block_data.get("language", "")
            return f"```{lang}\n{text}\n```"
        return text

    # Toggle blocks
    if block_type == "toggle":
        toggle_text = block_data.get("rich_text", [])
        return "".join(rt.get("plain_text", "") for rt in toggle_text)

    # Divider
    if block_type == "divider":
        return "---"

    return ""


async def import_database(
    database_id: str,
    database_name: str,
    db: AsyncSession,
) -> dict:
    """
    Import all pages from a Notion database into Orquestra memory.

    Returns summary with counts.
    """
    pages = await _list_database_pages(database_id)
    imported = 0
    errors = 0

    for page in pages:
        try:
            content = await _get_page_content(page["id"])
            if not content.strip():
                continue

            full_content = f"# {page['title']}\n\n{content}"

            await store_memory(
                db=db,
                content=full_content[:8000],  # respect embedding limit
                source_type="notion",
                project_name=database_name,
                metadata={
                    "page_id": page["id"],
                    "page_title": page["title"],
                    "page_url": page["url"],
                    "database_id": database_id,
                    "database_name": database_name,
                    "last_edited": page.get("last_edited", ""),
                },
                summary=f"Notion: {database_name} / {page['title']}",
            )
            imported += 1

        except Exception as exc:
            errors += 1
            logger.error("[NOTION] Error importing page %s: %s", page["id"], exc)

    logger.info("[NOTION] Imported %d/%d pages from %s", imported, len(pages), database_name)

    return {
        "database_id": database_id,
        "database_name": database_name,
        "total_pages": len(pages),
        "imported": imported,
        "errors": errors,
    }


async def import_page(page_id: str, db: AsyncSession) -> dict:
    """Import a single Notion page into memory."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            f"{NOTION_BASE_URL}/pages/{page_id}",
            headers=_notion_headers(),
        )
        resp.raise_for_status()
        page_data = resp.json()

    title = _extract_page_title(page_data)
    content = await _get_page_content(page_id)

    if not content.strip():
        return {"page_id": page_id, "title": title, "status": "empty"}

    full_content = f"# {title}\n\n{content}"

    await store_memory(
        db=db,
        content=full_content[:8000],
        source_type="notion",
        metadata={
            "page_id": page_id,
            "page_title": title,
            "page_url": page_data.get("url", ""),
        },
        summary=f"Notion page: {title}",
    )

    return {"page_id": page_id, "title": title, "status": "imported"}


async def get_notion_status(db: AsyncSession) -> dict:
    """Check Notion configuration status and memory count."""
    configured = bool(settings.NOTION_API_KEY)

    count = 0
    if configured:
        try:
            result = await db.execute(
                text("SELECT COUNT(*) FROM memory_embeddings WHERE source_type = 'notion'")
            )
            count = result.scalar() or 0
        except Exception:
            pass

    return {
        "configured": configured,
        "notion_memories": count,
    }
