"""
Orquestra - SQLAlchemy Models
All tables: contacts, messages, recordings, projects, daily_briefs, memory_embeddings
IMPORTANT: Use CAST(:param AS uuid) syntax, NEVER ::uuid (asyncpg incompatibility)
"""

import uuid
from sqlalchemy import (
    Boolean,
    BigInteger,
    Column,
    Date,
    ForeignKey,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID, TIMESTAMP
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from pgvector.sqlalchemy import Vector

from app.database import Base


class Project(Base):
    __tablename__ = "projects"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String(20), server_default="active", nullable=False)
    color = Column(String(7), server_default="#3b82f6", nullable=False)
    keywords = Column(ARRAY(String), server_default="{}")
    created_at = Column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(
        TIMESTAMP(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relationships
    contacts = relationship("Contact", back_populates="project", lazy="selectin")
    messages = relationship("Message", back_populates="project", lazy="selectin")
    recordings = relationship("Recording", back_populates="project", lazy="selectin")

    def __repr__(self):
        return f"<Project {self.name}>"


class Contact(Base):
    __tablename__ = "contacts"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    phone = Column(String(20), unique=True, nullable=False)
    name = Column(String(255), nullable=True)
    push_name = Column(String(255), nullable=True)
    profile_pic_url = Column(Text, nullable=True)
    tags = Column(ARRAY(String), server_default="{}")
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="SET NULL"),
        nullable=True,
    )
    notes = Column(Text, nullable=True)
    is_group = Column(Boolean, server_default="false", nullable=False)
    ignored = Column(Boolean, server_default="false", nullable=False)
    created_at = Column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(
        TIMESTAMP(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relationships
    project = relationship("Project", back_populates="contacts")
    messages = relationship(
        "Message", back_populates="contact", lazy="selectin", cascade="all, delete-orphan"
    )

    def __repr__(self):
        return f"<Contact {self.phone}>"


class Message(Base):
    __tablename__ = "messages"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    contact_id = Column(
        UUID(as_uuid=True),
        ForeignKey("contacts.id", ondelete="CASCADE"),
        nullable=False,
    )
    remote_jid = Column(String(100), nullable=False)
    direction = Column(String(10), nullable=False)  # incoming / outgoing
    message_type = Column(
        String(20), nullable=False
    )  # text / audio / image / video / document / sticker
    content = Column(Text, nullable=True)
    transcription = Column(Text, nullable=True)
    media_url = Column(Text, nullable=True)
    media_local_path = Column(Text, nullable=True)
    media_mimetype = Column(String(100), nullable=True)
    media_duration_seconds = Column(Integer, nullable=True)
    quoted_message_id = Column(
        UUID(as_uuid=True),
        ForeignKey("messages.id", ondelete="SET NULL"),
        nullable=True,
    )
    evolution_message_id = Column(String(100), nullable=True)
    raw_payload = Column(JSONB, nullable=True)
    processed = Column(Boolean, server_default="false", nullable=False)
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="SET NULL"),
        nullable=True,
    )
    timestamp = Column(TIMESTAMP(timezone=True), nullable=False)
    created_at = Column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    contact = relationship("Contact", back_populates="messages")
    project = relationship("Project", back_populates="messages")
    quoted_message = relationship("Message", remote_side=[id], lazy="selectin")

    def __repr__(self):
        return f"<Message {self.direction} {self.message_type}>"


class Recording(Base):
    __tablename__ = "recordings"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    title = Column(String(500), nullable=True)
    source = Column(String(20), server_default="pwa", nullable=False)
    file_path = Column(Text, nullable=False)
    file_size_bytes = Column(BigInteger, nullable=True)
    duration_seconds = Column(Integer, nullable=True)
    transcription = Column(Text, nullable=True)
    summary = Column(Text, nullable=True)
    action_items = Column(JSONB, server_default="[]")
    decisions = Column(JSONB, server_default="[]")
    key_topics = Column(ARRAY(String), server_default="{}")
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="SET NULL"),
        nullable=True,
    )
    processed = Column(Boolean, server_default="false", nullable=False)
    recorded_at = Column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )
    created_at = Column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    project = relationship("Project", back_populates="recordings")

    def __repr__(self):
        return f"<Recording {self.title}>"


class MemoryEmbedding(Base):
    __tablename__ = "memory_embeddings"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    source_type = Column(String(20), nullable=False)  # 'message', 'recording', 'youtube'
    source_id = Column(UUID(as_uuid=True), nullable=True)
    content = Column(Text, nullable=False)
    summary = Column(Text, nullable=True)
    embedding = Column(Vector(1536), nullable=True)
    metadata_ = Column("metadata", JSONB, server_default="{}")
    contact_name = Column(String(255), nullable=True)
    project_name = Column(String(255), nullable=True)
    created_at = Column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )

    def __repr__(self):
        return f"<MemoryEmbedding {self.source_type} {self.id}>"


class DailyBrief(Base):
    __tablename__ = "daily_briefs"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    date = Column(Date, unique=True, nullable=False)
    period_start = Column(TIMESTAMP(timezone=True), nullable=False)
    period_end = Column(TIMESTAMP(timezone=True), nullable=False)
    total_messages = Column(Integer, server_default="0", nullable=False)
    total_recordings = Column(Integer, server_default="0", nullable=False)
    summary = Column(Text, nullable=False)
    pending_actions = Column(JSONB, server_default="[]")
    decisions_made = Column(JSONB, server_default="[]")
    key_insights = Column(JSONB, server_default="[]")
    projects_mentioned = Column(ARRAY(String), server_default="{}")
    raw_context = Column(Text, nullable=True)
    model_used = Column(String(100), nullable=True)
    sent_telegram = Column(Boolean, server_default="false", nullable=False)
    sent_whatsapp = Column(Boolean, server_default="false", nullable=False)
    generated_at = Column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )

    def __repr__(self):
        return f"<DailyBrief {self.date}>"
