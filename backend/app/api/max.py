"""Эндпоинты MAX-бота: входящий вебхук и ручная отправка карточки поручения в группу.

Вебхук вызывается платформой MAX, поэтому он не проходит обычную X-Api-Key
проверку (см. security.py): вместо этого сверяется ``?secret=`` с
``max.webhook_secret`` (если он задан).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.logging_config import get_logger
from app.models import Task
from app.services import max_handler

router = APIRouter(prefix="/api/max", tags=["max"])
log = get_logger("max-api")


@router.post("/webhook")
async def max_webhook(request: Request, db: Session = Depends(get_db)):
    """Принять апдейт MAX (сообщение/нажатие кнопки) и обработать цепочку подтверждения."""
    secret = settings.max.webhook_secret
    if secret and request.query_params.get("secret") != secret:
        raise HTTPException(status_code=403, detail="Invalid webhook secret")

    try:
        update = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    try:
        return await max_handler.handle_update(db, update)
    except Exception as exc:  # noqa: BLE001 — не возвращаем 500 платформе MAX
        log.warning("Ошибка обработки апдейта MAX: %s", exc)
        return {"error": str(exc)}


@router.post("/tasks/{task_id}/notify")
async def notify_task(task_id: str, db: Session = Depends(get_db), chat_id: str | None = None):
    """Отправить карточку поручения с кнопкой подтверждения в группу MAX."""
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    if not settings.max.enabled:
        raise HTTPException(400, "MAX отключён (max.enabled=false)")
    return await max_handler.notify_task_assigned(db, task, chat_id=chat_id)
