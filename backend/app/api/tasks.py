"""Поручения: дашборд, справка-обоснование (ТЗ 2Б), контроль исполнения (ТЗ 3, 4)."""

from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.logging_config import get_logger
from app.models import TASK_STATUS_DONE, TASK_STATUS_REVIEW, Justification, Task, _now
from app.schemas import (
    JustificationDTO,
    TaskConfirm,
    TaskDTO,
    TaskExecutionSubmit,
    TaskUpdate,
)
from app.security import current_principal, require_permission
from app.services import auth, dify_client, max_bridge, max_handler, memo
from app.services.deadlines import parse_deadline

router = APIRouter(prefix="/api/tasks", tags=["tasks"])
log = get_logger("tasks")

# Неразрешённый плейсхолдер Dify-workflow (например {{#context#}}) — когда узел
# «Поиск должностных обязанностей» не подключён к датасету, шаблон утекает в ответ.
# Не показываем пользователю сырой синтаксис шаблона.
_DIFY_PLACEHOLDER = re.compile(r"\{\{#.*?#\}\}")


def _strip_unresolved(value: object) -> str:
    """Пусто, если в тексте остался неразрешённый плейсхолдер Dify; иначе — сам текст."""
    text = str(value or "").strip()
    if _DIFY_PLACEHOLDER.search(text):
        return ""
    return text


def _ensure_task_access(request: Request, task: Task) -> None:
    """Исполнитель видит/меняет только свои поручения; остальные роли — все."""
    principal = current_principal(request)
    if principal.has("tasks.view_all", "tasks.manage"):
        return
    if principal.has("tasks.view_own", "tasks.execute") and auth.task_belongs_to(task, principal):
        return
    raise HTTPException(403, "Недостаточно прав")


def _max_config_errors() -> list[str]:
    errors: list[str] = []
    if not settings.max.enabled:
        errors.append("max.enabled=false")
    if not settings.max.bot_token:
        errors.append("max.bot_token не задан")
    if not settings.max.chat_id:
        errors.append("max.chat_id не задан")
    return errors


@router.get(
    "", response_model=list[TaskDTO],
    dependencies=[Depends(require_permission("tasks.view_all", "tasks.view_own"))],
)
def list_tasks(request: Request, status: str | None = None, db: Session = Depends(get_db)):
    """Список поручений для дашборда контроля исполнения (фильтр по статусу).

    Исполнитель видит только свои поручения (по ФИО/логину), остальные роли — все.
    """
    q = db.query(Task)
    if status:
        q = q.filter(Task.status == status)
    tasks = q.order_by(Task.created_at.desc()).all()

    principal = current_principal(request)
    if not principal.has("tasks.view_all"):
        tasks = [t for t in tasks if auth.task_belongs_to(t, principal)]
    return tasks


@router.get(
    "/{task_id}", response_model=TaskDTO,
    dependencies=[Depends(require_permission("tasks.view_all", "tasks.view_own"))],
)
def get_task(task_id: str, request: Request, db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    _ensure_task_access(request, task)
    return task


@router.patch("/{task_id}", response_model=TaskDTO, dependencies=[Depends(require_permission("tasks.manage"))])
async def update_task(task_id: str, body: TaskUpdate, db: Session = Depends(get_db)):
    """Ручная правка поручения (ответственный, срок, статус и т.д.)."""
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    updates = body.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(task, field, value)
    # Срок менялся -> пересчитываем разобранный deadline_at (единый источник истины).
    if "deadline" in updates:
        task.deadline_at = parse_deadline(task.deadline or "")
    db.commit()
    db.refresh(task)
    return task


@router.post(
    "/{task_id}/execution", response_model=TaskDTO,
    dependencies=[Depends(require_permission("tasks.execute"))],
)
async def submit_execution(task_id: str, body: TaskExecutionSubmit, request: Request, db: Session = Depends(get_db)):
    """Сотрудник/исполнитель сообщает, что сделано. Статус -> «Требует проверки»."""
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    _ensure_task_access(request, task)  # исполнитель — только своё
    task.completion_text = body.completion_text
    task.status = TASK_STATUS_REVIEW
    db.commit()
    db.refresh(task)
    return task


@router.post("/{task_id}/confirm", response_model=TaskDTO, dependencies=[Depends(require_permission("tasks.manage"))])
async def confirm_task(task_id: str, body: TaskConfirm, db: Session = Depends(get_db)):
    """Руководитель подтверждает выполнение. Задача закрывается, формируется справка."""
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Task not found")

    task.closed_at = _now()
    task.status = TASK_STATUS_DONE

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


@router.post("/{task_id}/send-max", dependencies=[Depends(require_permission("tasks.manage"))])
async def send_task_to_max(task_id: str, db: Session = Depends(get_db), chat_id: str | None = None):
    """Отправить карточку поручения в группу MAX с кнопкой подтверждения исполнения."""
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Task not found")

    config_errors = _max_config_errors()
    if config_errors:
        raise HTTPException(400, "MAX не настроен: " + "; ".join(config_errors))

    result = await max_handler.notify_task_assigned(db, task, chat_id=chat_id)
    if result.get("error"):
        raise HTTPException(502, f"MAX не принял сообщение: {result['error']}")
    if result.get("disabled"):
        raise HTTPException(400, "MAX не настроен: max.bot_token не задан")
    return {"ok": True, "result": result}


@router.post(
    "/{task_id}/justification", response_model=JustificationDTO,
    dependencies=[Depends(require_permission("protocols.view"))],
)
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

    data = dify_client.safe_json_loads(result.answer) if result.answer else {}
    fragment = _strip_unresolved(data.get("fragment")) or task.source_fragment
    duty = _strip_unresolved(data.get("duty") or data.get("job_duty"))
    text = _strip_unresolved(data.get("text") or result.answer) or task.reason_comment

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
