"""Работа с медиа через ffmpeg: длительность, извлечение/нормализация аудио, нарезка."""

from __future__ import annotations

import json
from pathlib import Path
import re
import shutil
import subprocess

from app.config import settings
from app.services import storage

VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v"}
AUDIO_EXTS = {".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac", ".opus"}


def ffmpeg_bin() -> str:
    """Путь к ffmpeg: конфиг/системный PATH или bundled binary из imageio-ffmpeg."""
    configured = settings.media.ffmpeg_path
    if Path(configured).is_file() or shutil.which(configured):
        return configured

    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:  # noqa: BLE001 - вернём понятную ошибку вызывающему коду
        raise FileNotFoundError(
            "ffmpeg не найден. Установите ffmpeg в PATH, задайте media.ffmpeg_path "
            "или установите backend-зависимости: python -m pip install -r requirements.txt"
        ) from exc


def ffmpeg_available() -> bool:
    try:
        return Path(ffmpeg_bin()).is_file() or shutil.which(ffmpeg_bin()) is not None
    except Exception:
        return False


def _ffprobe_bin() -> str | None:
    """Путь к ffprobe, если он доступен. Bundled imageio-ffmpeg обычно даёт только ffmpeg."""
    ff = settings.media.ffmpeg_path
    candidate = ff.replace("ffmpeg", "ffprobe") if "ffmpeg" in ff else "ffprobe"
    if Path(candidate).is_file() or shutil.which(candidate):
        return candidate
    return None


def is_video(path: str | Path) -> bool:
    return Path(path).suffix.lower() in VIDEO_EXTS


def probe_duration(path: str | Path) -> float:
    """Длительность медиа в секундах (0.0 при ошибке)."""
    try:
        ffprobe = _ffprobe_bin()
        if ffprobe:
            out = subprocess.run(
                [
                    ffprobe,
                    "-v", "quiet",
                    "-print_format", "json",
                    "-show_format",
                    str(path),
                ],
                capture_output=True, text=True, check=True,
            )
            data = json.loads(out.stdout)
            return float(data.get("format", {}).get("duration", 0.0))

        out = subprocess.run(
            [ffmpeg_bin(), "-hide_banner", "-i", str(path)],
            capture_output=True, text=True, check=False,
        )
        match = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", out.stderr)
        if not match:
            return 0.0
        hours, minutes, seconds = match.groups()
        return int(hours) * 3600 + int(minutes) * 60 + float(seconds)
    except Exception:
        return 0.0


def extract_audio_wav(src: str | Path, dst: str | Path | None = None) -> Path:
    """Сконвертировать любой источник в wav 16kHz mono (для ASR)."""
    src = Path(src)
    dst = Path(dst) if dst else storage.tmp_dir() / f"{src.stem}_16k.wav"
    subprocess.run(
        [
            ffmpeg_bin(), "-y",
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
                ffmpeg_bin(), "-y",
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
