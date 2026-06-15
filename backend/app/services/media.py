"""Работа с медиа через ffmpeg: длительность, извлечение/нормализация аудио, нарезка.

ffmpeg должен быть установлен и доступен по пути settings.media.ffmpeg_path.
Для каркаса используем CLI ffmpeg/ffprobe (без тяжёлых python-зависимостей).
"""

from __future__ import annotations

import json
from pathlib import Path
import subprocess

from app.config import settings
from app.services import storage

VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v"}
AUDIO_EXTS = {".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac", ".opus"}


def _ffprobe_bin() -> str:
    # ffprobe обычно лежит рядом с ffmpeg
    ff = settings.media.ffmpeg_path
    return ff.replace("ffmpeg", "ffprobe") if "ffmpeg" in ff else "ffprobe"


def is_video(path: str | Path) -> bool:
    return Path(path).suffix.lower() in VIDEO_EXTS


def probe_duration(path: str | Path) -> float:
    """Длительность медиа в секундах (0.0 при ошибке)."""
    try:
        out = subprocess.run(
            [
                _ffprobe_bin(),
                "-v", "quiet",
                "-print_format", "json",
                "-show_format",
                str(path),
            ],
            capture_output=True, text=True, check=True,
        )
        data = json.loads(out.stdout)
        return float(data.get("format", {}).get("duration", 0.0))
    except Exception:
        return 0.0


def extract_audio_wav(src: str | Path, dst: str | Path | None = None) -> Path:
    """Сконвертировать любой источник в wav 16kHz mono (для ASR)."""
    src = Path(src)
    dst = Path(dst) if dst else storage.tmp_dir() / f"{src.stem}_16k.wav"
    subprocess.run(
        [
            settings.media.ffmpeg_path, "-y",
            "-i", str(src),
            "-ac", "1", "-ar", "16000",
            "-vn",
            str(dst),
        ],
        capture_output=True, text=True, check=True,
    )
    return dst


def split_audio(src: str | Path, chunk_seconds: int) -> list[tuple[Path, float]]:
    """Нарезать аудио на куски. Возвращает [(путь_куска, смещение_в_секундах)].

    Если длительность <= chunk_seconds, возвращает один кусок со смещением 0.
    """
    src = Path(src)
    duration = probe_duration(src)
    if duration <= chunk_seconds:
        return [(src, 0.0)]

    chunks: list[tuple[Path, float]] = []
    offset = 0.0
    idx = 0
    out_dir = storage.tmp_dir()
    while offset < duration:
        chunk_path = out_dir / f"{src.stem}_chunk{idx:03d}.wav"
        subprocess.run(
            [
                settings.media.ffmpeg_path, "-y",
                "-ss", str(offset),
                "-t", str(chunk_seconds),
                "-i", str(src),
                "-ac", "1", "-ar", "16000", "-vn",
                str(chunk_path),
            ],
            capture_output=True, text=True, check=True,
        )
        chunks.append((chunk_path, offset))
        offset += chunk_seconds
        idx += 1
    return chunks
