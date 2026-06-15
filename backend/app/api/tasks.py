"""Поручения: дашборд, справка-обоснование (ТЗ 2Б), контроль исполнения (ТЗ 3, 4)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.logging_config import get_logger
from app.models import Justification, Task, _now
from app.schemas import (
    JustificationDTO,
    TaskConfirm,
    TaskDTO,
    TaskExecutionSubmit,
    TaskUpdate,
)
from app.services import dify_client, max_bridge, memo

router = APIRouter(prefix="/api/tasks", tags=["tasks"])
log = get_logger("tasks")


@router.get("", response_model=list[TaskDTO])
def list_tasks(status: str | None = None, db: Session = Depends(get_db)):
    """Список поручений для дашборда контроля исполнения (фильтр по статусу)."""
    q = db.query(Task)
    if status:
        q = q.filter(Task.status == status)
    return q.order_by(Task.created_at.desc()).all()


@router.get("/{task_id}", response_model=TaskDTO)
def get_task(task_id: str, db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    return task


@router.patch("/{task_id}", response_model=TaskDTO)
async def update_task(task_id: str, body: TaskUpdate, db: Session = Depends(get_db)):
    """Ручная правка поручения (ответственный, срок, статус и т.д.)."""
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(task, field, value)
    db.commit()
    db.refresh(task)
    return task


@router.post("/{task_id}/execution", response_model=TaskDTO)
async def submit_execution(task_id: str, body: TaskExecutionSubmit, db: Session = Depends(get_db)):
    """Сотрудник сообщает, что сделано. Статус -> «Требует проверки»."""
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    task.completion_text = body.completion_text
    task.status = "Требует проверки"
    db.commit()
    db.refresh(task)
    return task


@router.post("/{task_id}/confirm", response_model=TaskDTO)
async def confirm_task(task_id: str, body: TaskConfirm, db: Session = Depends(get_db)):
    """Руководитель подтверждает выполнение. Задача закрывается, формируется справка."""
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Task not found")

    task.closed_at = _now()
    task.status = "Выполнено"

    # Справка о выполненной работе: Dify, при неудаче — локальный DOCX.
    memo_path = await memo.build_memo(task)
    if memo_path:
        task.memo_path = memo_path
    db.commit()
    db.refresh(task)

    # Опционально уведомляем legacy-мост MAX (microservice).
    if body.notify_max and max_bridge.enabled():
        await max_bridge.notify_memo_ready(task, memo_path)

    return task


@router.post("/{task_id}/justification", response_model=JustificationDTO)
async def build_justification(task_id: str, db: Session = Depends(get_db)):
    """Сформировать справку-обоснование: на основании какого фрагмента и какой
    должностной обязанности поручение назначено на сотрудника."""
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Task not found")

    query = (
        f"{settings.dify.command_justification}\n\n"
        f"Поручение: {task.assignment}\n"
        f"Ответственный: {task.responsible}\n"
        f"Направление: {task.department}\n"
        f"Фрагмент-источник: {task.source_fragment}"
    )
    result = await dify_client.run_command(
        command=settings.dify.command_justification,
        query=query,
        inputs={
            "assignment": task.assignment,
            "responsible": task.responsible,
            "department": task.department,
            "source_fragment": task.source_fragment,
            "reason_comment": task.reason_comment,
        },
        name_hint=f"justification_{task.id}",
    )

    data = dify_client._safe_json_loads(result.answer) if result.answer else {}
    fragment = data.get("fragment") or task.source_fragment
    duty = data.get("duty") or data.get("job_duty") or ""
    text = data.get("text") or result.answer or task.reason_comment

    just = task.justification or Justification(task_id=task.id)
    just.fragment = fragment
    just.duty = duty
    just.text = text
    if result.files:
        just.docx_path = result.files[0]
    if not task.justification:
        db.add(just)
    db.commit()
    db.refresh(just)
    return just
