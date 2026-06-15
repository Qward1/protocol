"""Дублирование поручений во внешний execution-control-service.

Повторяет HTTP-ноду исходного workflow: POST {bulk_url} с X-Api-Key и телом
{"tasks": [...]}. Включается через config.execution_control.enabled.
"""

from __future__ import annotations

from typing import Any

import httpx

from app.config import settings
from app.logging_config import get_logger
from app.models import Task

log = get_logger("exec-control")


def enabled() -> bool:
    cfg = settings.execution_control
    return bool(cfg.enabled and cfg.bulk_url)


def _task_payload(task: Task) -> dict[str, Any]:
    return {
        "id": task.id,
        "assignment": task.assignment,
        "responsible": task.responsible,
        "department": task.department,
        "deadline": task.deadline,
        "status": task.status,
        "max_username": task.max_username,
        "confidence": task.confidence,
        "reason_comment": task.reason_comment,
        "source_fragment": task.source_fragment,
    }


async def push_tasks(tasks: list[Task]) -> dict[str, Any]:
    """Отправить поручения во внешний сервис. Не падает при ошибке."""
    if not enabled() or not tasks:
        return {"skipped": True}
    cfg = settings.execution_control
    payload = {"tasks": [_task_payload(t) for t in tasks]}
    try:
        async with httpx.AsyncClient(timeout=cfg.request_timeout) as client:
            resp = await client.post(
                cfg.bulk_url,
                json=payload,
                headers={"Content-Type": "application/json", "X-Api-Key": cfg.api_key},
            )
            resp.raise_for_status()
            log.info("execution-control: отправлено %d поручений", len(tasks))
            return {"ok": True, "status": resp.status_code}
    except Exception as exc:
        log.warning("execution-control push failed: %s", exc)
        return {"error": str(exc)}
