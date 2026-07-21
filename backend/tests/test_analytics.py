"""Аналитический дашборд (п. 4.5.1): KPI, фильтры, подсветка.

Чистые функции агрегации тестируем на in-memory ``Task`` (детерминированно,
без БД); эндпоинт — через TestClient с уникальным маркером темы, чтобы срез не
зависел от данных других тестов (общая тестовая БД на сессию).
"""

from __future__ import annotations

from datetime import datetime, timedelta
import uuid

import pytest
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import (
    TASK_STATUS_DONE,
    TASK_STATUS_NEW,
    TASK_STATUS_REVIEW,
    Protocol,
    Task,
)
from app.services import analytics

NOW = datetime(2026, 7, 21, 12, 0, 0)
PAST = NOW - timedelta(days=3)
FUTURE = NOW + timedelta(days=3)


def _task(**kw) -> Task:
    kw.setdefault("assignment", "A")
    return Task(protocol_id="p", **kw)


def test_compute_kpis_is_a_partition():
    tasks = [
        _task(status=TASK_STATUS_DONE),
        _task(status=TASK_STATUS_NEW, deadline_at=PAST),      # overdue
        _task(status=TASK_STATUS_REVIEW, deadline_at=PAST),   # overdue
        _task(status=TASK_STATUS_NEW, deadline_at=FUTURE),    # in_work
        _task(status=TASK_STATUS_NEW),                        # in_work (нет срока)
    ]
    kpis = analytics.compute_kpis(tasks, NOW)
    assert kpis == {"total": 5, "in_work": 2, "done": 1, "overdue": 2}
    assert kpis["total"] == kpis["in_work"] + kpis["done"] + kpis["overdue"]


def test_done_task_is_never_overdue():
    done_past = _task(status=TASK_STATUS_DONE, deadline_at=PAST)
    assert analytics.is_overdue(done_past, NOW) is False


def test_task_without_deadline_is_not_overdue():
    assert analytics.is_overdue(_task(status=TASK_STATUS_NEW), NOW) is False


def test_compute_highlights_selects_overdue_and_active_elevated():
    overdue = _task(status=TASK_STATUS_NEW, deadline_at=PAST, priority="Обычный")
    critical_active = _task(status=TASK_STATUS_NEW, deadline_at=FUTURE, priority="Критический")
    critical_done = _task(status=TASK_STATUS_DONE, priority="Критический")
    normal_active = _task(status=TASK_STATUS_NEW, priority="Обычный")

    highlights = analytics.compute_highlights(
        [overdue, critical_active, critical_done, normal_active], NOW
    )
    assert overdue in highlights["overdue"]
    assert critical_active not in highlights["overdue"]
    assert critical_active in highlights["priority"]
    assert critical_done not in highlights["priority"]  # выполненные не подсвечиваем
    assert normal_active not in highlights["priority"]


# --- Эндпоинт ---

@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


# Общая тестовая БД живёт всю сессию; чистим за собой, чтобы не сломать тесты,
# рассчитывающие на пустую таблицу поручений (test_api.test_empty_collections).
_created_protocols: list[str] = []


@pytest.fixture(scope="module", autouse=True)
def _cleanup_created_tasks():
    yield
    with SessionLocal() as db:
        for pid in _created_protocols:
            protocol = db.get(Protocol, pid)
            if protocol:
                db.delete(protocol)  # поручения — каскадом
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


def test_dashboard_endpoint_kpis_highlights_and_theme_filter(client):
    marker = f"kpi-{uuid.uuid4().hex[:8]}"
    _persist(assignment="in-work", responsible="Аналитик-1", theme=marker,
             priority="Высокий", status=TASK_STATUS_NEW, deadline_at=datetime(2999, 1, 1))
    _persist(assignment="done", responsible="Аналитик-2", theme=marker,
             priority="Обычный", status=TASK_STATUS_DONE)
    _persist(assignment="overdue", responsible="Аналитик-1", theme=marker,
             priority="Обычный", status=TASK_STATUS_NEW, deadline_at=datetime(2020, 1, 1))

    res = client.get("/api/analytics/dashboard", params={"theme": marker})
    assert res.status_code == 200
    body = res.json()

    # KPI-разбиение по срезу marker детерминировано.
    assert body["kpis"] == {"total": 3, "in_work": 1, "done": 1, "overdue": 1}
    # Подсветка: один просроченный + один активный высокоприоритетный.
    assert len(body["highlights"]["overdue"]) == 1
    overdue_task = body["highlights"]["overdue"][0]
    assert overdue_task["assignment"] == "overdue"
    # Поля, на которых фронт строит подсветку и переход «к карточке» (4.5.4).
    assert overdue_task["id"] and overdue_task["deadline_at"] is not None
    assert len(body["highlights"]["priority"]) == 1
    priority_task = body["highlights"]["priority"][0]
    assert priority_task["assignment"] == "in-work"
    assert priority_task["priority"] == "Высокий"
    # Значения фильтров включают маркер темы.
    assert marker in body["filter_options"]["themes"]
    assert "Высокий" in body["filter_options"]["priorities"]


def test_dashboard_endpoint_filters_by_responsible_and_status(client):
    marker = f"kpi-{uuid.uuid4().hex[:8]}"
    _persist(assignment="a", responsible="Один", theme=marker, status=TASK_STATUS_NEW)
    _persist(assignment="b", responsible="Один", theme=marker, status=TASK_STATUS_DONE)
    _persist(assignment="c", responsible="Другой", theme=marker, status=TASK_STATUS_NEW)

    res = client.get("/api/analytics/dashboard", params={"theme": marker, "responsible": "Один"})
    assert res.json()["kpis"]["total"] == 2

    res = client.get(
        "/api/analytics/dashboard",
        params={"theme": marker, "responsible": "Один", "status": TASK_STATUS_DONE},
    )
    assert res.json()["kpis"]["total"] == 1


def test_dashboard_rejects_bad_period(client):
    res = client.get("/api/analytics/dashboard", params={"period_from": "не-дата"})
    assert res.status_code == 422
