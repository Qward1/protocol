"""Файловое хранилище: пути внутри storage_dir."""

from __future__ import annotations

from pathlib import Path
import re

from app.config import settings

STORAGE = Path(settings.storage_dir)


def _ensure(p: Path) -> Path:
    p.mkdir(parents=True, exist_ok=True)
    return p


def media_dir() -> Path:
    return _ensure(STORAGE / "media")


def exports_dir() -> Path:
    return _ensure(STORAGE / "exports")


def docs_dir() -> Path:
    return _ensure(STORAGE / "docs")


def templates_dir() -> Path:
    return _ensure(STORAGE / "templates")


def tmp_dir() -> Path:
    return _ensure(STORAGE / "tmp")


def safe_name(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", value).strip("_") or "file"


def media_path(transcription_id: str, filename: str) -> Path:
    return media_dir() / f"{transcription_id}_{safe_name(filename)}"
