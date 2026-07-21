"""FastAPI приложение «Цифровой Офис» — backend для веб-UI.

Запуск:
    uvicorn app.main:app --reload --host 0.0.0.0 --port 8080
Конфиг берётся из config.yaml (см. config.example.yaml). Без .env.
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.db import init_db
from app.logging_config import get_logger, setup_logging
from app.security import auth_dependency
from app.services import reminders
from app.services.media import ffmpeg_available
from app.api import (
    analytics as analytics_api,
    auth as auth_api,
    export,
    library,
    max as max_api,
    protocol_templates,
    protocols,
    qa,
    rating_rules,
    search,
    tasks,
    transcriptions,
)

setup_logging()
log = get_logger("app")


def _normalize_base_path(value: str) -> str:
    if not value:
        return ""
    return "/" + value.strip("/")


class PublicBasePathMiddleware:
    """Снимает внешний префикс прокси перед маршрутизацией FastAPI.

    Это нужно для окружений, где URL выглядит как
    /jnserver/1109/application/, но прокси может как срезать этот путь, так и
    передавать его в приложение без изменений.
    """

    def __init__(self, app, base_path: str):
        self.app = app
        self.base_path = _normalize_base_path(base_path)

    async def __call__(self, scope, receive, send):
        if scope.get("type") in {"http", "websocket"} and self.base_path:
            path = scope.get("path") or ""
            if path == self.base_path or path.startswith(f"{self.base_path}/"):
                scope = dict(scope)
                scope["path"] = path[len(self.base_path):] or "/"
        await self.app(scope, receive, send)


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()

    from app.db import SessionLocal

    # Лёгкая чистка накопившихся данных при старте (истёкшие сессии, пустые чаты).
    from app.services.maintenance import run_startup_cleanup

    with SessionLocal() as db:
        run_startup_cleanup(db)

    # Дефолтные правила рейтинга (п. 4.5.3) — идемпотентно, если таблица пуста.
    from app.services.analytics import seed_rating_rules

    with SessionLocal() as db:
        seed_rating_rules(db)

    # Начальный администратор (только если включена авторизация пользователей).
    if settings.auth.enabled:
        from app.services.auth import seed_admin, seed_demo_users

        with SessionLocal() as db:
            seed_admin(db)
            seed_demo_users(db)  # opt-in auth.seed_demo — демо-роли для страницы входа

    log.info(
        "%s запущен. Auth=%s, RBAC=%s",
        settings.service_name, settings.security.require_auth, settings.auth.enabled,
    )

    # Планировщик напоминаний MAX (фоновая задача) — только если бот включён.
    reminder_task: asyncio.Task | None = None
    if settings.max.enabled:
        reminder_task = asyncio.create_task(reminders.reminder_loop())
        # Регистрируем вебхук, чтобы нажатия inline-кнопок доезжали до backend.
        if settings.max.webhook_public_url:
            from app.services.max_client import MaxClient

            await MaxClient().ensure_subscription(settings.max.webhook_public_url)

    # Плановое формирование утренней справки (п. 4.5.2) — единственный новый job,
    # не зависит от MAX; спит до настроенного времени и сохраняет снимок реестра.
    brief_task: asyncio.Task | None = None
    if settings.analytics.morning_brief_enabled:
        from app.services import morning_brief

        brief_task = asyncio.create_task(morning_brief.brief_loop())

    try:
        yield
    finally:
        for task in (reminder_task, brief_task):
            if task:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass


# Глобальная зависимость: на изменяющих запросах требует X-Api-Key (если включено).
app = FastAPI(
    title="Digital Office API",
    version="0.2.0",
    dependencies=[Depends(auth_dependency)],
    lifespan=lifespan,
    root_path=settings.root_path,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(PublicBasePathMiddleware, base_path=settings.public_base_path)


def _ffmpeg_available() -> bool:
    return ffmpeg_available()


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "service": settings.service_name,
        "ffmpeg": _ffmpeg_available(),
        "dify_app": bool(settings.dify.app_api_key),
        "dify_dataset": bool(settings.dify.dataset_api_key and settings.dify.transcripts_dataset_id),
        "openrouter": bool(settings.openrouter.api_key),
        "asr_model": settings.openrouter.asr_model,
        "auth_required": settings.security.require_auth,
        "max_bot": settings.max.enabled,
        "max_configured": bool(settings.max.enabled and settings.max.bot_token and settings.max.chat_id),
        "execution_control": settings.execution_control.enabled,
        "auth_enabled": settings.auth.enabled,
    }


for module in (
    auth_api, transcriptions, protocols, tasks, qa, search, library, export,
    max_api, protocol_templates, analytics_api, rating_rules,
):
    app.include_router(module.router)


# --- Раздача собранного фронтенда (SPA) из того же процесса/порта ---

def _frontend_dist() -> Path:
    if settings.frontend_dist:
        return Path(settings.frontend_dist)
    # backend/app/main.py -> backend/ -> репозиторий -> frontend/dist
    return Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"


_DIST = _frontend_dist()

if (_DIST / "index.html").is_file():
    # Хешированные ассеты Vite.
    assets_dir = _DIST / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    _DIST_RESOLVED = _DIST.resolve()

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str):
        """SPA-фоллбэк: отдаём конкретный файл, иначе index.html (для роутов React Router).

        Маршруты /api/* зарегистрированы выше и матчатся раньше этого catch-all;
        неизвестный /api/* сюда не должен «проваливаться» HTML-ответом — отдаём 404.
        """
        if full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")
        if full_path:
            candidate = (_DIST / full_path).resolve()
            # Защита от path traversal: отданный файл обязан остаться внутри dist.
            if candidate.is_relative_to(_DIST_RESOLVED) and candidate.is_file():
                return FileResponse(candidate)
        return FileResponse(_DIST / "index.html")

    log.info("Фронтенд раздаётся из %s", _DIST)
else:
    log.warning("Сборка фронтенда не найдена (%s). Соберите: cd frontend && npm run build", _DIST)
