"""Юнит-тесты: парсер таймкодов ASR, извлечение JSON, экспорт."""

from __future__ import annotations

import pytest
import httpx

from app.services.openrouter_asr import _parse_transcript, _ts_to_seconds
from app.services import dify_client
from app.services.dify_client import run_command, _run_streaming, safe_json_loads
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


def test_parse_transcript_splits_merged_speakers_on_one_line():
    # Несколько говорящих в одной строке -> отдельные сегменты (ТЗ 1).
    text = "[00:11] Спикер 2: Да. Спикер 1: Вот по нему. Спикер 3: Добрый день."
    segs = _parse_transcript(text, offset=0.0, chunk_end=60.0)
    assert [s.speaker for s in segs] == ["Спикер 2", "Спикер 1", "Спикер 3"]
    assert [s.text for s in segs] == ["Да.", "Вот по нему.", "Добрый день."]


def test_parse_transcript_speaker_line_without_timecode_starts_new_segment():
    # Реплика нового спикера без таймкода не должна склеиваться с предыдущей.
    text = "[00:00] Спикер 1: привет\nСпикер 2: здравствуйте"
    segs = _parse_transcript(text, offset=0.0, chunk_end=30.0)
    assert len(segs) == 2
    assert segs[1].speaker == "Спикер 2" and segs[1].text == "здравствуйте"


def test_parse_transcript_continuation_line_glued():
    # Строка-продолжение (без таймкода и без метки) приклеивается к предыдущей.
    text = "[00:00] Спикер 1: начало\nпродолжение реплики"
    segs = _parse_transcript(text, offset=0.0, chunk_end=30.0)
    assert len(segs) == 1
    assert segs[0].text == "начало продолжение реплики"


def test_password_hash_roundtrip():
    from app.services.auth import hash_password, verify_password

    stored = hash_password("s3cret")
    assert stored != "s3cret"
    assert verify_password("s3cret", stored)
    assert not verify_password("wrong", stored)
    assert not verify_password("s3cret", "garbage")


def test_role_permissions():
    from app.services import auth

    assert auth.has_permission("admin", "users.manage")
    assert auth.has_permission("staff", "upload")
    assert not auth.has_permission("head", "upload")          # глава — только просмотр
    assert not auth.has_permission("executor", "library.view")  # исполнитель — только свои поручения
    assert auth.has_permission("executor", "tasks.execute")


def test_task_belongs_to_matches_by_name():
    from types import SimpleNamespace
    from app.services.auth import task_belongs_to

    principal = SimpleNamespace(full_name="Иванов И.И.", username="ivanov")
    assert task_belongs_to(SimpleNamespace(responsible="Иванов И.И.", max_username=""), principal)
    assert not task_belongs_to(SimpleNamespace(responsible="Петров П.П.", max_username=""), principal)
    assert task_belongs_to(SimpleNamespace(responsible="", max_username="ivanov"), principal)


def test_safe_json_loads_plain():
    assert safe_json_loads('{"a": 1}') == {"a": 1}


def test_safe_json_loads_fenced():
    assert safe_json_loads('```json\n{"a": 1}\n```') == {"a": 1}


def test_safe_json_loads_embedded():
    assert safe_json_loads('Вот результат: {"a": 1} конец') == {"a": 1}


@pytest.mark.anyio
async def test_run_streaming_reads_error_body_before_raise():
    transport = httpx.MockTransport(
        lambda request: httpx.Response(400, json={"error": "bad request"}, request=request)
    )
    async with httpx.AsyncClient(transport=transport, base_url="https://dify.example") as client:
        with pytest.raises(httpx.HTTPStatusError) as exc_info:
            await _run_streaming(client, {"query": "x"})

    assert "bad request" in exc_info.value.response.text


@pytest.mark.anyio
async def test_run_command_omits_empty_conversation_id(monkeypatch):
    captured: dict = {}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

    async def fake_blocking(client, payload):
        captured.update(payload)
        return dify_client.DifyResult(answer="{}")

    monkeypatch.setattr(dify_client.settings.dify, "app_api_key", "test-key")
    monkeypatch.setattr(dify_client.settings.dify, "response_mode", "blocking")
    monkeypatch.setattr(dify_client.httpx, "AsyncClient", FakeClient)
    monkeypatch.setattr(dify_client, "_run_blocking", fake_blocking)

    await run_command("Извлечение протокола", "текст", conversation_id="")

    assert "conversation_id" not in captured


def test_export_all_formats(tmp_path, monkeypatch):
    # Перенаправляем экспорт во временную папку.
    monkeypatch.setattr(exporter.storage, "exports_dir", lambda: tmp_path)
    md = "# Заголовок\n\nТекст по-русски.\n\n| A | B |\n|---|---|\n| 1 | 2 |"
    for fmt in ("md", "txt", "json", "docx", "pdf"):
        path = exporter.render(md, {"k": "v"}, fmt, "test")
        assert path.is_file() and path.stat().st_size > 0
