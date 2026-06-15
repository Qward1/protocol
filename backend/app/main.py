"""FastAPI приложение «Цифровой Офис» — backend для веб-UI.

Запуск:
    uvicorn app.main:app --reload --port 8000
Конфиг берётся из config.yaml (см. config.example.yaml). Без .env.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
import shutil

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db import init_db
from app.logging_config import get_logger, setup_logging
from app.security import auth_dependency
from app.api import (
    export,
    library,
    protocols,
    qa,
    search,
    tasks,
    transcriptions,
)

setup_logging()
log = get_logger("app")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    log.info("%s запущен. Auth=%s", settings.service_name, settings.security.require_auth)
    yield


# Глобальная зависимость: на изменяющих запросах требует X-Api-Key (если включено).
app = FastAPI(
    title="Digital Office API",
    version="0.2.0",
    dependencies=[Depends(auth_dependency)],
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _ffmpeg_available() -> bool:
    from pathlib import Path

    ff = settings.media.ffmpeg_path
    return shutil.which(ff) is not None or Path(ff).is_file()


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
        "max_bridge": settings.max.enabled,
        "execution_control": settings.execution_control.enabled,
    }


for module in (transcriptions, protocols, tasks, qa, search, library, export):
    app.include_router(module.router)
