"""Эндпоинты MAX-бота: входящий вебхук и ручная отправка карточки поручения в группу.

Вебхук вызывается платформой MAX, поэтому он не проходит обычную X-Api-Key
проверку (см. security.py): вместо этого сверяется ``?secret=`` с
``max.webhook_secret`` (если он задан).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.api.tasks import send_task_to_max
from app.config import settings
from app.db import get_db
from app.logging_config import get_logger
from app.security import require_permission
from app.services import max_handler
from app.services.max_client import MaxClient

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


@router.post("/tasks/{task_id}/notify", dependencies=[Depends(require_permission("tasks.manage"))])
async def notify_task(task_id: str, db: Session = Depends(get_db), chat_id: str | None = None):
    """DEPRECATED: используйте ``POST /api/tasks/{id}/send-max`` — тот же результат
    и единая обработка ошибок конфигурации MAX. Оставлено тонкой обёрткой ради
    обратной совместимости (фронтенд ходит в /send-max)."""
    return await send_task_to_max(task_id, db=db, chat_id=chat_id)


@router.get("/status")
async def max_status():
    """Состояние интеграции MAX: настройки и зарегистрированные вебхуки.

    Помогает проверить, «доезжают» ли нажатия inline-кнопок до backend.
    """
    info: dict = {
        "enabled": settings.max.enabled,
        "bot_token": bool(settings.max.bot_token),
        "chat_id": bool(settings.max.chat_id),
        "webhook_secret": bool(settings.max.webhook_secret),
        "webhook_public_url": settings.max.webhook_public_url,
        "subscriptions": [],
    }
    if settings.max.enabled and settings.max.bot_token:
        try:
            subs = await MaxClient().list_subscriptions()
            info["subscriptions"] = subs.get("subscriptions", subs)
        except Exception as exc:  # noqa: BLE001
            info["subscriptions_error"] = str(exc)
    return info


@router.post("/subscribe", dependencies=[Depends(require_permission("tasks.manage"))])
async def max_subscribe(url: str | None = None):
    """Зарегистрировать (или переустановить) вебхук MAX вручную.

    По умолчанию берёт ``max.webhook_public_url`` из конфигурации.
    """
    if not settings.max.enabled or not settings.max.bot_token:
        raise HTTPException(400, "MAX не настроен: задайте max.enabled=true и bot_token")
    target = url or settings.max.webhook_public_url
    if not target:
        raise HTTPException(400, "Не задан URL вебхука (max.webhook_public_url)")
    result = await MaxClient().ensure_subscription(target)
    if result.get("error"):
        raise HTTPException(502, f"MAX не принял подписку: {result['error']}")
    return {"ok": True, "url": target, "result": result}
