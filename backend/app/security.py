"""FastAPI-зависимости авторизации и проверки прав (RBAC).

Два режима:

* ``auth.enabled = false`` (по умолчанию) — старое поведение: доступ открыт,
  на изменяющих запросах опционально проверяется общий ключ X-Api-Key
  (``security.require_auth``). Все проверки прав пропускаются (роль — админ).
* ``auth.enabled = true`` — все ``/api/*`` (кроме логина/здоровья/вебхука MAX)
  требуют сессионный токен (``Authorization: Bearer``), а доступ к ресурсам
  ограничивается ролью через ``require_permission(...)``.
"""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException, Request

from app.config import settings
from app.db import SessionLocal
from app.services import auth

_MUTATING = {"POST", "PUT", "PATCH", "DELETE"}

# Пути, доступные без сессии даже при включённой авторизации.
# /api/auth/me и /logout должны работать без токена, чтобы фронтенд мог понять,
# что нужно показать экран входа (иначе 401 «сломает» стартовую загрузку).
_PUBLIC_API_PATHS = {
    "/api/health",
    "/api/auth/login",
    "/api/auth/me",
    "/api/auth/logout",
    "/api/auth/demo",
    "/api/max/webhook",
}


@dataclass
class AuthPrincipal:
    """Лёгкое представление текущего пользователя (без ORM-объекта)."""

    id: str
    username: str
    full_name: str
    role: str

    def has(self, *permissions: str) -> bool:
        return any(auth.has_permission(self.role, p) for p in permissions)


# Синтетический «системный» админ для режима без авторизации.
_SYSTEM_PRINCIPAL = AuthPrincipal(id="system", username="system", full_name="", role=auth.ROLE_ADMIN)


def _bearer_token(request: Request) -> str:
    header = request.headers.get("Authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    token = request.headers.get("X-Auth-Token", "").strip()
    if token:
        return token
    # Токен из query — для запросов, которые не могут послать заголовок
    # (например, потоковое медиа в теге <audio src=...>).
    return request.query_params.get("token", "").strip()


def _resolve_principal(request: Request) -> AuthPrincipal | None:
    token = _bearer_token(request)
    if not token:
        return None
    with SessionLocal() as db:
        user = auth.resolve_session(db, token)
        if not user:
            return None
        return AuthPrincipal(id=user.id, username=user.username, full_name=user.full_name, role=user.role)


async def auth_dependency(request: Request) -> None:
    """Глобальная зависимость приложения: аутентификация + запись principal.

    Кладёт ``request.state.principal`` для последующих проверок прав.
    """
    if not settings.auth.enabled:
        # Legacy-режим: единый X-Api-Key на изменяющих запросах.
        request.state.principal = _SYSTEM_PRINCIPAL
        if settings.security.require_auth and request.method in _MUTATING:
            if request.url.path not in _PUBLIC_API_PATHS:
                provided = request.headers.get("X-Api-Key", "")
                if not settings.security.api_key or provided != settings.security.api_key:
                    raise HTTPException(status_code=401, detail="Invalid or missing X-Api-Key")
        return

    principal = _resolve_principal(request)
    request.state.principal = principal

    path = request.url.path
    # Аутентификацию требуем только для защищённых /api-путей. Статику/SPA/логин
    # отдаём свободно, дальше доступ к ресурсам решает require_permission.
    if not path.startswith("/api/"):
        return
    if path in _PUBLIC_API_PATHS:
        return
    if principal is None:
        raise HTTPException(status_code=401, detail="Требуется авторизация")


def current_principal(request: Request) -> AuthPrincipal:
    """Текущий пользователь (в режиме без авторизации — системный админ)."""
    principal = getattr(request.state, "principal", None)
    if principal is None:
        if not settings.auth.enabled:
            return _SYSTEM_PRINCIPAL
        raise HTTPException(status_code=401, detail="Требуется авторизация")
    return principal


def require_permission(*permissions: str):
    """Фабрика зависимости: разрешить, если у роли есть любое из прав."""

    def dependency(request: Request) -> AuthPrincipal:
        principal = current_principal(request)
        if not principal.has(*permissions):
            raise HTTPException(status_code=403, detail="Недостаточно прав")
        return principal

    return dependency
