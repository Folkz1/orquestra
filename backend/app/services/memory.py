"""
Orquestra - Memory Service (Vector / Semantic Memory)
Stores and retrieves embeddings for semantic search across all content sources.
Uses OpenRouter for embedding generation (text-embedding-3-small via OpenAI).
"""

import logging
import uuid
from datetime import datetime

import httpx
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import MemoryEmbedding

logger = logging.getLogger(__name__)

EMBEDDING_MODEL = "openai/text-embedding-3-small"
EMBEDDING_DIMENSION = 1536


async def generate_embedding(content: str) -> list[float]:
    """
    Generate an embedding vector via OpenRouter (text-embedding-3-small).

    Args:
        content: The text to embed.

    Returns:
        List of floats representing the embedding vector (1536 dimensions).

    Raises:
        httpx.HTTPStatusError: If the API call fails.
    """
    if not settings.OPENROUTER_API_KEY:
        logger.warning("[MEMORY] No OPENROUTER_API_KEY configured, skipping embedding")
        return []

    url = f"{settings.OPENROUTER_BASE_URL}/embeddings"
    headers = {
        "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": EMBEDDING_MODEL,
        "input": content[:8000],  # Truncate to avoid token limits
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(url, headers=headers, json=payload)
            response.raise_for_status()

        data = response.json()
        embedding = data["data"][0]["embedding"]
        logger.info(
            "[MEMORY] Generated embedding: dim=%d, model=%s",
            len(embedding),
            EMBEDDING_MODEL,
        )
        return embedding

    except Exception as exc:
        logger.error("[MEMORY] Embedding generation failed: %s", exc)
        return []


async def store_memory(
    db: AsyncSession,
    content: str,
    source_type: str,
    source_id: str | None = None,
    contact_name: str | None = None,
    project_name: str | None = None,
    metadata: dict | None = None,
    summary: str | None = None,
) -> MemoryEmbedding | None:
    """
    Generate embedding and store content in memory_embeddings table.

    Args:
        db: Async database session.
        content: Text content to store and embed.
        source_type: One of 'message', 'recording', 'youtube'.
        source_id: Optional UUID reference to the source record.
        contact_name: Name of the contact (for messages).
        project_name: Name of the associated project.
        metadata: Additional metadata as a dict.
        summary: Optional pre-generated summary.

    Returns:
        The created MemoryEmbedding record, or None on failure.
    """
    if not content or not content.strip():
        logger.warning("[MEMORY] Empty content, skipping store")
        return None

    # Generate embedding
    embedding = await generate_embedding(content)

    # Parse source_id
    parsed_source_id = None
    if source_id:
        try:
            parsed_source_id = uuid.UUID(source_id)
        except ValueError:
            logger.warning("[MEMORY] Invalid source_id: %s", source_id)

    try:
        record = MemoryEmbedding(
            source_type=source_type,
            source_id=parsed_source_id,
            content=content,
            summary=summary,
            embedding=embedding if embedding else None,
            metadata_=metadata or {},
            contact_name=contact_name,
            project_name=project_name,
        )
        db.add(record)
        await db.flush()
        await db.refresh(record)

        logger.info(
            "[MEMORY] Stored memory: id=%s, source=%s, has_embedding=%s",
            record.id,
            source_type,
            bool(embedding),
        )
        return record
    except Exception as exc:
        logger.warning("[MEMORY] Could not store memory (table may not exist): %s", exc)
        await db.rollback()
        return None


async def search_memory(
    db: AsyncSession,
    query: str,
    limit: int = 10,
    source_type: str | None = None,
) -> list[dict]:
    """
    Semantic search in memory using cosine similarity.

    Args:
        db: Async database session.
        query: Search query text.
        limit: Maximum number of results.
        source_type: Optional filter by source type.

    Returns:
        List of dicts with memory records and similarity scores.
    """
    # Generate query embedding
    query_embedding = await generate_embedding(query)
    if not query_embedding:
        logger.warning("[MEMORY] Could not generate query embedding, falling back to text search")
        return await _text_search_fallback(db, query, limit, source_type)

    # Build the cosine similarity query
    # cosine distance: embedding <=> query_embedding
    # similarity = 1 - cosine_distance
    embedding_str = "[" + ",".join(str(v) for v in query_embedding) + "]"

    sql = text(
        """
        SELECT
            id,
            source_type,
            source_id,
            content,
            summary,
            contact_name,
            project_name,
            metadata,
            created_at,
            1 - (embedding <=> CAST(:embedding AS vector)) as similarity
        FROM memory_embeddings
        WHERE embedding IS NOT NULL
        """
        + (" AND source_type = :source_type" if source_type else "")
        + """
        ORDER BY similarity DESC
        LIMIT :limit
        """
    )

    params = {"embedding": embedding_str, "limit": limit}
    if source_type:
        params["source_type"] = source_type

    result = await db.execute(sql, params)
    rows = result.fetchall()

    memories = []
    for row in rows:
        memories.append({
            "id": str(row.id),
            "source_type": row.source_type,
            "source_id": str(row.source_id) if row.source_id else None,
            "content": row.content,
            "summary": row.summary,
            "contact_name": row.contact_name,
            "project_name": row.project_name,
            "metadata": row.metadata,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "similarity": round(float(row.similarity), 4),
        })

    logger.info("[MEMORY] Search returned %d results for query: %s", len(memories), query[:80])
    return memories


async def _text_search_fallback(
    db: AsyncSession,
    query: str,
    limit: int,
    source_type: str | None = None,
) -> list[dict]:
    """Fallback text search when embeddings are not available."""
    search_pattern = f"%{query}%"

    sql = text(
        """
        SELECT
            id,
            source_type,
            source_id,
            content,
            summary,
            contact_name,
            project_name,
            metadata,
            created_at
        FROM memory_embeddings
        WHERE content ILIKE :pattern
        """
        + (" AND source_type = :source_type" if source_type else "")
        + """
        ORDER BY created_at DESC
        LIMIT :limit
        """
    )

    params = {"pattern": search_pattern, "limit": limit}
    if source_type:
        params["source_type"] = source_type

    result = await db.execute(sql, params)
    rows = result.fetchall()

    memories = []
    for row in rows:
        memories.append({
            "id": str(row.id),
            "source_type": row.source_type,
            "source_id": str(row.source_id) if row.source_id else None,
            "content": row.content,
            "summary": row.summary,
            "contact_name": row.contact_name,
            "project_name": row.project_name,
            "metadata": row.metadata,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "similarity": 0.0,  # No similarity score for text search
        })

    return memories


async def get_context_for_brief(
    db: AsyncSession,
    topic: str,
    limit: int = 20,
) -> str:
    """
    Get relevant memories for a topic (used in briefing generation).

    Args:
        db: Async database session.
        topic: Topic/query to search for relevant context.
        limit: Maximum number of memory records to retrieve.

    Returns:
        Formatted string with relevant memory context.
    """
    memories = await search_memory(db, topic, limit=limit)
    if not memories:
        return ""

    context_parts = ["--- MEMORIA SEMANTICA (contexto relevante) ---"]
    for mem in memories:
        sim = mem.get("similarity", 0)
        source = mem.get("source_type", "?")
        contact = mem.get("contact_name", "")
        content = mem.get("content", "")[:500]
        summary = mem.get("summary", "")

        header = f"[{source}]"
        if contact:
            header += f" {contact}"
        header += f" (relevancia: {sim:.0%})"

        context_parts.append(f"\n{header}")
        if summary:
            context_parts.append(f"  Resumo: {summary[:300]}")
        else:
            context_parts.append(f"  {content}")

    return "\n".join(context_parts)


async def get_memory_stats(db: AsyncSession) -> dict:
    """
    Get memory statistics grouped by source_type.

    Returns:
        Dict with counts per source_type and total.
    """
    sql = text(
        """
        SELECT source_type, COUNT(*) as count
        FROM memory_embeddings
        GROUP BY source_type
        ORDER BY count DESC
        """
    )
    result = await db.execute(sql)
    rows = result.fetchall()

    stats = {}
    total = 0
    for row in rows:
        stats[row.source_type] = row.count
        total += row.count

    return {
        "by_source": stats,
        "total": total,
    }
