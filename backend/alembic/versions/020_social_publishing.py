"""Social Publishing - Instagram & TikTok multi-platform distribution

Revision ID: 020_social_publishing
Revises: 019_playbook_platform
Create Date: 2026-03-16
"""

from alembic import op

revision = "020_social_publishing"
down_revision = "019_playbook_platform"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    CREATE TABLE IF NOT EXISTS social_accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
        platform TEXT NOT NULL CHECK (platform IN ('instagram', 'tiktok', 'youtube')),
        account_name TEXT,
        account_id TEXT,
        access_token TEXT,
        refresh_token TEXT,
        token_expires_at TIMESTAMPTZ,
        scopes TEXT[],
        metadata JSONB DEFAULT '{}',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (project_id, platform, account_id)
    )
    """)

    op.execute("""
    CREATE TABLE IF NOT EXISTS video_publications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
        social_account_id UUID REFERENCES social_accounts(id) ON DELETE SET NULL,
        platform TEXT NOT NULL CHECK (platform IN ('instagram', 'tiktok', 'youtube')),
        local_video_path TEXT,
        remote_video_url TEXT,
        title TEXT,
        description TEXT,
        tags TEXT[],
        platform_video_id TEXT,
        platform_url TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'uploading', 'processing', 'published', 'failed', 'scheduled')),
        scheduled_for TIMESTAMPTZ,
        error_message TEXT,
        metadata JSONB DEFAULT '{}',
        published_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
    )
    """)

    op.execute("""
    CREATE INDEX IF NOT EXISTS idx_social_accounts_project_platform
    ON social_accounts(project_id, platform)
    """)

    op.execute("""
    CREATE INDEX IF NOT EXISTS idx_video_publications_project_status
    ON video_publications(project_id, status)
    """)

    op.execute("""
    CREATE INDEX IF NOT EXISTS idx_video_publications_platform
    ON video_publications(platform, status)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS video_publications")
    op.execute("DROP TABLE IF EXISTS social_accounts")
