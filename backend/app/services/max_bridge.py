"""Мост к микросервису MAX (microservice/).

Опциональная исходящая интеграция: backend уведомляет MAX-микросервис о событиях
(назначено поручение, сформирована справка). Включается config.max.enabled.

Точные REST-эндпоинты микросервиса зависят от его реализации — здесь задаются
конфигурируемые пути. Это точка расширения; функции не падают при ошибке.
"""

from __future__ import annotations

from typing import Any

import httpx

from app.config import settings
from app.logging_config import get_logger
from app.models import Task

log = get_logger("max-bridge")


def enabled() -> bool:
    return bool(settings.max.enabled and settings.max.base_url)


def _headers() -> dict[str, str]:
    h = {"Content-Type": "application/json"}
    if settings.max.api_key:
        h["X-Api-Key"] = settings.max.api_key
    return h


async def _post(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    if not enabled():
        return {"skipped": True}
    url = settings.max.base_url.rstrip("/") + path
    try:
        async with httpx.AsyncClient(timeout=settings.max.request_timeout) as client:
            resp = await client.post(url, json=payload, headers=_headers())
            resp.raise_for_status()
            return {"ok": True, "status": resp.status_code}
    except Exception as exc:
        log.warning("MAX bridge POST %s failed: %s", path, exc)
        return {"error": str(exc)}


async def notify_task_assigned(task: Task) -> dict[str, Any]:
    """Сообщить MAX-микросервису о назначенном поручении (для напоминаний/кнопок)."""
    return await _post(
        "/api/tasks/notify",
        {
            "id": task.id,
            "assignment": task.assignment,
            "responsible": task.responsible,
            "max_username": task.max_username,
            "deadline": task.deadline,
        },
    )


async def notify_memo_ready(task: Task, memo_path: str) -> dict[str, Any]:
    """Сообщить, что по задаче сформирована справка (путь к файлу на стороне backend)."""
    return await _post(
        "/api/tasks/memo",
        {"id": task.id, "responsible": task.responsible, "memo_path": memo_path},
    )
