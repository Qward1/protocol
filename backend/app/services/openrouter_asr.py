"""Распознавание речи через OpenRouter (мультимодальная модель с аудио-входом).

По ТЗ: для задач распознавания речи используется модель из OpenRouter
(по умолчанию google/gemini-2.5-flash). Аудио передаётся как content-part
`input_audio` (base64) в chat-completions, модель возвращает дословный транскрипт
с тайм-кодами [мм:сс] и метками говорящих.

Длинные файлы режутся на чанки (media.split_audio); тайм-коды каждого чанка
сдвигаются на его смещение, после чего сегменты склеиваются в сквозную дорожку.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
from pathlib import Path
import re

import httpx

from app.config import settings
from app.core import prompts
from app.logging_config import get_logger
from app.services import media

log = get_logger("asr")

# [мм:сс] Спикер N: текст   |   [чч:мм:сс] текст
_LINE_RE = re.compile(
    r"^\s*\[(?P<ts>\d{1,2}:\d{2}(?::\d{2})?)\]\s*"
    r"(?:(?P<speaker>[^:]{1,40}):\s*)?(?P<text>.+)$"
)


@dataclass
class AsrSegment:
    start: float
    end: float
    speaker: str
    text: str


def _ts_to_seconds(ts: str) -> float:
    parts = [int(p) for p in ts.split(":")]
    if len(parts) == 2:
        m, s = parts
        return m * 60 + s
    h, m, s = parts
    return h * 3600 + m * 60 + s


def _audio_format(path: Path) -> str:
    return path.suffix.lower().lstrip(".") or "wav"


def _b64_audio(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")


def _parse_transcript(text: str, offset: float, chunk_end: float) -> list[AsrSegment]:
    """Распарсить текстовый ответ модели в сегменты со сдвигом по offset.

    chunk_end — абсолютное время конца чанка (offset + длительность), чтобы
    корректно проставить end последнего сегмента.
    """
    segments: list[AsrSegment] = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        m = _LINE_RE.match(line)
        if not m:
            # строка без тайм-кода — приклеиваем к предыдущему сегменту
            if segments:
                segments[-1].text += " " + line
            continue
        start = _ts_to_seconds(m.group("ts")) + offset
        segments.append(
            AsrSegment(
                start=start,
                end=start,  # уточняется ниже по следующему сегменту
                speaker=(m.group("speaker") or "").strip(),
                text=m.group("text").strip(),
            )
        )

    # Фоллбэк: модель не вернула тайм-коды — один сегмент на весь чанк.
    if not segments and text.strip():
        return [AsrSegment(start=offset, end=chunk_end, speaker="", text=text.strip())]

    # end = начало следующего сегмента; у последнего — конец чанка.
    for i in range(len(segments) - 1):
        segments[i].end = segments[i + 1].start
    if segments:
        segments[-1].end = max(segments[-1].start, chunk_end)
    return segments


async def _transcribe_chunk(
    client: httpx.AsyncClient, path: Path, offset: float, chunk_end: float
) -> list[AsrSegment]:
    cfg = settings.openrouter
    part_type = cfg.audio_part_type  # обычно "input_audio"
    payload = {
        "model": cfg.asr_model,
        "modalities": ["text"],
        "messages": [
            {"role": "system", "content": prompts.asr_system_prompt(cfg.language, cfg.enable_diarization)},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompts.ASR_USER_INSTRUCTION},
                    {
                        "type": part_type,
                        part_type: {"data": _b64_audio(path), "format": _audio_format(path)},
                    },
                ],
            },
        ],
    }
    resp = await client.post(
        f"{cfg.base_url}/chat/completions",
        headers={
            "Authorization": f"Bearer {cfg.api_key}",
            "Content-Type": "application/json",
            # OpenRouter рекомендует указывать источник запроса:
            "X-Title": "Digital Office",
        },
        json=payload,
    )
    resp.raise_for_status()
    data = resp.json()
    content = data["choices"][0]["message"]["content"]
    if isinstance(content, list):  # некоторые модели отдают content частями
        content = "".join(part.get("text", "") for part in content if isinstance(part, dict))
    return _parse_transcript(content or "", offset, chunk_end)


async def transcribe_file(source_path: str | Path) -> list[AsrSegment]:
    """Главная точка входа: путь к аудио/видео -> список сегментов.

    Видео и любые форматы предварительно конвертируются в wav 16k mono,
    затем при необходимости режутся на чанки.
    """
    cfg = settings.openrouter
    source_path = Path(source_path)

    if not cfg.api_key:
        raise RuntimeError("OpenRouter api_key не задан (config.yaml → openrouter.api_key)")

    # Нормализуем в wav 16k mono (заодно извлекаем аудио из видео).
    wav = media.extract_audio_wav(source_path)
    total = media.probe_duration(wav)
    chunks = media.split_audio(wav, cfg.chunk_seconds)
    log.info("ASR: %s -> %d чанк(ов), длительность %.0fс", source_path.name, len(chunks), total)

    all_segments: list[AsrSegment] = []
    async with httpx.AsyncClient(timeout=cfg.request_timeout) as client:
        for idx, (chunk_path, offset) in enumerate(chunks):
            chunk_end = min(offset + cfg.chunk_seconds, total) if total else offset + cfg.chunk_seconds
            segs = await _transcribe_chunk(client, chunk_path, offset, chunk_end)
            log.info("ASR: чанк %d/%d -> %d сегментов", idx + 1, len(chunks), len(segs))
            all_segments.extend(segs)

    all_segments.sort(key=lambda s: s.start)
    return all_segments
