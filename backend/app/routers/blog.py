"""
Blog Posts — GuyFolkz experimentos e artigos por video
GET /api/blog          - listar posts (autenticado)
GET /api/blog/public   - listar posts publicos (sem auth, para site externo)
GET /api/blog/{slug}   - detalhe do post
POST /api/blog         - criar post
PATCH /api/blog/{slug} - atualizar post
DELETE /api/blog/{slug}- deletar post
POST /api/blog/{slug}/view - incrementar views
"""

import re
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, update, delete, func
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.database import get_db
from app.models import BlogPost

router = APIRouter()


def slugify(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[àáâãä]", "a", text)
    text = re.sub(r"[èéêë]", "e", text)
    text = re.sub(r"[ìíîï]", "i", text)
    text = re.sub(r"[òóôõö]", "o", text)
    text = re.sub(r"[ùúûü]", "u", text)
    text = re.sub(r"[ç]", "c", text)
    text = re.sub(r"[ñ]", "n", text)
    text = re.sub(r"[^a-z0-9\s-]", "", text)
    text = re.sub(r"\s+", "-", text.strip())
    text = re.sub(r"-+", "-", text)
    return text[:280]


class BlogPostCreate(BaseModel):
    title: str
    subtitle: Optional[str] = None
    content_md: str
    cover_image_url: Optional[str] = None
    youtube_video_id: Optional[str] = None
    video_type: str = "short"
    tags: list[str] = []
    status: str = "published"
    reading_time_min: int = 3
    slug: Optional[str] = None


class BlogPostUpdate(BaseModel):
    title: Optional[str] = None
    subtitle: Optional[str] = None
    content_md: Optional[str] = None
    cover_image_url: Optional[str] = None
    youtube_video_id: Optional[str] = None
    video_type: Optional[str] = None
    tags: Optional[list[str]] = None
    status: Optional[str] = None
    reading_time_min: Optional[int] = None


def post_to_dict(p: BlogPost) -> dict:
    return {
        "id": str(p.id),
        "slug": p.slug,
        "title": p.title,
        "subtitle": p.subtitle,
        "content_md": p.content_md,
        "cover_image_url": p.cover_image_url,
        "youtube_video_id": p.youtube_video_id,
        "video_type": p.video_type,
        "tags": p.tags or [],
        "status": p.status,
        "views": p.views,
        "reading_time_min": p.reading_time_min,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "published_at": p.published_at.isoformat() if p.published_at else None,
    }


@router.get("/public")
async def list_public_posts(
    limit: int = Query(20, le=100),
    offset: int = Query(0),
    tag: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """Endpoint publico — sem autenticacao. Para uso no site externo."""
    q = select(BlogPost).where(BlogPost.status == "published").order_by(BlogPost.published_at.desc())
    if tag:
        q = q.where(BlogPost.tags.any(tag))
    q = q.offset(offset).limit(limit)
    result = await db.execute(q)
    posts = result.scalars().all()
    count_q = select(func.count()).select_from(BlogPost).where(BlogPost.status == "published")
    total = (await db.execute(count_q)).scalar()
    return {"total": total, "posts": [post_to_dict(p) for p in posts]}


@router.get("")
async def list_posts(
    limit: int = Query(50, le=200),
    offset: int = Query(0),
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    q = select(BlogPost).order_by(BlogPost.published_at.desc())
    if status:
        q = q.where(BlogPost.status == status)
    q = q.offset(offset).limit(limit)
    result = await db.execute(q)
    posts = result.scalars().all()
    count_q = select(func.count()).select_from(BlogPost)
    if status:
        count_q = count_q.where(BlogPost.status == status)
    total = (await db.execute(count_q)).scalar()
    return {"total": total, "posts": [post_to_dict(p) for p in posts]}


@router.get("/{slug}")
async def get_post(slug: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(BlogPost).where(BlogPost.slug == slug))
    post = result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="Post nao encontrado")
    return post_to_dict(post)


@router.post("")
async def create_post(data: BlogPostCreate, db: AsyncSession = Depends(get_db)):
    slug = data.slug or slugify(data.title)
    # Garantir unicidade do slug
    exists = (await db.execute(select(BlogPost).where(BlogPost.slug == slug))).scalar_one_or_none()
    if exists:
        slug = f"{slug}-2"
    post = BlogPost(
        slug=slug,
        title=data.title,
        subtitle=data.subtitle,
        content_md=data.content_md,
        cover_image_url=data.cover_image_url,
        youtube_video_id=data.youtube_video_id,
        video_type=data.video_type,
        tags=data.tags,
        status=data.status,
        reading_time_min=data.reading_time_min,
    )
    db.add(post)
    await db.commit()
    await db.refresh(post)
    return post_to_dict(post)


@router.patch("/{slug}")
async def update_post(slug: str, data: BlogPostUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(BlogPost).where(BlogPost.slug == slug))
    post = result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="Post nao encontrado")
    updates = {k: v for k, v in data.model_dump().items() if v is not None}
    for key, val in updates.items():
        setattr(post, key, val)
    await db.commit()
    await db.refresh(post)
    return post_to_dict(post)


@router.delete("/{slug}")
async def delete_post(slug: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(BlogPost).where(BlogPost.slug == slug))
    post = result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="Post nao encontrado")
    await db.delete(post)
    await db.commit()
    return {"ok": True}


@router.post("/{slug}/view")
async def increment_view(slug: str, db: AsyncSession = Depends(get_db)):
    await db.execute(
        update(BlogPost).where(BlogPost.slug == slug).values(views=BlogPost.views + 1)
    )
    await db.commit()
    return {"ok": True}
