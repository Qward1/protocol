"""Семантический поиск по всем встречам (историческая память через Dify Dataset)."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Transcription
from app.schemas import SearchHit, SearchRequest, SearchResponse
from app.security import require_permission
from app.services import dify_client

router = APIRouter(prefix="/api/search", tags=["search"])


@router.post("", response_model=SearchResponse, dependencies=[Depends(require_permission("qa.use", "library.view"))])
async def search(req: SearchRequest, db: Session = Depends(get_db)):
    records = await dify_client.retrieve(req.query, req.top_k)
    hits: list[SearchHit] = []

    if records:
        for rec in records:
            seg = rec.get("segment", {}) if isinstance(rec, dict) else {}
            meta = seg.get("document", {}).get("doc_metadata", {}) if isinstance(seg, dict) else {}
            hits.append(SearchHit(
                transcription_id=meta.get("meeting_id"),
                title=meta.get("filename", ""),
                fragment=seg.get("content", "")[:600],
                score=float(rec.get("score", 0.0)),
            ))
        return SearchResponse(hits=hits)

    # Фоллбэк без Dify: простой полнотекстовый поиск по локальным транскриптам.
    needle = req.query.lower()
    for t in db.query(Transcription).filter(Transcription.status == "done").all():
        idx = t.full_text.lower().find(needle)
        if idx >= 0:
            hits.append(SearchHit(
                transcription_id=t.id, title=t.filename,
                fragment=t.full_text[max(0, idx - 80): idx + 320], score=0.5,
            ))
    return SearchResponse(hits=hits[: req.top_k])
