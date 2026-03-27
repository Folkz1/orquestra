"""Blog Posts para GuyFolkz — experimentos, artigos, posts por video

Revision ID: 023_blog_posts
Revises: 022_newsletter
Create Date: 2026-03-27
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB, TIMESTAMP, ARRAY

revision = "023_blog_posts"
down_revision = "022_newsletter"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "blog_posts",
        sa.Column("id", UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("slug", sa.String(300), nullable=False, unique=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("subtitle", sa.String(500), nullable=True),
        sa.Column("content_md", sa.Text, nullable=False),
        sa.Column("cover_image_url", sa.Text, nullable=True),
        sa.Column("youtube_video_id", sa.String(50), nullable=True),
        sa.Column("video_type", sa.String(20), server_default="short"),  # short | long | radar-ia
        sa.Column("tags", ARRAY(sa.String), server_default="{}"),
        sa.Column("status", sa.String(20), server_default="published"),  # draft | published
        sa.Column("views", sa.Integer, server_default="0"),
        sa.Column("reading_time_min", sa.Integer, server_default="3"),
        sa.Column("created_at", TIMESTAMP(timezone=True), server_default=sa.func.now()),
        sa.Column("published_at", TIMESTAMP(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_blog_posts_slug", "blog_posts", ["slug"], unique=True)
    op.create_index("ix_blog_posts_status", "blog_posts", ["status"])
    op.create_index("ix_blog_posts_published_at", "blog_posts", ["published_at"])


def downgrade() -> None:
    op.drop_table("blog_posts")
