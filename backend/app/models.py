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
    credentials = Column(JSONB, server_default="{}", nullable=False)
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
    tasks = relationship("ProjectTask", back_populates="project", lazy="selectin")

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
    pipeline_stage = Column(String(30), server_default="lead", nullable=False)
    company = Column(String(255), nullable=True)
    email = Column(String(255), nullable=True)
    engagement_score = Column(Integer, server_default="0", nullable=False)
    unread_count = Column(Integer, server_default="0", nullable=False)
    last_message_preview = Column(Text, nullable=True)
    last_message_at = Column(TIMESTAMP(timezone=True), nullable=True)
    last_contacted_at = Column(TIMESTAMP(timezone=True), nullable=True)
    next_action = Column(Text, nullable=True)
    next_action_date = Column(Date, nullable=True)
    monthly_revenue = Column(String(50), nullable=True)
    total_revenue = Column(String(50), nullable=True)
    acquired_at = Column(TIMESTAMP(timezone=True), nullable=True)
    support_ends_at = Column(TIMESTAMP(timezone=True), nullable=True)
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
    delivery_reports = relationship("DeliveryReport", back_populates="contact", lazy="selectin")

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


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    endpoint = Column(Text, nullable=False, unique=True)
    p256dh = Column(Text, nullable=False)
    auth = Column(Text, nullable=False)
    user_agent = Column(Text, nullable=True)
    created_at = Column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(
        TIMESTAMP(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    last_seen_at = Column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )

    def __repr__(self):
        return f"<PushSubscription {self.id}>"


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


class ProjectTask(Base):
    __tablename__ = "project_tasks"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=True,
    )
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String(20), server_default="backlog", nullable=False)
    priority = Column(String(10), server_default="medium", nullable=False)
    source = Column(String(20), server_default="manual", nullable=False)
    assigned_to = Column(String(20), server_default="claude", nullable=False)
    metadata_json = Column(JSONB, server_default="{}", nullable=False)
    completed_at = Column(TIMESTAMP(timezone=True), nullable=True)
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
    project = relationship("Project", back_populates="tasks")

    def __repr__(self):
        return f"<ProjectTask {self.title[:30]}>"


