"""
Orquestra - Sync Router
Triggers project state synchronization from local git repos.
"""

import logging

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.project_sync import sync_all_projects

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/projects")
async def sync_projects(db: AsyncSession = Depends(get_db)):
    """Sync all registered projects from local git state."""
    results = await sync_all_projects(db)

    summary = {
        "total": len(results),
        "created": sum(1 for r in results if r["status"] == "created"),
        "updated": sum(1 for r in results if r["status"] == "updated"),
        "errors": sum(1 for r in results if r["status"] == "error"),
    }

    logger.info("[SYNC] Completed: %s", summary)

    return {
        "summary": summary,
        "projects": results,
    }
