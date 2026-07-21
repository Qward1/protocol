"""Утренняя справка (п. 4.5.2): детерминированность, соответствие данным,
изменения с прошлой справки, наличие среза, выгрузка. Без LLM.
"""

from __future__ import annotations

from datetime import datetime, timedelta
import uuid

import pytest
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import (
    TASK_PRIORITY_CRITICAL,
    TASK_STATUS_DONE,
    TASK_STATUS_NEW,
    MorningBrief,
    Protocol,
    Task,
)
from app.services import analytics, morning_brief

NOW = datetime(2026, 7, 21, 8, 0, 0)


# Общая тестовая БД: чистим созданные поручения/справки за собой.
_created_protocols: list[str] = []
_created_briefs: list[str] = []


@pytest.fixture(scope="module", autouse=True)
def _cleanup():
    yield
    with SessionLocal() as db:
        for pid in _created_protocols:
            protocol = db.get(Protocol, pid)
            if protocol:
                db.delete(protocol)
        for bid in _created_briefs:
            brief = db.get(MorningBrief, bid)
            if brief:
                db.delete(brief)
        db.commit()
    _created_protocols.clear()
    _created_briefs.clear()


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _protocol(db) -> Protocol:
    protocol = Protocol(title="P")
    db.add(protocol)
    db.commit()
    db.refresh(protocol)
    _created_protocols.append(protocol.id)
    return protocol


def test_build_brief_matches_registry_and_is_deterministic():
    with SessionLocal() as db:
        protocol = _protocol(db)
        db.add_all([
            Task(protocol_id=protocol.id, assignment="в работе", status=TASK_STATUS_NEW,
                 deadline_at=datetime(2999, 1, 1)),
            Task(protocol_id=protocol.id, assignment="исполнено", status=TASK_STATUS_DONE),
            Task(protocol_id=protocol.id, assignment="просрочено", status=TASK_STATUS_NEW,
                 deadline="01.01.2020", deadline_at=datetime(2020, 1, 1)),
            Task(protocol_id=protocol.id, assignment="крит-скоро", status=TASK_STATUS_NEW,
                 priority=TASK_PRIORITY_CRITICAL, deadline="22.07.2026",
                 deadline_at=NOW + timedelta(days=1)),
        ])
        db.commit()

        first = analytics.build_brief(db, NOW)
        second = analytics.build_brief(db, NOW)

    # Детерминированность: тот же вход -> тот же снимок (кроме несортированных полей).
    assert first["kpis"] == second["kpis"]
    assert first["overdue"] == second["overdue"]
    assert first["priority_soon"] == second["priority_soon"]

    # Соответствие данным реестра.
    assert first["kpis"]["total"] >= 4
    assert first["as_of"] == NOW.isoformat()
    overdue_names = {t["assignment"] for t in first["overdue"]}
    assert "просрочено" in overdue_names
    soon_names = {t["assignment"] for t in first["priority_soon"]}
    assert "крит-скоро" in soon_names
    # Приближающийся срок — только активные приоритетные с близким сроком.
    assert "в работе" not in soon_names


def test_brief_changes_since_previous():
    marker = f"chg-{uuid.uuid4().hex[:6]}"
    with SessionLocal() as db:
        protocol = _protocol(db)
        t1 = Task(protocol_id=protocol.id, assignment=f"{marker}-1", status=TASK_STATUS_NEW)
        db.add(t1)
        db.commit()
        first = morning_brief.generate_and_store(db, as_of=NOW)
        _created_briefs.append(first.id)

    # Первая справка ни с чем не сравнивается.
    import json

    payload1 = json.loads(first.payload_json)
    assert payload1["changes"]["first"] is True

    with SessionLocal() as db:
        protocol_id = _created_protocols[-1]
        # Одно новое поручение + одно исполненное с прошлой справки.
        db.add(Task(protocol_id=protocol_id, assignment=f"{marker}-2", status=TASK_STATUS_NEW))
        prev = db.query(Task).filter(Task.assignment == f"{marker}-1").first()
        prev.status = TASK_STATUS_DONE
        db.commit()
        second = morning_brief.generate_and_store(db, as_of=NOW + timedelta(days=1))
        _created_briefs.append(second.id)

    payload2 = json.loads(second.payload_json)
    changes = payload2["changes"]
    assert changes["first"] is False
    assert changes["new_tasks"] >= 1
    assert changes["newly_done"] >= 1


def test_brief_endpoints_generate_and_latest(client):
    marker = f"api-{uuid.uuid4().hex[:6]}"
    with SessionLocal() as db:
        protocol = _protocol(db)
        db.add(Task(protocol_id=protocol.id, assignment=marker, status=TASK_STATUS_NEW,
                    deadline_at=datetime(2020, 1, 1)))
        db.commit()

    res = client.post("/api/analytics/brief")
    assert res.status_code == 200
    body = res.json()
    _created_briefs.append(body["id"])
    # Срез (дата/время) присутствует — требование 4.5.5.
    assert body["as_of"]
    assert body["kpis"]["total"] >= 1

    latest = client.get("/api/analytics/brief/latest")
    assert latest.status_code == 200
    assert latest.json()["id"] == body["id"]

    listing = client.get("/api/analytics/briefs")
    assert listing.status_code == 200
    assert any(item["id"] == body["id"] for item in listing.json())


def test_brief_export_docx(client):
    with SessionLocal() as db:
        protocol = _protocol(db)
        db.add(Task(protocol_id=protocol.id, assignment="экспорт-справки", status=TASK_STATUS_NEW,
                    deadline="01.01.2020", deadline_at=datetime(2020, 1, 1)))
        db.commit()
        brief = morning_brief.generate_and_store(db)
        _created_briefs.append(brief.id)
        brief_id = brief.id

    for fmt in ("md", "docx"):
        res = client.post("/api/export", json={"object_type": "brief", "object_id": brief_id, "fmt": fmt})
        assert res.status_code == 200, fmt
    # Несуществующая справка -> 404.
    assert client.post(
        "/api/export", json={"object_type": "brief", "object_id": "no-such", "fmt": "md"}
    ).status_code == 404


def test_brief_latest_null_when_none(client):
    """Пустая история -> latest отдаёт null (а не 500/404)."""
    with SessionLocal() as db:
        db.query(MorningBrief).delete()
        db.commit()
    res = client.get("/api/analytics/brief/latest")
    assert res.status_code == 200
    assert res.json() is None
