"""Аутентификация по X-Api-Key для изменяющих запросов."""

from __future__ import annotations

from fastapi import HTTPException, Request

from app.config import settings

_MUTATING = {"POST", "PUT", "PATCH", "DELETE"}


async def auth_dependency(request: Request) -> None:
    """Глобальная зависимость: на изменяющих методах требует X-Api-Key.

    GET/HEAD/OPTIONS всегда открыты. Если security.require_auth=false — проверки нет.
    """
    if not settings.security.require_auth:
        return
    if request.method not in _MUTATING:
        return
    provided = request.headers.get("X-Api-Key", "")
    if not settings.security.api_key or provided != settings.security.api_key:
        raise HTTPException(status_code=401, detail="Invalid or missing X-Api-Key")
