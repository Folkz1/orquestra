"""
Orquestra - Daily YouTube Analysis Task
Runs alongside daily_brief to generate and send YouTube content ideas.
"""

import logging

from app.config import settings
from app.database import async_session
from app.services.youtube import analyze_channel_trends
from app.services.whatsapp import send_content_brief_to_whatsapp
from app.services.orchestrator import send_telegram_brief
from app.services.memory import store_memory

logger = logging.getLogger(__name__)

# Diego's WhatsApp number for daily briefs
DIEGO_WHATSAPP = "5195318541"

# Default topics for daily analysis
DEFAULT_TOPICS = ["IA", "automacao", "licitacoes", "ChatGPT", "agentes de IA"]
DEFAULT_SOURCES = ["reddit", "youtube", "news", "twitter/x"]


async def daily_youtube_analysis():
    """
    Daily YouTube analysis task:
    1. Analyze trending topics in AI, automacao, licitacoes
    2. Generate 3-5 video ideas with titles + thumbnail prompts
    3. Send results via WhatsApp to configured number
    4. Also send via Telegram
    """
    logger.info("[YOUTUBE_DAILY] Starting daily YouTube analysis...")

    async with async_session() as db:
        try:
            # 1. Analyze trends
            result = await analyze_channel_trends(
                topics=DEFAULT_TOPICS,
                sources=DEFAULT_SOURCES,
            )

            video_ideas = result.get("video_ideas", [])
            trends = result.get("trends", [])
            insights = result.get("market_insights", [])

            logger.info(
                "[YOUTUBE_DAILY] Analysis complete: %d ideas, %d trends, %d insights",
                len(video_ideas),
                len(trends),
                len(insights),
            )

            # 2. Store in memory
            ideas_summary = "; ".join(
                idea.get("title", "") for idea in video_ideas[:5]
            )
            await store_memory(
                db,
                content=f"Daily YouTube analysis: {ideas_summary}",
                source_type="youtube",
                metadata={
                    "type": "daily_analysis",
                    "topics": DEFAULT_TOPICS,
                    "video_count": len(video_ideas),
                    "trend_count": len(trends),
                },
                summary=f"Analise diaria YouTube: {len(video_ideas)} ideias de video",
            )
            await db.commit()

            # 3. Send via WhatsApp
            whatsapp_sent = await send_content_brief_to_whatsapp(
                phone=DIEGO_WHATSAPP,
                brief=result,
            )
            if whatsapp_sent:
                logger.info("[YOUTUBE_DAILY] WhatsApp brief sent to %s", DIEGO_WHATSAPP)
            else:
                logger.warning("[YOUTUBE_DAILY] WhatsApp send failed or not configured")

            # 4. Send via Telegram (reuse the telegram sender with adapted format)
            telegram_data = _format_for_telegram(result)
            telegram_sent = await send_telegram_brief(telegram_data)
            if telegram_sent:
                logger.info("[YOUTUBE_DAILY] Telegram brief sent")
            else:
                logger.warning("[YOUTUBE_DAILY] Telegram send failed or not configured")

        except Exception as exc:
            logger.error("[YOUTUBE_DAILY] Daily analysis failed: %s", exc)
            await db.rollback()


def _format_for_telegram(analysis: dict) -> dict:
    """
    Adapt YouTube analysis to the telegram brief format
    so we can reuse send_telegram_brief.
    """
    video_ideas = analysis.get("video_ideas", [])
    trends = analysis.get("trends", [])
    insights = analysis.get("market_insights", [])

    # Build summary
    summary_parts = ["*YOUTUBE DAILY - GuyFolkz*\n"]
    summary_parts.append(f"Ideias: {len(video_ideas)} | Tendencias: {len(trends)}\n")

    for i, idea in enumerate(video_ideas[:5], 1):
        title = idea.get("title", "?")
        urgency = idea.get("urgency", "medium")
        summary_parts.append(f"{i}. [{urgency.upper()}] {title}")

    summary = "\n".join(summary_parts)

    # Map to the telegram brief format
    pending_actions = []
    for idea in video_ideas[:5]:
        pending_actions.append({
            "action": f"Gravar: {idea.get('title', '?')}",
            "priority": idea.get("urgency", "medium"),
            "contact": None,
        })

    key_insights_list = []
    for insight in insights[:5]:
        key_insights_list.append({
            "insight": insight if isinstance(insight, str) else str(insight),
            "relevance": "high",
        })

    return {
        "summary": summary,
        "pending_actions": pending_actions,
        "decisions_made": [],
        "key_insights": key_insights_list,
        "projects_mentioned": ["GuyFolkz", "Motor100K"],
        "total_messages": 0,
        "total_recordings": 0,
        "period_start": "YouTube Daily",
        "period_end": "Analysis",
    }
