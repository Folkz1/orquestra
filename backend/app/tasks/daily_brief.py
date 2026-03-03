"""
Orquestra - Daily Brief Scheduled Task
Uses APScheduler to generate and send daily briefs at a configured hour.
"""

import logging
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.config import settings
from app.database import async_session
from app.services.orchestrator import generate_daily_brief, send_telegram_brief

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


async def scheduled_daily_brief():
    """
    Scheduled task: generates a daily brief for the last 24 hours
    and sends it via Telegram.
    Runs at the hour configured by BRIEFING_HOUR.
    """
    logger.info("[DAILY_BRIEF] Starting scheduled daily brief generation...")

    now = datetime.now(timezone.utc)
    date_from = now - timedelta(hours=24)
    date_to = now

    async with async_session() as db:
        try:
            brief_data = await generate_daily_brief(db, date_from, date_to)
            await db.commit()
            logger.info("[DAILY_BRIEF] Brief generated successfully: %s", brief_data.get("id"))

            # Send via Telegram
            sent = await send_telegram_brief(brief_data)
            if sent:
                logger.info("[DAILY_BRIEF] Telegram notification sent")
            else:
                logger.warning("[DAILY_BRIEF] Telegram notification not sent")

        except Exception as exc:
            logger.error("[DAILY_BRIEF] Scheduled brief generation failed: %s", exc)
            await db.rollback()


def start_scheduler():
    """Start the APScheduler with the daily brief job."""
    scheduler.add_job(
        scheduled_daily_brief,
        "cron",
        hour=settings.BRIEFING_HOUR,
        minute=0,
        id="daily_brief",
        replace_existing=True,
        timezone="UTC",
    )
    scheduler.start()
    logger.info(
        "[DAILY_BRIEF] Scheduler started. Brief will run daily at %02d:00 UTC",
        settings.BRIEFING_HOUR,
    )


def shutdown_scheduler():
    """Gracefully shutdown the scheduler."""
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("[DAILY_BRIEF] Scheduler stopped")
