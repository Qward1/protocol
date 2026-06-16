"""Библиотека: список протоколов и транскриптов для выбора scope в Q&A."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Protocol, Segment, Task, Transcription
from app.schemas import LibraryResponse, ProtocolListItem, TranscriptionListItem

router = APIRouter(prefix="/api/library", tags=["library"])


def _task_counts(db: Session) -> dict[str, int]:
    rows = db.query(Task.protocol_id, func.count(Task.id)).group_by(Task.protocol_id).all()
    return {pid: cnt for pid, cnt in rows}


def _segment_counts(db: Session) -> dict[str, int]:
    rows = (
        db.query(Segment.transcription_id, func.count(Segment.id))
        .group_by(Segment.transcription_id)
        .all()
    )
    return {tid: cnt for tid, cnt in rows}


@router.get("", response_model=LibraryResponse)
def get_library(db: Session = Depends(get_db)):
    task_counts = _task_counts(db)
    seg_counts = _segment_counts(db)

    protocols = [
        ProtocolListItem(
            id=p.id,
            title=p.title,
            date=p.date,
            number=p.number,
            tasks_count=task_counts.get(p.id, 0),
            created_at=p.created_at,
        )
        for p in db.query(Protocol).order_by(Protocol.created_at.desc()).all()
    ]
    transcriptions = [
        TranscriptionListItem(
            id=t.id,
            filename=t.filename,
            media_kind=t.media_kind,
            status=t.status,
            duration=t.duration,
            segments_count=seg_counts.get(t.id, 0),
            created_at=t.created_at,
        )
        for t in db.query(Transcription).order_by(Transcription.created_at.desc()).all()
    ]
    return LibraryResponse(protocols=protocols, transcriptions=transcriptions)
