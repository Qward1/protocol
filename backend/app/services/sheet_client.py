"""Синхронизация реестра поручений с Google Таблицей (Apps Script Web App).

При создании поручения добавляется/обновляется строка; при подтверждении
выполнения строка «зеленеет» (статус «Выполнено»). Все вызовы «мягкие» — при
ошибке только логируем, основной поток не падает.

Контракт Apps Script (doPost, JSON-тело):
    {
      "token": "<script_token>",
      "action": "upsert" | "complete",
      "id": "...", "responsible": "...", "assignment": "...",
      "department": "...", "deadline": "...", "status": "...",
      "completion_text": "...", "closed_at": "..."
    }
Скрипт ищет строку по ``id`` (создаёт при отсутствии) и для action=complete
красит её в зелёный.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import httpx

from app.config import settings
from app.logging_config import get_logger
from app.models import Task

log = get_logger("sheets")


def enabled() -> bool:
    return bool(settings.google_sheets.enabled and settings.google_sheets.webapp_url)


def _fmt(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.isoformat(sep=" ", timespec="minutes")
    return str(value)


def _payload(task: Task, action: str) -> dict[str, Any]:
    return {
        "token": settings.google_sheets.script_token or "",
        "action": action,
        "id": task.id,
        "responsible": task.responsible or "",
        "assignment": task.assignment or "",
        "department": task.department or "",
        "max_username": task.max_username or "",
        "deadline": task.deadline or "",
        "status": task.status or "",
        "completion_text": task.completion_text or "",
        "closed_at": _fmt(task.closed_at),
    }


async def _post(action: str, task: Task) -> dict[str, Any]:
    if not enabled():
        return {"skipped": True}
    try:
        # Apps Script отвечает редиректом на googleusercontent — следуем за ним.
        async with httpx.AsyncClient(
            timeout=settings.google_sheets.request_timeout, follow_redirects=True
        ) as client:
            resp = await client.post(settings.google_sheets.webapp_url, json=_payload(task, action))
            if resp.status_code >= 400:
                log.warning("Sheet %s error %s: %s", action, resp.status_code, resp.text)
                return {"error": resp.status_code}
            return {"ok": True}
    except Exception as exc:  # noqa: BLE001 — внешний вызов не должен ронять поток
        log.warning("Google Sheet sync (%s) failed: %s", action, exc)
        return {"error": str(exc)}


async def upsert_task(task: Task) -> dict[str, Any]:
    """Создать/обновить строку поручения в таблице."""
    return await _post("upsert", task)


async def mark_completed(task: Task) -> dict[str, Any]:
    """Отметить поручение выполненным (строка зеленеет)."""
    return await _post("complete", task)
