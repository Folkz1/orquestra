"""
Orquestra - Memory Router
Semantic search, stats, and manual ingestion for the vector memory system.
"""

import logging

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas import MemoryIngestRequest, MemorySearchResponse, MemoryStatsResponse
from app.services.memory import get_memory_stats, search_memory, store_memory

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/search", response_model=MemorySearchResponse)
async def memory_search(
    q: str = Query(..., description="Search query"),
    limit: int = Query(10, ge=1, le=100, description="Max results"),
    source_type: str | None = Query(None, description="Filter by source type"),
    db: AsyncSession = Depends(get_db),
):
    """Semantic search across all stored memories."""
    results = await search_memory(db, q, limit=limit, source_type=source_type)
    return MemorySearchResponse(query=q, results=results, total=len(results))


@router.get("/stats", response_model=MemoryStatsResponse)
async def memory_stats(
    db: AsyncSession = Depends(get_db),
):
    """Get memory statistics grouped by source type."""
    stats = await get_memory_stats(db)
    return MemoryStatsResponse(**stats)


@router.post("/ingest")
async def memory_ingest(
    body: MemoryIngestRequest,
    db: AsyncSession = Depends(get_db),
):
    """Manually ingest text with metadata into the vector memory."""
    record = await store_memory(
        db,
        content=body.content,
        source_type=body.source_type,
        source_id=body.source_id,
        contact_name=body.contact_name,
        project_name=body.project_name,
        metadata=body.metadata,
        summary=body.summary,
    )

    if not record:
        return {"status": "error", "detail": "Failed to store memory"}

    return {
        "status": "ok",
        "id": str(record.id),
        "source_type": record.source_type,
        "has_embedding": record.embedding is not None,
    }
