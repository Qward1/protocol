"""Юнит-тесты: парсер таймкодов ASR, извлечение JSON, экспорт."""

from __future__ import annotations

from app.services.openrouter_asr import _parse_transcript, _ts_to_seconds
from app.services.dify_client import _safe_json_loads
from app.services import exporter


def test_ts_to_seconds():
    assert _ts_to_seconds("00:05") == 5
    assert _ts_to_seconds("01:30") == 90
    assert _ts_to_seconds("1:00:00") == 3600


def test_parse_transcript_with_speakers():
    text = "[00:00] Спикер 1: Привет\n[00:05] Спикер 2: Здравствуйте"
    segs = _parse_transcript(text, offset=0.0, chunk_end=10.0)
    assert len(segs) == 2
    assert segs[0].speaker == "Спикер 1"
    assert segs[0].start == 0.0
    assert segs[0].end == 5.0  # начало следующего
    assert segs[1].end == 10.0  # конец чанка


def test_parse_transcript_offset():
    segs = _parse_transcript("[00:10] текст", offset=600.0, chunk_end=1200.0)
    assert segs[0].start == 610.0


def test_parse_transcript_fallback_no_timecodes():
    segs = _parse_transcript("просто текст без таймкодов", offset=5.0, chunk_end=15.0)
    assert len(segs) == 1
    assert segs[0].start == 5.0 and segs[0].end == 15.0


def test_safe_json_loads_plain():
    assert _safe_json_loads('{"a": 1}') == {"a": 1}


def test_safe_json_loads_fenced():
    assert _safe_json_loads('```json\n{"a": 1}\n```') == {"a": 1}


def test_safe_json_loads_embedded():
    assert _safe_json_loads('Вот результат: {"a": 1} конец') == {"a": 1}


def test_export_all_formats(tmp_path, monkeypatch):
    # Перенаправляем экспорт во временную папку.
    monkeypatch.setattr(exporter.storage, "exports_dir", lambda: tmp_path)
    md = "# Заголовок\n\nТекст по-русски.\n\n| A | B |\n|---|---|\n| 1 | 2 |"
    for fmt in ("md", "txt", "json", "docx", "pdf"):
        path = exporter.render(md, {"k": "v"}, fmt, "test")
        assert path.is_file() and path.stat().st_size > 0
