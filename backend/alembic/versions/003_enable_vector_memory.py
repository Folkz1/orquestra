"""003 - Enable vector memory: create memory_embeddings if pgvector now available

Revision ID: 003_enable_vector_memory
Revises: 002_vector_memory
Create Date: 2026-03-03

Runs after pgvector image is in place. Creates memory_embeddings table if it
was skipped in 002 (pgvector not available at that time).

IMPORTANT: Uses CAST(x AS uuid) syntax, NEVER ::uuid (asyncpg incompatibility)
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = "003_enable_vector_memory"
down_revision = "002_vector_memory"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # Check if memory_embeddings already exists (002 may have created it)
    result = conn.execute(
        sa.text(
            "SELECT COUNT(*) FROM information_schema.tables "
            "WHERE table_schema='public' AND table_name='memory_embeddings'"
        )
    )
    if result.scalar():
        return  # Already created, nothing to do

    # Check pgvector is available
    result = conn.execute(
        sa.text("SELECT COUNT(*) FROM pg_available_extensions WHERE name = 'vector'")
    )
    if not result.scalar():
        return  # Still not available, skip

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
