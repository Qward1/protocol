"""Smoke-тесты API через TestClient (с lifespan для создания таблиц)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.db import SessionLocal
from app.models import Protocol, Task


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_health(client):
    data = client.get("/api/health").json()
    assert data["status"] == "ok"
    assert "ffmpeg" in data and "asr_model" in data


def test_empty_collections(client):
    assert client.get("/api/transcriptions").json() == []
    assert client.get("/api/tasks").json() == []
    lib = client.get("/api/library").json()
    assert lib == {"protocols": [], "transcriptions": []}


def test_search_local_fallback(client):
    # Без Dify уходит в локальный фоллбэк, не падает.
    res = client.post("/api/search", json={"query": "бюджет"})
    assert res.status_code == 200
    assert "hits" in res.json()


def test_upload_validation_rejects_bad_ext(client):
    res = client.post(
        "/api/transcriptions",
        files={"file": ("notes.txt", b"hello", "text/plain")},
    )
    assert res.status_code == 415


def test_transcription_create_and_delete(client):
    res = client.post(
        "/api/transcriptions",
        files={"file": ("clip.mp3", b"\x00\x01\x02\x03", "audio/mpeg")},
    )
    assert res.status_code == 200
    tid = res.json()["id"]

    # запись появилась в списке
    ids = [t["id"] for t in client.get("/api/transcriptions").json()]
    assert tid in ids

    # удаление
    assert client.delete(f"/api/transcriptions/{tid}").status_code == 200
    assert client.get(f"/api/transcriptions/{tid}").status_code == 404


def test_export_missing_object_404(client):
    res = client.post("/api/export", json={"object_type": "protocol", "object_id": "x", "fmt": "md"})
    assert res.status_code == 404


def test_send_task_to_max_disabled(client):
    with SessionLocal() as db:
        protocol = Protocol(title="Тест")
        db.add(protocol)
        db.commit()
        db.refresh(protocol)
        task = Task(protocol_id=protocol.id, assignment="Проверить отправку")
        db.add(task)
        db.commit()
        db.refresh(task)
        task_id = task.id

    res = client.post(f"/api/tasks/{task_id}/send-max")
    assert res.status_code == 400
    assert "MAX отключён" in res.json()["detail"]
