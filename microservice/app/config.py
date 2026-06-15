from functools import lru_cache
import json
import os
from pathlib import Path
from typing import Any

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    service_name: str = "execution-control-service"
    database_url: str = "sqlite:///./storage/app.db"
    api_key: str = ""
    max_api_base_url: str = "https://platform-api.max.ru"
    max_bot_token: str = ""
    max_chat_id: str = ""
    public_base_url: str = ""
    reminder_lead_minutes: int = 60
    reminder_scan_seconds: int = 60
    default_deadline_time: str = "18:00"
    timezone: str = "Europe/Moscow"
    storage_dir: str = "./storage"
    memo_template_path: str = "./templates/spravka_template.docx"
    webhook_secret: str = ""
    google_sheet_webapp_url: str = ""
    google_script_token: str = ""
    dify_memo_base_url: str = "https://dify.t1v.scibox.tech/v1"
    dify_memo_api_key: str = ""
    dify_memo_response_mode: str = "streaming"
    dify_memo_user: str = "execution-control-service"
    dify_memo_trigger_message: str = "Создание справки(служебной записки)"
    dify_memo_fallback_local: bool = True

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


def _candidate_config_paths() -> list[Path]:
    explicit = os.getenv("CONFIG_PATH")
    if explicit:
        return [Path(explicit)]

    cwd = Path.cwd()
    app_dir = Path(__file__).resolve().parent
    project_root = app_dir.parent

    return [
        cwd / "config.json",
        project_root / "config.json",
        Path("/srv/app/config.json"),
    ]


def _load_config_json() -> dict[str, Any]:
    for path in _candidate_config_paths():
        if path.is_file():
            with path.open("r", encoding="utf-8") as file:
                data = json.load(file)
            if not isinstance(data, dict):
                raise ValueError(f"Config file must contain a JSON object: {path}")
            return data
    return {}


@lru_cache
def get_settings() -> Settings:
    config_data = _load_config_json()
    return Settings(**config_data)


settings = get_settings()
