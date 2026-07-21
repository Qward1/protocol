"""Рейтинг исполнителей и CRUD правил начисления баллов (п. 4.5.3).

Подсчёт баллов проверяем на in-memory объектах (детерминированно); CRUD и
пересчёт рейтинга при изменении правила — через API.
"""

from __future__ import annotations

from datetime import datetime
import uuid

import pytest
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import (
    TASK_PRIORITY_CRITICAL,
    TASK_STATUS_DONE,
    TASK_STATUS_NEW,
    Protocol,
    RatingRule,
    Task,
)
from app.services import analytics

NOW = datetime(2026, 7, 21, 12, 0, 0)
DEADLINE = datetime(2026, 7, 20, 12, 0, 0)
CLOSED_ON_TIME = datetime(2026, 7, 20, 10, 0, 0)
PAST = datetime(2020, 1, 1)


def _task(responsible: str, **kw) -> Task:
    kw.setdefault("assignment", "A")
    return Task(protocol_id="p", responsible=responsible, **kw)


def _rule(condition: str, points: float, enabled: bool = True) -> RatingRule:
    return RatingRule(condition=condition, points=points, enabled=enabled)


def test_compute_ratings_sums_points_with_breakdown():
    tasks = [
        _task("Иванов", status=TASK_STATUS_DONE, deadline_at=DEADLINE, closed_at=CLOSED_ON_TIME),
        _task("Иванов", status=TASK_STATUS_NEW, deadline_at=PAST),  # overdue
        _task("Петров", status=TASK_STATUS_NEW),
    ]
    rules = [_rule("done_on_time", 10), _rule("overdue_open", -5)]
    ratings = analytics.compute_ratings(tasks, rules, NOW)

    by_name = {r["responsible"]: r for r in ratings}
    assert by_name["Иванов"]["score"] == 5.0     # +10 в срок, -5 просрочено
    assert by_name["Петров"]["score"] == 0.0
    # Детализация со ссылками на конкретные поручения.
    conds = {b["condition"]: b for b in by_name["Иванов"]["breakdown"]}
    assert conds["done_on_time"]["count"] == 1
    assert conds["overdue_open"]["points"] == -5.0
    assert len(conds["done_on_time"]["task_ids"]) == 1
    # Сортировка по убыванию баллов.
    assert ratings[0]["responsible"] == "Иванов"


def test_done_priority_condition_matches_elevated_done():
    tasks = [_task("Сидоров", status=TASK_STATUS_DONE, priority=TASK_PRIORITY_CRITICAL)]
    ratings = analytics.compute_ratings(tasks, [_rule("done_priority", 5)], NOW)
    assert ratings[0]["score"] == 5.0


def test_disabled_rule_is_not_counted():
    tasks = [_task("Иванов", status=TASK_STATUS_DONE, deadline_at=DEADLINE, closed_at=CLOSED_ON_TIME)]
    ratings = analytics.compute_ratings(tasks, [_rule("done_on_time", 10, enabled=False)], NOW)
    assert ratings[0]["score"] == 0.0


def test_changing_points_recomputes_score():
    tasks = [_task("Иванов", status=TASK_STATUS_DONE, deadline_at=DEADLINE, closed_at=CLOSED_ON_TIME)]
    rule = _rule("done_on_time", 10)
    assert analytics.compute_ratings(tasks, [rule], NOW)[0]["score"] == 10.0
    rule.points = 20
    assert analytics.compute_ratings(tasks, [rule], NOW)[0]["score"] == 20.0


# --- CRUD API ---

@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


_created_protocols: list[str] = []


@pytest.fixture(scope="module", autouse=True)
def _cleanup():
    yield
    with SessionLocal() as db:
        for pid in _created_protocols:
            protocol = db.get(Protocol, pid)
            if protocol:
                db.delete(protocol)
        db.commit()
    _created_protocols.clear()


def _persist(**kw) -> str:
    with SessionLocal() as db:
        protocol = Protocol(title="P")
        db.add(protocol)
        db.commit()
        db.refresh(protocol)
        _created_protocols.append(protocol.id)
        task = Task(protocol_id=protocol.id, **kw)
        db.add(task)
        db.commit()
        db.refresh(task)
        return task.id


def test_rules_are_seeded_with_condition_catalog(client):
    body = client.get("/api/rating-rules").json()
    catalog = {c["key"] for c in body["conditions"]}
    assert catalog == {"done_on_time", "done_late", "overdue_open", "done_priority"}
    # Дефолтные правила посеяны при старте.
    assert {r["condition"] for r in body["rules"]} == catalog
    assert all("label" in r for r in body["rules"])


def test_create_rule_rejects_duplicate_and_unknown(client):
    dup = client.post("/api/rating-rules", json={"condition": "done_on_time", "points": 1})
    assert dup.status_code == 409  # уже засеяно
    bad = client.post("/api/rating-rules", json={"condition": "выдумка", "points": 1})
    assert bad.status_code == 422


def test_update_and_404(client):
    rules = client.get("/api/rating-rules").json()["rules"]
    rid = next(r["id"] for r in rules if r["condition"] == "overdue_open")
    res = client.patch(f"/api/rating-rules/{rid}", json={"points": -9, "enabled": False})
    assert res.status_code == 200
    assert res.json()["points"] == -9 and res.json()["enabled"] is False
    assert client.patch("/api/rating-rules/nope", json={"points": 1}).status_code == 404


def test_delete_then_recreate(client):
    rules = client.get("/api/rating-rules").json()["rules"]
    rid = next(r["id"] for r in rules if r["condition"] == "done_late")
    assert client.delete(f"/api/rating-rules/{rid}").status_code == 200
    recreated = client.post("/api/rating-rules", json={"condition": "done_late", "points": 7})
    assert recreated.status_code == 200
    assert recreated.json()["points"] == 7


def test_dashboard_rating_recomputes_when_rule_changes(client):
    responsible = f"Рейтинг-{uuid.uuid4().hex[:6]}"
    _persist(assignment="в срок", responsible=responsible, status=TASK_STATUS_DONE,
             deadline_at=DEADLINE, closed_at=CLOSED_ON_TIME)

    rules = client.get("/api/rating-rules").json()["rules"]
    rid = next(r["id"] for r in rules if r["condition"] == "done_on_time")

    def score() -> float:
        ratings = client.get("/api/analytics/dashboard", params={"responsible": responsible}).json()["ratings"]
        return next(r["score"] for r in ratings if r["responsible"] == responsible)

    client.patch(f"/api/rating-rules/{rid}", json={"points": 10, "enabled": True})
    before = score()
    client.patch(f"/api/rating-rules/{rid}", json={"points": 20})
    after = score()
    assert before == 10.0
    assert after == 20.0
