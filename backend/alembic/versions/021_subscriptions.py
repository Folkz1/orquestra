"""Subscriptions - controle de assinaturas mensais de clientes

Revision ID: 021_subscriptions
Revises: 020_social_publishing
Create Date: 2026-03-17
"""

from alembic import op

revision = "021_subscriptions"
down_revision = "020_social_publishing"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    CREATE TABLE IF NOT EXISTS subscriptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
        project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
        client_name TEXT NOT NULL,
        description TEXT,
        amount_cents INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'BRL',
        billing_day INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'active'
            CHECK (status IN ('active', 'paused', 'cancelled')),
        evolution_instance TEXT DEFAULT 'guyfolkiz',
        alert_phone TEXT,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS subscription_payments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
        reference_month TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'paid', 'overdue')),
        paid_at TIMESTAMPTZ,
        payment_method TEXT,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(subscription_id, reference_month)
    );

    CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_contact ON subscriptions(contact_id);
    CREATE INDEX IF NOT EXISTS idx_sub_payments_sub ON subscription_payments(subscription_id);
    CREATE INDEX IF NOT EXISTS idx_sub_payments_month ON subscription_payments(reference_month);
    CREATE INDEX IF NOT EXISTS idx_sub_payments_status ON subscription_payments(status);
    """)


def downgrade() -> None:
    op.execute("""
    DROP TABLE IF EXISTS subscription_payments;
    DROP TABLE IF EXISTS subscriptions;
    """)
