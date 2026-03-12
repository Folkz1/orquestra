"""Playbook CTO Virtual - Educational Platform

Revision ID: 019_playbook_platform
Revises: 018_whatsapp_pwa_chat
Create Date: 2026-03-12
"""

from alembic import op

revision = "019_playbook_platform"
down_revision = "018_whatsapp_pwa_chat"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    CREATE TABLE IF NOT EXISTS playbook_modules (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        slug TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro')),
        icon TEXT DEFAULT '📘',
        order_num INTEGER NOT NULL DEFAULT 0,
        is_published BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
    )
    """)

    op.execute("""
    CREATE TABLE IF NOT EXISTS playbook_steps (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        module_id UUID NOT NULL REFERENCES playbook_modules(id) ON DELETE CASCADE,
        slug TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        step_type TEXT NOT NULL DEFAULT 'theory' CHECK (step_type IN ('theory', 'practice', 'code', 'quiz')),
        order_num INTEGER NOT NULL DEFAULT 0,
        duration_min INTEGER DEFAULT 5,
        code_snippet TEXT,
        is_published BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(module_id, slug)
    )
    """)

    op.execute("""
    CREATE TABLE IF NOT EXISTS playbook_enrollments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        phone TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        email TEXT,
        tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro')),
        is_active BOOLEAN DEFAULT true,
        enrolled_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ,
        payment_method TEXT,
        notes TEXT
    )
    """)

    op.execute("""
    CREATE TABLE IF NOT EXISTS playbook_progress (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        enrollment_id UUID NOT NULL REFERENCES playbook_enrollments(id) ON DELETE CASCADE,
        step_id UUID NOT NULL REFERENCES playbook_steps(id) ON DELETE CASCADE,
        completed_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(enrollment_id, step_id)
    )
    """)

    op.execute("CREATE INDEX IF NOT EXISTS idx_playbook_steps_module ON playbook_steps(module_id, order_num)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_playbook_progress_enrollment ON playbook_progress(enrollment_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_playbook_enrollments_phone ON playbook_enrollments(phone)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS playbook_progress")
    op.execute("DROP TABLE IF EXISTS playbook_enrollments")
    op.execute("DROP TABLE IF EXISTS playbook_steps")
    op.execute("DROP TABLE IF EXISTS playbook_modules")
