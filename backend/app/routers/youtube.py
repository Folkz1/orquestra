"""
Orquestra - YouTube Router
Trend analysis and content brief generation for GuyFolkz channel.
"""

import logging

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas import YouTubeAnalyzeRequest, YouTubeAnalyzeResponse, YouTubeSendBriefRequest
from app.services.youtube import analyze_channel_trends, generate_content_brief
from app.services.whatsapp import send_content_brief_to_whatsapp
from app.services.memory import store_memory

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/analyze", response_model=YouTubeAnalyzeResponse)
async def youtube_analyze(
    body: YouTubeAnalyzeRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Analyze YouTube trends and generate content ideas.
    Stores the analysis in vector memory for future reference.
    """
    result = await analyze_channel_trends(
        topics=body.topics,
        sources=body.sources,
    )

    # Store analysis in memory for future context
    video_ideas = result.get("video_ideas", [])
    ideas_summary = "; ".join(
        idea.get("title", "") for idea in video_ideas[:5]
    )

    await store_memory(
        db,
        content=f"YouTube trend analysis: {ideas_summary}",
        source_type="youtube",
        metadata={
            "topics": body.topics,
            "sources": body.sources,
            "video_count": len(video_ideas),
        },
        summary=f"Analise de tendencias: {', '.join(body.topics or ['IA', 'automacao'])}",
    )

    return YouTubeAnalyzeResponse(
        trends=result.get("trends", []),
        video_ideas=result.get("video_ideas", []),
        market_insights=result.get("market_insights", []),
    )


@router.post("/brief")
async def youtube_brief(
    topic: str,
    db: AsyncSession = Depends(get_db),
):
    """Generate a detailed content brief for a specific topic."""
    # Search memory for relevant context
    from app.services.memory import get_context_for_brief

    memory_context = await get_context_for_brief(db, topic, limit=10)

    result = await generate_content_brief(
        topic=topic,
        channel_context=memory_context,
    )

    # Store the brief in memory
    titles = result.get("title_options", [])
    await store_memory(
        db,
        content=f"Content brief for: {topic}. Titles: {'; '.join(titles[:3])}",
        source_type="youtube",
        metadata={"type": "content_brief", "topic": topic},
        summary=f"Briefing de conteudo: {topic}",
    )

    return result


@router.post("/send-brief")
async def youtube_send_brief(
    body: YouTubeSendBriefRequest,
    db: AsyncSession = Depends(get_db),
):
    """Generate trend analysis and send the brief via WhatsApp."""
    # Generate the analysis
    result = await analyze_channel_trends(
        topics=body.topics,
        sources=body.sources,
    )

    # Send via WhatsApp
    sent = await send_content_brief_to_whatsapp(
        phone=body.phone,
        brief=result,
    )

    # Store in memory
    video_ideas = result.get("video_ideas", [])
    ideas_summary = "; ".join(
        idea.get("title", "") for idea in video_ideas[:5]
    )
    await store_memory(
        db,
        content=f"YouTube brief sent to {body.phone}: {ideas_summary}",
        source_type="youtube",
        metadata={
            "type": "sent_brief",
            "phone": body.phone,
            "topics": body.topics,
            "sent_whatsapp": sent,
        },
        summary=f"Briefing enviado via WhatsApp para {body.phone}",
    )

    return {
        "status": "ok" if sent else "error",
        "sent_whatsapp": sent,
        "video_ideas_count": len(video_ideas),
        "trends_count": len(result.get("trends", [])),
    }
