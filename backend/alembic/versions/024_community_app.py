"""Community App — Posts, comments, likes, resources (Skool-style)

Revision ID: 024_community_app
Revises: 023_blog_posts
Create Date: 2026-03-27
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, TIMESTAMP

revision = "024_community_app"
down_revision = "023_blog_posts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "community_posts",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("author_enrollment_id", UUID(as_uuid=True), sa.ForeignKey("playbook_enrollments.id", ondelete="SET NULL"), nullable=True),
        sa.Column("author_name", sa.String(200), nullable=False),
        sa.Column("author_role", sa.String(50), server_default="member", nullable=False),
        sa.Column("content_md", sa.Text, nullable=False),
        sa.Column("post_type", sa.String(50), server_default="discussion", nullable=False),
        sa.Column("likes_count", sa.Integer, server_default="0", nullable=False),
        sa.Column("comments_count", sa.Integer, server_default="0", nullable=False),
        sa.Column("pinned", sa.Boolean, server_default="false", nullable=False),
        sa.Column("created_at", TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "community_comments",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("post_id", UUID(as_uuid=True), sa.ForeignKey("community_posts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("author_enrollment_id", UUID(as_uuid=True), nullable=True),
        sa.Column("author_name", sa.String(200), nullable=False),
        sa.Column("content_md", sa.Text, nullable=False),
        sa.Column("likes_count", sa.Integer, server_default="0", nullable=False),
        sa.Column("created_at", TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "community_likes",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("enrollment_id", UUID(as_uuid=True), nullable=False),
        sa.Column("post_id", UUID(as_uuid=True), nullable=True),
        sa.Column("comment_id", UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("enrollment_id", "post_id", name="uq_community_likes_enrollment_post"),
        sa.UniqueConstraint("enrollment_id", "comment_id", name="uq_community_likes_enrollment_comment"),
    )

    op.create_table(
        "community_resources",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("resource_type", sa.String(50), nullable=True),
        sa.Column("download_url", sa.Text, nullable=True),
        sa.Column("tier", sa.String(20), server_default="pro", nullable=False),
        sa.Column("downloads_count", sa.Integer, server_default="0", nullable=False),
        sa.Column("created_at", TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # Indexes for common queries
    op.create_index("ix_community_posts_created_at", "community_posts", ["created_at"])
    op.create_index("ix_community_comments_post_id", "community_comments", ["post_id"])
    op.create_index("ix_community_likes_post_id", "community_likes", ["post_id"])
    op.create_index("ix_community_likes_comment_id", "community_likes", ["comment_id"])


def downgrade() -> None:
    op.drop_index("ix_community_likes_comment_id", table_name="community_likes")
    op.drop_index("ix_community_likes_post_id", table_name="community_likes")
    op.drop_index("ix_community_comments_post_id", table_name="community_comments")
    op.drop_index("ix_community_posts_created_at", table_name="community_posts")
    op.drop_table("community_resources")
    op.drop_table("community_likes")
    op.drop_table("community_comments")
    op.drop_table("community_posts")
