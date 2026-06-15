"""Библиотека: список протоколов и транскриптов для выбора scope в Q&A."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Protocol, Transcription
from app.schemas import LibraryResponse

router = APIRouter(prefix="/api/library", tags=["library"])


@router.get("", response_model=LibraryResponse)
def get_library(db: Session = Depends(get_db)):
    return LibraryResponse(
        protocols=db.query(Protocol).order_by(Protocol.created_at.desc()).all(),
        transcriptions=db.query(Transcription).order_by(Transcription.created_at.desc()).all(),
    )