class Proposal(Base):
    __tablename__ = "proposals"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    slug = Column(String(255), unique=True, nullable=False)
    title = Column(String(500), nullable=False)
    client_name = Column(String(255), nullable=False)
    client_phone = Column(String(20), nullable=True)
    contact_id = Column(
        UUID(as_uuid=True),
        ForeignKey("contacts.id", ondelete="SET NULL"),
        nullable=True,
    )
    content = Column(Text, nullable=False)
    status = Column(String(20), server_default="draft", nullable=False)  # draft/sent/viewed/accepted/rejected
    total_value = Column(String(50), nullable=True)
    metadata_json = Column(JSONB, server_default="{}", nullable=False)
    viewed_at = Column(TIMESTAMP(timezone=True), nullable=True)
    accepted_at = Column(TIMESTAMP(timezone=True), nullable=True)
    created_at = Column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(
        TIMESTAMP(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    comments = relationship("ProposalComment", back_populates="proposal", lazy="selectin", cascade="all, delete-orphan")
    contact = relationship("Contact", lazy="selectin")
    delivery_report = relationship(
        "DeliveryReport",
        back_populates="proposal",
        lazy="selectin",
        uselist=False,
        cascade="all, delete-orphan",
    )

    def __repr__(self):
        return f"<Proposal {self.slug}>"


class ProposalComment(Base):
    __tablename__ = "proposal_comments"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    proposal_id = Column(
        UUID(as_uuid=True),
        ForeignKey("proposals.id", ondelete="CASCADE"),
        nullable=False,
    )
    author_name = Column(String(255), nullable=False)
    content = Column(Text, nullable=False)
    highlighted_text = Column(Text, nullable=True)
    created_at = Column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )

    proposal = relationship("Proposal", back_populates="comments")

    def __repr__(self):
        return f"<ProposalComment {self.author_name}>"


class ScheduledMessage(Base):
    __tablename__ = "scheduled_messages"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    phone = Column(String(20), nullable=False)
    message_text = Column(Text, nullable=False)
    scheduled_for = Column(TIMESTAMP(timezone=True), nullable=False)
    status = Column(String(20), server_default="pending", nullable=False)  # pending/sent/failed/cancelled
    error_message = Column(Text, nullable=True)
    evolution_instance = Column(String(100), nullable=True)
    contact_id = Column(
        UUID(as_uuid=True),
        ForeignKey("contacts.id", ondelete="SET NULL"),
        nullable=True,
    )
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="SET NULL"),
        nullable=True,
    )
    metadata_json = Column(JSONB, server_default="{}", nullable=False)
    sent_at = Column(TIMESTAMP(timezone=True), nullable=True)
    created_at = Column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(
        TIMESTAMP(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    contact = relationship("Contact", lazy="selectin")
    project = relationship("Project", lazy="selectin")

    def __repr__(self):
        return f"<ScheduledMessage {self.phone} {self.status} {self.scheduled_for}>"


class AssistantDraft(Base):
    __tablename__ = "assistant_drafts"

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
    based_on_message_id = Column(
        UUID(as_uuid=True),
        ForeignKey("messages.id", ondelete="SET NULL"),
        nullable=True,
    )
    objective = Column(Text, nullable=True)
    draft_text = Column(Text, nullable=False)
    status = Column(String(20), server_default="generated", nullable=False)  # generated/sent/discarded
    metadata_json = Column(JSONB, server_default="{}", nullable=False)
    sent_at = Column(TIMESTAMP(timezone=True), nullable=True)
    created_at = Column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(
        TIMESTAMP(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    contact = relationship("Contact", lazy="selectin")
    based_on_message = relationship("Message", lazy="selectin")

    def __repr__(self):
        return f"<AssistantDraft {self.id} {self.status}>"


class ProposalEvent(Base):
    __tablename__ = "proposal_events"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    proposal_id = Column(
        UUID(as_uuid=True),
        ForeignKey("proposals.id", ondelete="CASCADE"),
        nullable=False,
    )
    contact_id = Column(
        UUID(as_uuid=True),
        ForeignKey("contacts.id", ondelete="SET NULL"),
        nullable=True,
    )
    session_id = Column(String(100), nullable=False)
    event_type = Column(String(30), nullable=False)
    event_data = Column(JSONB, server_default="{}", nullable=False)
    ip_address = Column(String(45), nullable=True)
    user_agent = Column(Text, nullable=True)
    created_at = Column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )

    proposal = relationship("Proposal", lazy="selectin")

    def __repr__(self):
        return f"<ProposalEvent {self.event_type} {self.proposal_id}>"


class DeliveryReport(Base):
    __tablename__ = "delivery_reports"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    proposal_id = Column(
        UUID(as_uuid=True),
        ForeignKey("proposals.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    contact_id = Column(
        UUID(as_uuid=True),
        ForeignKey("contacts.id", ondelete="SET NULL"),
        nullable=True,
    )
    proposed_scope = Column(JSONB, server_default="[]", nullable=False)
    delivered_scope = Column(JSONB, server_default="[]", nullable=False)
    extras = Column(JSONB, server_default="[]", nullable=False)
    financial_summary = Column(JSONB, server_default="{}", nullable=False)
    comparison_analysis = Column(Text, nullable=True)
    status = Column(String(20), server_default="draft", nullable=False)
    generated_at = Column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )
    created_at = Column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(
        TIMESTAMP(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    proposal = relationship("Proposal", back_populates="delivery_report", lazy="selectin")
    contact = relationship("Contact", back_populates="delivery_reports", lazy="selectin")

    def __repr__(self):
        return f"<DeliveryReport {self.proposal_id} {self.status}>"


class CredentialLink(Base):
    __tablename__ = "credential_links"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    token = Column(String(64), unique=True, nullable=False)
    client_name = Column(String(255), nullable=False)
    fields = Column(JSONB, server_default="[]", nullable=False)
    submitted_at = Column(TIMESTAMP(timezone=True), nullable=True)
    expires_at = Column(TIMESTAMP(timezone=True), nullable=True)
    created_at = Column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )

    project = relationship("Project", lazy="selectin")
    credentials = relationship("ClientCredential", back_populates="link", lazy="selectin", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<CredentialLink {self.client_name} {self.token[:8]}>"


class ClientCredential(Base):
    __tablename__ = "client_credentials"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    link_id = Column(
        UUID(as_uuid=True),
        ForeignKey("credential_links.id", ondelete="CASCADE"),
        nullable=False,
    )
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    field_name = Column(String(255), nullable=False)
    field_label = Column(String(255), nullable=False)
    encrypted_value = Column(Text, nullable=False)
    created_at = Column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )

    link = relationship("CredentialLink", back_populates="credentials")

    def __repr__(self):
        return f"<ClientCredential {self.field_name}>"


class ClientPortalLink(Base):
    __tablename__ = "client_portal_links"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    contact_id = Column(
        UUID(as_uuid=True),
        ForeignKey("contacts.id", ondelete="SET NULL"),
        nullable=True,
    )
    token = Column(String(64), unique=True, nullable=False)
    client_name = Column(String(255), nullable=False)
    visible_sections = Column(
        JSONB,
        server_default='["tasks","timeline","proposals","recordings"]',
        nullable=False,
    )
    welcome_message = Column(Text, nullable=True)
    feedback_status = Column(String(20), server_default="idle", nullable=False)
    feedback_type = Column(String(20), server_default="feedback", nullable=False)
    feedback_title = Column(String(255), nullable=True)
    feedback_message = Column(Text, nullable=True)
    feedback_requested_at = Column(TIMESTAMP(timezone=True), nullable=True)
    feedback_sent_at = Column(TIMESTAMP(timezone=True), nullable=True)
    feedback_completed_at = Column(TIMESTAMP(timezone=True), nullable=True)
    is_active = Column(Boolean, server_default="true", nullable=False)
    last_viewed_at = Column(TIMESTAMP(timezone=True), nullable=True)
    view_count = Column(Integer, server_default="0", nullable=False)
    expires_at = Column(TIMESTAMP(timezone=True), nullable=True)
    created_at = Column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(
        TIMESTAMP(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    project = relationship("Project", lazy="selectin")
    contact = relationship("Contact", lazy="selectin")


class Subscription(Base):
    __tablename__ = "subscriptions"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    contact_id = Column(
        UUID(as_uuid=True),
        ForeignKey("contacts.id", ondelete="SET NULL"),
        nullable=True,
    )
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="SET NULL"),
        nullable=True,
    )
    client_name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    amount_cents = Column(Integer, nullable=False)
    currency = Column(String(10), server_default="BRL", nullable=False)
    billing_day = Column(Integer, server_default="1", nullable=False)
    status = Column(String(20), server_default="active", nullable=False)
    evolution_instance = Column(String(100), server_default="guyfolkiz", nullable=True)
    alert_phone = Column(String(30), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(
        TIMESTAMP(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    contact = relationship("Contact", lazy="selectin")
    project = relationship("Project", lazy="selectin")
    payments = relationship(
        "SubscriptionPayment", back_populates="subscription",
        lazy="selectin", cascade="all, delete-orphan"
    )


class SubscriptionPayment(Base):
    __tablename__ = "subscription_payments"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    subscription_id = Column(
        UUID(as_uuid=True),
        ForeignKey("subscriptions.id", ondelete="CASCADE"),
        nullable=False,
    )
    reference_month = Column(String(7), nullable=False)  # YYYY-MM
    amount_cents = Column(Integer, nullable=False)
    status = Column(String(20), server_default="pending", nullable=False)
    paid_at = Column(TIMESTAMP(timezone=True), nullable=True)
    payment_method = Column(String(50), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(
        TIMESTAMP(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(
        TIMESTAMP(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    subscription = relationship("Subscription", back_populates="payments")

    def __repr__(self):
        return f"<ClientPortalLink {self.client_name} {self.token[:8]}>"
