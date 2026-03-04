"""
Orquestra - Notion Router
Import Notion databases and pages into Orquestra memory.
Live War Tasks view from Notion.
"""

import logging
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.services.notion import (
    get_notion_status,
    import_database,
    import_page,
    list_databases,
    _notion_headers,
    _get_page_content,
    NOTION_BASE_URL,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# War Tasks database ID (hardcoded - Diego's main task board)
WAR_TASKS_DB_ID = "30e89011-1538-8154-81df-efa3c4ff55ee"


class NotionImportRequest(BaseModel):
    database_id: Optional[str] = None
    database_name: Optional[str] = None
    page_id: Optional[str] = None


@router.get("/status")
async def notion_status(db: AsyncSession = Depends(get_db)):
    """Check Notion integration status."""
    return await get_notion_status(db)


@router.get("/databases")
async def notion_databases():
    """List accessible Notion databases."""
    if not settings.NOTION_API_KEY:
        raise HTTPException(status_code=400, detail="NOTION_API_KEY not configured")

    try:
        dbs = await list_databases()
        return {"databases": dbs}
    except Exception as exc:
        logger.error("[NOTION] Error listing databases: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc))


@router.post("/import")
async def notion_import(
    body: NotionImportRequest,
    db: AsyncSession = Depends(get_db),
):
    """Import a Notion database or single page into memory."""
    if not settings.NOTION_API_KEY:
        raise HTTPException(status_code=400, detail="NOTION_API_KEY not configured")

    if body.database_id:
        name = body.database_name or "Notion DB"
        result = await import_database(body.database_id, name, db)
        return result

    if body.page_id:
        result = await import_page(body.page_id, db)
        return result

    raise HTTPException(status_code=400, detail="Provide database_id or page_id")


@router.get("/war-tasks")
async def get_war_tasks():
    """Fetch War Tasks live from Notion with properties."""
    if not settings.NOTION_API_KEY:
        raise HTTPException(status_code=400, detail="NOTION_API_KEY not configured")

    try:
        tasks = []
        start_cursor = None

        async with httpx.AsyncClient(timeout=30.0) as client:
            while True:
                payload = {"page_size": 100}
                if start_cursor:
                    payload["start_cursor"] = start_cursor

                resp = await client.post(
                    f"{NOTION_BASE_URL}/databases/{WAR_TASKS_DB_ID}/query",
                    headers=_notion_headers(),
                    json=payload,
                )
                resp.raise_for_status()
                data = resp.json()

                for page in data.get("results", []):
                    task = _parse_war_task(page)
                    if task:
                        tasks.append(task)

                if not data.get("has_more"):
                    break
                start_cursor = data.get("next_cursor")

        return {"tasks": tasks, "total": len(tasks)}

    except httpx.HTTPStatusError as exc:
        logger.error("[NOTION] War Tasks fetch error: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc))


def _parse_war_task(page: dict) -> dict | None:
    """Parse a Notion page into a War Task dict."""
    props = page.get("properties", {})
    task = {
        "id": page["id"],
        "url": page.get("url", ""),
        "created": page.get("created_time", ""),
        "last_edited": page.get("last_edited_time", ""),
        "title": "",
        "status": "",
        "priority": "",
        "assignee": "",
        "project": "",
        "due_date": "",
        "tags": [],
    }

    for prop_name, prop in props.items():
        ptype = prop.get("type", "")
        name_lower = prop_name.lower()

        # Title
        if ptype == "title":
            parts = prop.get("title", [])
            task["title"] = "".join(p.get("plain_text", "") for p in parts)

        # Status (select or status type)
        elif ptype == "status":
            status_obj = prop.get("status")
            if status_obj:
                task["status"] = status_obj.get("name", "")

        elif ptype == "select":
            select_obj = prop.get("select")
            if select_obj:
                val = select_obj.get("name", "")
                if "status" in name_lower or "estado" in name_lower:
                    task["status"] = val
                elif "prior" in name_lower:
                    task["priority"] = val
                elif "projeto" in name_lower or "project" in name_lower:
                    task["project"] = val
                else:
                    task["tags"].append(val)

        # Multi-select (tags, labels)
        elif ptype == "multi_select":
            options = prop.get("multi_select", [])
            for opt in options:
                val = opt.get("name", "")
                if "tag" in name_lower or "label" in name_lower:
                    task["tags"].append(val)
                elif "projeto" in name_lower or "project" in name_lower:
                    task["project"] = val
                else:
                    task["tags"].append(val)

        # People (assignee)
        elif ptype == "people":
            people = prop.get("people", [])
            names = [p.get("name", "") for p in people if p.get("name")]
            if names and ("assign" in name_lower or "responsav" in name_lower or "pessoa" in name_lower):
                task["assignee"] = ", ".join(names)

        # Date
        elif ptype == "date":
            date_obj = prop.get("date")
            if date_obj and ("due" in name_lower or "prazo" in name_lower or "data" in name_lower or "date" in name_lower):
                task["due_date"] = date_obj.get("start", "")

        # Rich text (could be notes/description)
        elif ptype == "rich_text":
            parts = prop.get("rich_text", [])
            text = "".join(p.get("plain_text", "") for p in parts)
            if text and ("nota" in name_lower or "descri" in name_lower or "note" in name_lower):
                task["notes"] = text[:300]

    return task if task["title"] else None
