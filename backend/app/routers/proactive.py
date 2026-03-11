"""
Orquestra - Proactive Bot Router
Manual trigger and status for the proactive analysis bot.
"""

import logging

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.tasks.proactive_bot import run_proactive_analysis

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/trigger")
async def trigger_proactive(db: AsyncSession = Depends(get_db)):
    """Manually trigger the proactive analysis bot."""
    result = await run_proactive_analysis(db)
    await db.commit()
    return result
