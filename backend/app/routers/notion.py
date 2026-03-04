"""
Orquestra - Notion Router
Import Notion databases and pages into Orquestra memory.
"""

import logging
from typing import Optional

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
)

logger = logging.getLogger(__name__)

router = APIRouter()


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
