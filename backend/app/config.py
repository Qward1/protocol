"""Загрузка конфигурации из YAML (без .env).

Паттерн поиска файла повторяет microservice/app/config.py, но источник — YAML:
1. переменная окружения CONFIG_PATH (если задана);
2. ./config.yaml в текущей рабочей директории;
3. config.yaml рядом с пакетом (корень backend/).
"""

from __future__ import annotations

from functools import lru_cache
import os
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field


class OpenRouterSettings(BaseModel):
    base_url: str = "https://openrouter.ai/api/v1"
    api_key: str = ""
    asr_model: str = "google/gemini-2.5-flash"
    chunk_seconds: int = 600
    enable_diarization: bool = True
    language: str = "ru"
    request_timeout: int = 300
    # Имя content-part с аудио. У большинства OpenAI-совместимых моделей — input_audio.
    audio_part_type: str = "input_audio"


class DifySettings(BaseModel):
    base_url: str = "https://dify.t1v.scibox.tech/v1"
    app_api_key: str = ""
    dataset_api_key: str = ""
    transcripts_dataset_id: str = ""
    response_mode: str = "streaming"
    user: str = "digital-office-backend"
    request_timeout: int = 180
    command_protocol: str = "Извлечение протокола"
    command_qa: str = "Вопросы пользователя"
    command_justification: str = "Справка-обоснование"
    command_memo: str = "Создание справки(служебной записки)"


class MaxBridgeSettings(BaseModel):
    # MAX-интеграция теперь живёт в backend (бот, кнопки подтверждения, напоминания).
    enabled: bool = False
    request_timeout: int = 60

    # --- бот MAX ---
    api_base_url: str = "https://platform-api.max.ru"
    bot_token: str = ""                 # токен бота MAX
    chat_id: str = ""                   # ID группы MAX по умолчанию (для группы — отрицательный)
    webhook_secret: str = ""            # общий секрет: проверяется в query ?secret= вебхука
    # Публичный URL вебхука, который MAX вызывает при нажатии кнопок/сообщениях.
    # Если задан и max.enabled=true — backend регистрирует подписку при старте.
    # Должен включать ?secret=<webhook_secret>, напр.
    #   https://host/jnserver/1109/application/api/max/webhook?secret=XXX
    webhook_public_url: str = ""

    # --- напоминания о приближении срока ---
    reminder_lead_minutes: int = 60     # за сколько минут до дедлайна слать напоминание
    reminder_scan_seconds: int = 60     # период опроса задач планировщиком
    default_deadline_time: str = "18:00"  # время дня, если в дедлайне только дата
    timezone: str = "Europe/Moscow"

    # --- legacy: исходящий мост к отдельному microservice (по умолчанию не нужен) ---
    base_url: str = ""
    api_key: str = ""


class MediaSettings(BaseModel):
    ffmpeg_path: str = "ffmpeg"


class SecuritySettings(BaseModel):
    # Если require_auth=true, изменяющие запросы (POST/PUT/PATCH/DELETE) требуют
    # заголовок X-Api-Key, совпадающий с api_key. GET всегда открыты.
    api_key: str = ""
    require_auth: bool = False


class UploadSettings(BaseModel):
    max_mb: int = 1024
    allowed_extensions: list[str] = Field(
        default_factory=lambda: [
            ".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac", ".opus",
            ".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v",
        ]
    )


class ExportSettings(BaseModel):
    # TTF-шрифт с кириллицей для PDF. Пусто = автоопределение системного шрифта.
    pdf_font_path: str = ""


class ExecutionControlSettings(BaseModel):
    # Дублировать поручения во внешний execution-control-service (как в исходном workflow).
    enabled: bool = False
    bulk_url: str = ""
    api_key: str = ""
    request_timeout: int = 30


class QASettings(BaseModel):
    max_context_chars: int = 24000  # обрезка контекста, чтобы не переполнить промпт


class Settings(BaseModel):
    service_name: str = "digital-office-backend"
    host: str = "0.0.0.0"
    port: int = 8080
    database_url: str = "sqlite:///./storage/app.db"
    storage_dir: str = "./storage"
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])
    log_level: str = "INFO"
    # Раздача собранного фронтенда (SPA) из того же процесса. Пусто = автоопределение
    # ../frontend/dist относительно backend/. Нужно для деплоя за одним портом.
    frontend_dist: str = ""
    # Префикс пути за reverse-proxy (если он НЕ срезается прокси). Обычно "" —
    # jupyter-server-proxy срезает префикс, и backend работает в корне.
    root_path: str = ""
    # Публичный base path, по которому приложение открывается снаружи. Backend
    # принимает этот префикс и снимает его перед маршрутизацией, чтобы работали
    # оба режима reverse-proxy: со срезанием префикса и без него.
    public_base_path: str = "/jnserver/1109/application/"

    openrouter: OpenRouterSettings = Field(default_factory=OpenRouterSettings)
    dify: DifySettings = Field(default_factory=DifySettings)
    max: MaxBridgeSettings = Field(default_factory=MaxBridgeSettings)
    media: MediaSettings = Field(default_factory=MediaSettings)
    security: SecuritySettings = Field(default_factory=SecuritySettings)
    upload: UploadSettings = Field(default_factory=UploadSettings)
    export: ExportSettings = Field(default_factory=ExportSettings)
    execution_control: ExecutionControlSettings = Field(default_factory=ExecutionControlSettings)
    qa: QASettings = Field(default_factory=QASettings)


def _candidate_config_paths() -> list[Path]:
    explicit = os.getenv("CONFIG_PATH")
    if explicit:
        return [Path(explicit)]

    cwd = Path.cwd()
    app_dir = Path(__file__).resolve().parent
    project_root = app_dir.parent  # backend/
    return [
        cwd / "config.yaml",
        project_root / "config.yaml",
    ]


def _load_config_yaml() -> dict[str, Any]:
    for path in _candidate_config_paths():
        if path.is_file():
            with path.open("r", encoding="utf-8") as file:
                data = yaml.safe_load(file) or {}
            if not isinstance(data, dict):
                raise ValueError(f"Config file must contain a YAML mapping: {path}")
            return data
    return {}


@lru_cache
def get_settings() -> Settings:
    return Settings(**_load_config_yaml())


settings = get_settings()
