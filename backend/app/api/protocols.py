"""Генерация протокола и поручений из транскрипта (через Dify workflow)."""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import (
    TASK_PRIORITIES,
    TASK_PRIORITY_NORMAL,
    TASK_STATUS_NEW,
    TASK_STATUSES,
    Protocol,
    Task,
    Transcription,
)
from app.schemas import GenerateProtocolRequest, ProtocolDTO, ProtocolListItem, ProtocolUpdate
from app.security import require_permission
from app.services import dify_client, exec_control, max_handler
from app.services.deadlines import parse_deadline

router = APIRouter(prefix="/api/protocols", tags=["protocols"])


def _normalize_priority(value: object) -> str:
    """Мягко привести приоритет из ответа Dify к TASK_PRIORITIES.

    Извлечение приоритета в workflow опционально — неизвестное/пустое значение
    даёт «Обычный», а не ошибку (мягкая деградация внешнего вызова)."""
    raw = str(value or "").strip().lower()
    if not raw:
        return TASK_PRIORITY_NORMAL
    for priority in TASK_PRIORITIES:
        if raw == priority.lower():
            return priority
    # Терпимо распознаём частые англоязычные/сокращённые варианты от LLM.
    aliases = {
        "низкий": ("low", "low priority", "минимальный"),
        "обычный": ("normal", "medium", "средний", "обычная"),
        "высокий": ("high", "важный"),
        "критический": ("critical", "urgent", "срочный", "критично"),
    }
    for priority in TASK_PRIORITIES:
        if raw in aliases.get(priority.lower(), ()):
            return priority
    return TASK_PRIORITY_NORMAL


def _normalize_status(value: object) -> str:
    """Мягко привести статус из ответа Dify к TASK_STATUSES.

    Workflow может вернуть «Новое» или «Требует проверки» (см. промпт извлечения);
    неизвестное/пустое значение даёт «Новое», чтобы поручение не выпало из фильтров
    дашборда по статусу — тот же принцип мягкой деградации, что и у приоритета."""
    raw = str(value or "").strip()
    for status in TASK_STATUSES:
        if raw.lower() == status.lower():
            return status
    return TASK_STATUS_NEW


def _apply_dify_protocol(db: Session, protocol: Protocol, result_raw: dict, answer: str) -> None:
    """Распарсить ответ Dify (JSON с метаданными протокола и списком задач)."""
    data = dify_client.safe_json_loads(answer) if answer else {}
    if not data and isinstance(result_raw, dict):
        data = result_raw

    protocol.title = data.get("meeting_title") or data.get("title") or "Протокол совещания"
    protocol.date = data.get("protocol_date") or data.get("date") or ""
    protocol.number = data.get("protocol_number") or data.get("number") or ""
    protocol.body = data.get("body") or answer or ""
    protocol.raw_json = json.dumps(data, ensure_ascii=False)

    tasks = data.get("tasks") or []
    for item in tasks:
        if not isinstance(item, dict):
            continue
        deadline = item.get("deadline") or item.get("due_date") or ""
        db.add(Task(
            protocol_id=protocol.id,
            assignment=item.get("assignment") or item.get("task") or "",
            responsible=item.get("responsible") or "",
            department=item.get("department") or item.get("department_hint") or "",
            deadline=deadline,
            deadline_at=parse_deadline(deadline),
            status=_normalize_status(item.get("status")),
            # Срезы аналитики — опциональны в извлечении; отсутствие -> дефолт/пусто.
            priority=_normalize_priority(item.get("priority")),
            location=item.get("location") or "",
            object=item.get("object") or "",
            theme=item.get("theme") or "",
            source_fragment=item.get("source_fragment") or "",
            reason_comment=item.get("reason_comment") or "",
            confidence=float(item.get("confidence") or 0.0),
            max_username=item.get("max_username") or "",
        ))


@router.post("", response_model=ProtocolDTO, dependencies=[Depends(require_permission("protocols.manage"))])
async def generate_protocol(req: GenerateProtocolRequest, db: Session = Depends(get_db)):
    t = db.get(Transcription, req.transcription_id)
    if not t:
        raise HTTPException(404, "Transcription not found")

    protocol = Protocol(transcription_id=t.id, title="Генерация…")
    db.add(protocol)
    db.commit()
    db.refresh(protocol)

    result = await dify_client.run_command(
        command=settings.dify.command_protocol,
        query=t.full_text,
        inputs={"transcript": t.full_text, "meeting_title": t.filename},
        name_hint=f"protocol_{protocol.id}",
    )
    # Dify недоступен/не настроен: не сохраняем пустышку, показываем ошибку —
    # это прямое действие пользователя, а не фоновый вызов.
    if result.raw.get("error") and not result.answer:
        db.delete(protocol)
        db.commit()
        raise HTTPException(
            502,
            "Не удалось сгенерировать протокол: сервис Dify недоступен или не настроен. "
            "Проверьте состояние сервисов на /api/health.",
        )
    _apply_dify_protocol(db, protocol, result.raw, result.answer)
    if result.files:
        protocol.docx_path = result.files[0]
    db.commit()
    db.refresh(protocol)

    # Опционально дублируем поручения во внешний execution-control-service.
    if exec_control.enabled() and protocol.tasks:
        await exec_control.push_tasks(list(protocol.tasks))

    # Поручения хранятся в локальной БД; опционально отправляем карточки в MAX.
    for task in protocol.tasks:
        if settings.max.enabled:
            await max_handler.notify_task_assigned(db, task)

    return protocol


@router.get("", response_model=list[ProtocolListItem], dependencies=[Depends(require_permission("protocols.view"))])
def list_protocols(db: Session = Depends(get_db)):
    counts = dict(
        db.query(Task.protocol_id, func.count(Task.id)).group_by(Task.protocol_id).all()
    )
    return [
        ProtocolListItem(
            id=p.id,
            title=p.title,
            date=p.date,
            number=p.number,
            tasks_count=counts.get(p.id, 0),
            created_at=p.created_at,
        )
        for p in db.query(Protocol).order_by(Protocol.created_at.desc()).all()
    ]


@router.get("/{protocol_id}", response_model=ProtocolDTO, dependencies=[Depends(require_permission("protocols.view"))])
def get_protocol(protocol_id: str, db: Session = Depends(get_db)):
    p = db.get(Protocol, protocol_id)
    if not p:
        raise HTTPException(404, "Protocol not found")
    return p


@router.put(
    "/{protocol_id}", response_model=ProtocolDTO,
    dependencies=[Depends(require_permission("protocols.manage"))],
)
def update_protocol(protocol_id: str, body: ProtocolUpdate, db: Session = Depends(get_db)):
    """Ручная правка метаданных/текста протокола (title/date/number/body).

    Простая перезапись переданных полей — без истории/аудита. Сохранённые правки
    автоматически попадают в экспорт: exporter.protocol_to_md читает эти поля из
    объекта Protocol."""
    p = db.get(Protocol, protocol_id)
    if not p:
        raise HTTPException(404, "Protocol not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(p, field, value)
    db.commit()
    db.refresh(p)
    return p


@router.delete("/{protocol_id}", dependencies=[Depends(require_permission("protocols.manage"))])
def delete_protocol(protocol_id: str, db: Session = Depends(get_db)):
    p = db.get(Protocol, protocol_id)
    if not p:
        raise HTTPException(404, "Protocol not found")
    db.delete(p)  # поручения и обоснования — каскадом
    db.commit()
    return {"deleted": protocol_id}
