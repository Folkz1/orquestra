"""
Orquestra - Pydantic v2 Schemas
Request/Response models for all endpoints.
"""

from datetime import date, datetime
from typing import Any, Generic, Optional, TypeVar
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# ─── Generic Paginated Response ───────────────────────────────────────────

T = TypeVar("T")


class PaginatedResponse(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int
    total_pages: int


# ─── Contact Schemas ──────────────────────────────────────────────────────


class ContactBase(BaseModel):
    phone: str = Field(..., max_length=20)
    name: Optional[str] = Field(None, max_length=255)
    push_name: Optional[str] = Field(None, max_length=255)
    profile_pic_url: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    project_id: Optional[UUID] = None
    notes: Optional[str] = None
    is_group: bool = False


class ContactCreate(ContactBase):
    pass


class ContactUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=255)
    push_name: Optional[str] = Field(None, max_length=255)
    profile_pic_url: Optional[str] = None
    tags: Optional[list[str]] = None
    project_id: Optional[UUID] = None
    notes: Optional[str] = None
    is_group: Optional[bool] = None


class ContactResponse(ContactBase):
    id: UUID
    created_at: datetime
    updated_at: datetime
    message_count: int = 0
    last_message_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


# ─── Message Schemas ──────────────────────────────────────────────────────


class MessageBase(BaseModel):
    contact_id: UUID
    remote_jid: str = Field(..., max_length=100)
    direction: str = Field(..., max_length=10)
    message_type: str = Field(..., max_length=20)
    content: Optional[str] = None
    transcription: Optional[str] = None
    media_url: Optional[str] = None
    media_local_path: Optional[str] = None
    media_mimetype: Optional[str] = Field(None, max_length=100)
    media_duration_seconds: Optional[int] = None
    quoted_message_id: Optional[UUID] = None
    evolution_message_id: Optional[str] = Field(None, max_length=100)
    raw_payload: Optional[dict[str, Any]] = None
    processed: bool = False
    project_id: Optional[UUID] = None
    timestamp: datetime


class MessageResponse(MessageBase):
    id: UUID
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ─── Recording Schemas ────────────────────────────────────────────────────


class RecordingBase(BaseModel):
    title: Optional[str] = Field(None, max_length=500)
    source: str = Field(default="pwa", max_length=20)
    file_path: str
    file_size_bytes: Optional[int] = None
    duration_seconds: Optional[int] = None
    project_id: Optional[UUID] = None


class RecordingCreate(RecordingBase):
    pass


class RecordingResponse(RecordingBase):
    id: UUID
    transcription: Optional[str] = None
    summary: Optional[str] = None
    action_items: list[dict[str, Any]] = Field(default_factory=list)
    decisions: list[dict[str, Any]] = Field(default_factory=list)
    key_topics: list[str] = Field(default_factory=list)
    processed: bool = False
    recorded_at: datetime
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ─── Project Schemas ──────────────────────────────────────────────────────


class ProjectBase(BaseModel):
    name: str = Field(..., max_length=255)
    description: Optional[str] = None
    status: str = Field(default="active", max_length=20)
    color: str = Field(default="#3b82f6", max_length=7)
    keywords: list[str] = Field(default_factory=list)


class ProjectCreate(ProjectBase):
    pass


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    status: Optional[str] = Field(None, max_length=20)
    color: Optional[str] = Field(None, max_length=7)
    keywords: Optional[list[str]] = None


class ProjectStats(BaseModel):
    total_messages: int = 0
    total_recordings: int = 0
    last_activity: Optional[datetime] = None


class ProjectResponse(ProjectBase):
    id: UUID
    created_at: datetime
    updated_at: datetime
    stats: ProjectStats = Field(default_factory=ProjectStats)

    model_config = ConfigDict(from_attributes=True)


# ─── Daily Brief Schemas ──────────────────────────────────────────────────


class DailyBriefResponse(BaseModel):
    id: UUID
    date: date
    period_start: datetime
    period_end: datetime
    total_messages: int
    total_recordings: int
    summary: str
    pending_actions: list[dict[str, Any]] = Field(default_factory=list)
    decisions_made: list[dict[str, Any]] = Field(default_factory=list)
    key_insights: list[dict[str, Any]] = Field(default_factory=list)
    projects_mentioned: list[str] = Field(default_factory=list)
    raw_context: Optional[str] = None
    model_used: Optional[str] = None
    sent_telegram: bool = False
    sent_whatsapp: bool = False
    generated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class BriefGenerateRequest(BaseModel):
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None
    send_telegram: bool = True
