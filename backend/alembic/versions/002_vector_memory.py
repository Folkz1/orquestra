"""002 - Vector memory: memory_embeddings table with pgvector

Revision ID: 002_vector_memory
Revises: 001_initial
Create Date: 2026-03-03

Adds pgvector extension and memory_embeddings table for semantic search
across WhatsApp messages, recordings, and YouTube transcriptions.

IMPORTANT: Uses CAST(x AS uuid) syntax, NEVER ::uuid (asyncpg incompatibility)
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID, TIMESTAMP

# revision identifiers
revision = "002_vector_memory"
down_revision = "001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Check if pgvector is available BEFORE trying to use it
    # (CREATE EXTENSION in a transaction aborts the transaction on failure)
    conn = op.get_bind()
    result = conn.execute(
        sa.text("SELECT COUNT(*) FROM pg_available_extensions WHERE name = 'vector'")
    )
    count = result.scalar()

    if not count:
        # pgvector not available - skip vector memory table
        # Switch DB to pgvector/pgvector:pg16 image to enable this feature
        return

    # Enable pgvector extension
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # ─── Memory Embeddings ─────────────────────────────────────────
    op.execute(
        """
        CREATE TABLE memory_embeddings (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            source_type VARCHAR(20) NOT NULL,
            source_id UUID,
            content TEXT NOT NULL,
            summary TEXT,
            embedding vector(1536),
            metadata JSONB DEFAULT '{}',
            contact_name VARCHAR(255),
            project_name VARCHAR(255),
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
        """
    )

    # HNSW index for cosine similarity search
    op.execute(
        """
        CREATE INDEX idx_memory_embedding
        ON memory_embeddings USING hnsw (embedding vector_cosine_ops)
        """
    )

    # Index on source_type for filtered queries
    op.execute(
        """
        CREATE INDEX idx_memory_source
        ON memory_embeddings(source_type)
        """
    )

    # Index on created_at for chronological queries
    op.execute(
        """
        CREATE INDEX idx_memory_created
        ON memory_embeddings(created_at DESC)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_memory_created")
    op.execute("DROP INDEX IF EXISTS idx_memory_source")
    op.execute("DROP INDEX IF EXISTS idx_memory_embedding")
    op.execute("DROP TABLE IF EXISTS memory_embeddings")
    # Note: not dropping the vector extension as other tables may use it
