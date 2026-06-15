"""Загрузка медиа, запуск ASR (фон), статус, сегменты, стрим медиа, CRUD."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.db import SessionLocal, get_db
from app.logging_config import get_logger
from app.models import Segment, Transcription
from app.schemas import SegmentUpdate, TranscriptionDTO, TranscriptionListItem
from app.services import media, openrouter_asr, storage, dify_client

router = APIRouter(prefix="/api/transcriptions", tags=["transcriptions"])
log = get_logger("transcriptions")

_CHUNK = 1 << 20  # 1 МБ


def _build_full_text(segments) -> str:
    return "\n".join(
        f"[{int(s.start)//60:02d}:{int(s.start)%60:02d}] "
        f"{(s.speaker + ': ') if s.speaker else ''}{s.text}"
        for s in segments
    )


async def _run_asr_job(transcription_id: str) -> None:
    """Фоновая задача: транскрибация + сохранение сегментов + занос в БЗ Dify."""
    db: Session = SessionLocal()
    try:
        t = db.get(Transcription, transcription_id)
        if not t:
            return
        t.status = "processing"
        t.error = ""
        db.commit()

        segments = await openrouter_asr.transcribe_file(t.media_path)

        for seg in segments:
            db.add(Segment(
                transcription_id=t.id, start=seg.start, end=seg.end,
                speaker=seg.speaker, text=seg.text,
            ))
        t.full_text = _build_full_text(segments)
        t.duration = media.probe_duration(t.media_path)
        t.status = "done"
        db.commit()
        log.info("ASR done: %s (%d сегментов)", t.filename, len(segments))

        # Историческая память: заносим транскрипт в датасет Dify (если настроен).
        await dify_client.add_transcript_document(
            title=t.filename,
            text=t.full_text,
            metadata={"meeting_id": t.id, "filename": t.filename},
        )
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        t = db.get(Transcription, transcription_id)
        if t:
            t.status = "error"
            t.error = str(exc)
            db.commit()
        log.warning("ASR failed for %s: %s", transcription_id, exc)
    finally:
        db.close()


def _validate_upload(filename: str) -> None:
    ext = Path(filename).suffix.lower()
    allowed = [e.lower() for e in settings.upload.allowed_extensions]
    if ext not in allowed:
        raise HTTPException(415, f"Недопустимый тип файла: {ext or '—'}")


async def _stream_to_disk(file: UploadFile, dst: Path) -> int:
    """Потоковая запись с контролем размера. Возвращает число байт."""
    limit = settings.upload.max_mb * 1024 * 1024
    written = 0
    with dst.open("wb") as out:
        while chunk := await file.read(_CHUNK):
            written += len(chunk)
            if written > limit:
                out.close()
                dst.unlink(missing_ok=True)
                raise HTTPException(413, f"Файл больше лимита {settings.upload.max_mb} МБ")
            out.write(chunk)
    return written


@router.post("", response_model=TranscriptionDTO)
async def create_transcription(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    filename = file.filename or "upload"
    _validate_upload(filename)

    kind = "video" if media.is_video(filename) else "audio"
    t = Transcription(filename=filename, media_kind=kind, status="pending")
    db.add(t)
    db.commit()
    db.refresh(t)

    dst = storage.media_path(t.id, filename)
    await _stream_to_disk(file, dst)
    t.media_path = str(dst)
    db.commit()
    db.refresh(t)

    background.add_task(_run_asr_job, t.id)
    return t


@router.get("", response_model=list[TranscriptionListItem])
def list_transcriptions(db: Session = Depends(get_db)):
    return db.query(Transcription).order_by(Transcription.created_at.desc()).all()


@router.get("/{transcription_id}", response_model=TranscriptionDTO)
def get_transcription(transcription_id: str, db: Session = Depends(get_db)):
    t = db.get(Transcription, transcription_id)
    if not t:
        raise HTTPException(404, "Transcription not found")
    return t


@router.get("/{transcription_id}/media")
def stream_media(transcription_id: str, db: Session = Depends(get_db)):
    t = db.get(Transcription, transcription_id)
    if not t or not t.media_path or not Path(t.media_path).is_file():
        raise HTTPException(404, "Media not found")
    return FileResponse(t.media_path, filename=t.filename)


@router.post("/{transcription_id}/retry", response_model=TranscriptionDTO)
def retry_transcription(
    transcription_id: str, background: BackgroundTasks, db: Session = Depends(get_db)
):
    """Перезапустить распознавание (например, после ошибки)."""
    t = db.get(Transcription, transcription_id)
    if not t:
        raise HTTPException(404, "Transcription not found")
    db.query(Segment).filter(Segment.transcription_id == t.id).delete()
    t.status = "pending"
    t.error = ""
    db.commit()
    db.refresh(t)
    background.add_task(_run_asr_job, t.id)
    return t


@router.put("/{transcription_id}/segments", response_model=TranscriptionDTO)
def update_segments(transcription_id: str, body: SegmentUpdate, db: Session = Depends(get_db)):
    """Ручная правка сегментов (текст/спикеры) — заменяет весь список."""
    t = db.get(Transcription, transcription_id)
    if not t:
        raise HTTPException(404, "Transcription not found")
    db.query(Segment).filter(Segment.transcription_id == t.id).delete()
    for s in sorted(body.segments, key=lambda x: x.start):
        db.add(Segment(transcription_id=t.id, start=s.start, end=s.end, speaker=s.speaker, text=s.text))
    db.flush()
    t.full_text = _build_full_text(sorted(t.segments, key=lambda x: x.start))
    db.commit()
    db.refresh(t)
    return t


@router.delete("/{transcription_id}")
def delete_transcription(transcription_id: str, db: Session = Depends(get_db)):
    t = db.get(Transcription, transcription_id)
    if not t:
        raise HTTPException(404, "Transcription not found")
    if t.media_path:
        Path(t.media_path).unlink(missing_ok=True)
    db.delete(t)  # сегменты и протоколы удаляются каскадом
    db.commit()
    return {"deleted": transcription_id}
