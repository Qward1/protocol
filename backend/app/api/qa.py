"""Q&A по выбранным транскриптам/протоколам (через Dify)."""

from __future__ import annotations

import json
import re

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import ChatMessage, ChatSession, Protocol, Transcription
from app.schemas import Citation, QARequest, QAResponse
from app.services import dify_client

router = APIRouter(prefix="/api/qa", tags=["qa"])

_WORD = re.compile(r"\w+", re.UNICODE)


def _keywords(text: str) -> set[str]:
    return {w.lower() for w in _WORD.findall(text) if len(w) > 3}


def _best_segment(transcription: Transcription, question: str):
    """Сегмент записи с максимальным пересечением слов с вопросом (для цитаты)."""
    qk = _keywords(question)
    best, best_score = None, 0
    for seg in transcription.segments:
        score = len(qk & _keywords(seg.text))
        if score > best_score:
            best, best_score = seg, score
    return best


def _build_context(db: Session, req: QARequest) -> tuple[str, list[Citation]]:
    """Собрать текст контекста из выбранных объектов + цитаты с фрагментом/таймкодом."""
    parts: list[str] = []
    citations: list[Citation] = []

    for tid in req.scope.transcription_ids:
        t = db.get(Transcription, tid)
        if not t:
            continue
        parts.append(f"# Запись встречи: {t.filename}\n{t.full_text}")
        seg = _best_segment(t, req.question)
        citations.append(Citation(
            source_type="transcription", source_id=t.id, title=t.filename,
            fragment=(seg.text if seg else "")[:300],
            start=seg.start if seg else None,
        ))

    for pid in req.scope.protocol_ids:
        p = db.get(Protocol, pid)
        if not p:
            continue
        tasks_txt = "\n".join(f"- {task.assignment} → {task.responsible}" for task in p.tasks)
        parts.append(f"# Протокол: {p.title}\n{p.body}\nПоручения:\n{tasks_txt}")
        citations.append(Citation(
            source_type="protocol", source_id=p.id, title=p.title,
            fragment=(p.body or tasks_txt)[:300],
        ))

    context = "\n\n".join(parts)
    # Обрезаем контекст, чтобы не переполнить промпт LLM.
    limit = settings.qa.max_context_chars
    if len(context) > limit:
        context = context[:limit] + "\n…[контекст обрезан]"
    return context, citations


@router.post("", response_model=QAResponse)
async def ask(req: QARequest, db: Session = Depends(get_db)):
    # сессия чата
    session = db.get(ChatSession, req.session_id) if req.session_id else None
    if not session:
        session = ChatSession(title=req.question[:60], scope_json=req.scope.model_dump_json())
        db.add(session)
        db.commit()
        db.refresh(session)

    context, citations = _build_context(db, req)
    db.add(ChatMessage(session_id=session.id, role="user", content=req.question))

    query = f"{req.question}\n\n=== КОНТЕКСТ ===\n{context}" if context else req.question
    result = await dify_client.run_command(
        command=settings.dify.command_qa,
        query=query,
        inputs={"question": req.question, "context": context},
        name_hint=f"qa_{session.id}",
    )
    answer = result.answer or "Не удалось получить ответ (проверьте настройки Dify)."

    db.add(ChatMessage(
        session_id=session.id, role="assistant", content=answer,
        citations_json=json.dumps([c.model_dump() for c in citations], ensure_ascii=False),
    ))
    db.commit()

    return QAResponse(session_id=session.id, answer=answer, citations=citations)
