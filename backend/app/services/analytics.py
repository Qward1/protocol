"""Детерминированная агрегация таблицы поручений для аналитического дашборда,
рейтинга исполнителей и утренней справки (п. 4.5).

Сквозное требование 4.5.5: все показатели считаются здесь по данным ``Task``
(SQL/Python), без обращений к Dify/LLM. Функции чистые и тестируются напрямую.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy.orm import Query, Session

from app.models import (
    TASK_ELEVATED_PRIORITIES,
    TASK_PRIORITIES,
    TASK_STATUS_DONE,
    TASK_STATUSES,
    RatingRule,
    Task,
    _now,
)

# Окно «приближающегося срока» для приоритетных поручений в утренней справке.
BRIEF_SOON_DAYS = 3

# Фиксированный каталог условий рейтинга (4.5.3): ключ -> формулировка. Все
# условия выводятся детерминированно из полей Task (status/deadline_at/closed_at/
# priority). Заказчик задаёт баллы к этим условиям через UI, не меняя код.
RATING_CONDITIONS: dict[str, str] = {
    "done_on_time": "Исполнено в срок",
    "done_late": "Исполнено с опозданием",
    "overdue_open": "Просрочено (не исполнено)",
    "done_priority": "Исполнено приоритетное",
}

# Дефолтные правила (сеются при пустой таблице; далее правит Заказчик).
DEFAULT_RATING_RULES: tuple[tuple[str, float], ...] = (
    ("done_on_time", 10.0),
    ("done_late", 3.0),
    ("overdue_open", -5.0),
    ("done_priority", 5.0),
)


@dataclass
class TaskFilters:
    """Срез для дашборда/рейтинга. Период — по ``Task.created_at`` (наивный UTC)."""

    period_from: datetime | None = None
    period_to: datetime | None = None
    responsible: str | None = None
    location: str | None = None
    object: str | None = None
    theme: str | None = None
    priority: str | None = None
    status: str | None = None


def apply_filters(query: Query, filters: TaskFilters) -> Query:
    """Навесить активные фильтры на запрос ``Task`` (пустые/None — игнорируются)."""
    if filters.period_from is not None:
        query = query.filter(Task.created_at >= filters.period_from)
    if filters.period_to is not None:
        query = query.filter(Task.created_at <= filters.period_to)
    if filters.responsible:
        query = query.filter(Task.responsible == filters.responsible)
    if filters.location:
        query = query.filter(Task.location == filters.location)
    if filters.object:
        query = query.filter(Task.object == filters.object)
    if filters.theme:
        query = query.filter(Task.theme == filters.theme)
    if filters.priority:
        query = query.filter(Task.priority == filters.priority)
    if filters.status:
        query = query.filter(Task.status == filters.status)
    return query


def filtered_tasks(db: Session, filters: TaskFilters) -> list[Task]:
    """Список поручений под фильтром (детерминированный порядок — по created_at)."""
    return apply_filters(db.query(Task), filters).order_by(Task.created_at.desc()).all()


def is_overdue(task: Task, now: datetime) -> bool:
    """Просрочено: не выполнено и разобранный срок в прошлом (единый критерий 4.5)."""
    return (
        task.status != TASK_STATUS_DONE
        and task.deadline_at is not None
        and task.deadline_at < now
    )


def is_done_on_time(task: Task) -> bool:
    return (
        task.status == TASK_STATUS_DONE
        and task.deadline_at is not None
        and task.closed_at is not None
        and task.closed_at <= task.deadline_at
    )


def is_done_late(task: Task) -> bool:
    return (
        task.status == TASK_STATUS_DONE
        and task.deadline_at is not None
        and task.closed_at is not None
        and task.closed_at > task.deadline_at
    )


def is_elevated(task: Task) -> bool:
    return task.priority in TASK_ELEVATED_PRIORITIES


def compute_kpis(tasks: list[Task], now: datetime) -> dict[str, int]:
    """Ключевые показатели-разбиение: total = in_work + done + overdue.

    Каждое поручение попадает ровно в одну категорию: выполнено / просрочено /
    в работе (не выполнено и срок не прошёл либо не задан)."""
    total = len(tasks)
    done = sum(1 for t in tasks if t.status == TASK_STATUS_DONE)
    overdue = sum(1 for t in tasks if is_overdue(t, now))
    in_work = total - done - overdue
    return {"total": total, "in_work": in_work, "done": done, "overdue": overdue}


# Ранг приоритета для сортировки подсветки (больше = важнее).
_PRIORITY_RANK = {name: i for i, name in enumerate(TASK_PRIORITIES)}


def compute_highlights(tasks: list[Task], now: datetime) -> dict[str, list[Task]]:
    """Просроченные и активные приоритетные поручения для блока подсветки (4.5.4)."""
    overdue = [t for t in tasks if is_overdue(t, now)]
    overdue.sort(key=lambda t: (t.deadline_at or datetime.max))
    priority = [t for t in tasks if is_elevated(t) and t.status != TASK_STATUS_DONE]
    priority.sort(
        key=lambda t: (-_PRIORITY_RANK.get(t.priority, 0), t.deadline_at or datetime.max)
    )
    return {"overdue": overdue, "priority": priority}


def condition_matches(condition: str, task: Task, now: datetime) -> bool:
    """Подходит ли поручение под условие рейтинга (детерминированно по полям Task)."""
    if condition == "done_on_time":
        return is_done_on_time(task)
    if condition == "done_late":
        return is_done_late(task)
    if condition == "overdue_open":
        return is_overdue(task, now)
    if condition == "done_priority":
        return task.status == TASK_STATUS_DONE and is_elevated(task)
    return False


def _person_name(task: Task) -> str:
    return (task.responsible or "").strip() or "Не назначен"


def compute_ratings(tasks: list[Task], rules: list[RatingRule], now: datetime) -> list[dict]:
    """Рейтинг исполнителей по сумме баллов включённых правил (4.5.3).

    Правила складываются по каждому поручению исполнителя; детализация хранит
    ссылки на конкретные поручения, за которые начислены/списаны баллы."""
    active_rules = [r for r in rules if r.enabled]

    by_person: dict[str, list[Task]] = {}
    for task in tasks:
        by_person.setdefault(_person_name(task), []).append(task)

    results: list[dict] = []
    for name, person_tasks in by_person.items():
        breakdown: list[dict] = []
        score = 0.0
        for rule in active_rules:
            matched = [t for t in person_tasks if condition_matches(rule.condition, t, now)]
            if not matched:
                continue
            points = rule.points * len(matched)
            score += points
            breakdown.append({
                "condition": rule.condition,
                "label": RATING_CONDITIONS.get(rule.condition, rule.condition),
                "count": len(matched),
                "points_each": rule.points,
                "points": points,
                "task_ids": [t.id for t in matched],
            })
        results.append({
            "responsible": name,
            "score": score,
            "total_tasks": len(person_tasks),
            "breakdown": breakdown,
        })

    results.sort(key=lambda r: (-r["score"], -r["total_tasks"], r["responsible"]))
    return results


def seed_rating_rules(db: Session) -> None:
    """Посеять дефолтные правила рейтинга, если таблица пуста (идемпотентно)."""
    if db.query(RatingRule).count() > 0:
        return
    for condition, points in DEFAULT_RATING_RULES:
        db.add(RatingRule(condition=condition, points=points, enabled=True))
    db.commit()


def distinct_filter_values(db: Session) -> dict[str, list[str]]:
    """Значения для выпадающих фильтров: distinct по свободнотекстовым срезам."""

    def distinct(column) -> list[str]:
        return sorted({value for (value,) in db.query(column).distinct() if value})

    return {
        "responsibles": distinct(Task.responsible),
        "locations": distinct(Task.location),
        "objects": distinct(Task.object),
        "themes": distinct(Task.theme),
        "priorities": list(TASK_PRIORITIES),
        "statuses": list(TASK_STATUSES),
    }


def dashboard(db: Session, filters: TaskFilters, now: datetime | None = None) -> dict:
    """Собрать данные дашборда под фильтром: KPI, рейтинг, подсветка, фильтры.

    Рейтинг считается по отфильтрованному срезу — «за выбранный период» (4.5.3)."""
    now = now or _now()
    tasks = filtered_tasks(db, filters)
    rules = db.query(RatingRule).all()
    return {
        "now": now,
        "kpis": compute_kpis(tasks, now),
        "ratings": compute_ratings(tasks, rules, now),
        "highlights": compute_highlights(tasks, now),
        "filter_options": distinct_filter_values(db),
    }


# --- Утренняя справка (п. 4.5.2) — детерминированный снимок реестра ---

def _task_brief(task: Task) -> dict:
    """Компактное представление поручения для справки (без обращения к LLM)."""
    return {
        "id": task.id,
        "assignment": task.assignment or "",
        "responsible": task.responsible or "",
        "deadline": task.deadline or "",
        "priority": task.priority or "",
    }


def _compute_changes(previous: dict | None, all_ids, done_ids, overdue_ids) -> dict:
    """Изменения с прошлой справки как разности множеств id (детерминированно)."""
    if not previous:
        return {"since": None, "first": True, "new_tasks": 0, "newly_done": 0, "newly_overdue": 0}
    state = previous.get("state", {})
    prev_all = set(state.get("all_ids", []))
    prev_done = set(state.get("done_ids", []))
    prev_overdue = set(state.get("overdue_ids", []))
    return {
        "since": previous.get("as_of"),
        "first": False,
        "new_tasks": len(set(all_ids) - prev_all),
        "newly_done": len(set(done_ids) - prev_done),
        "newly_overdue": len(set(overdue_ids) - prev_overdue),
    }


def build_brief(db: Session, as_of: datetime, previous_payload: dict | None = None) -> dict:
    """Собрать снимок утренней справки на момент ``as_of`` (наивный UTC).

    Полностью детерминированно по данным ``Task``: счётчики по статусам,
    просроченные, приоритетные с приближающимся сроком, изменения с прошлой
    справки. ``state`` хранит id-множества для расчёта дельты в следующей справке.
    """
    tasks = db.query(Task).order_by(Task.created_at.desc()).all()

    status_counts: dict[str, int] = {status: 0 for status in TASK_STATUSES}
    for task in tasks:
        status_counts[task.status] = status_counts.get(task.status, 0) + 1

    highlights = compute_highlights(tasks, as_of)
    overdue_tasks = highlights["overdue"]

    soon_cutoff = as_of + timedelta(days=BRIEF_SOON_DAYS)
    priority_soon_tasks = [
        task
        for task in tasks
        if is_elevated(task)
        and task.status != TASK_STATUS_DONE
        and task.deadline_at is not None
        and as_of <= task.deadline_at <= soon_cutoff
    ]
    priority_soon_tasks.sort(key=lambda t: (t.deadline_at or datetime.max, -_PRIORITY_RANK.get(t.priority, 0)))

    all_ids = [t.id for t in tasks]
    done_ids = [t.id for t in tasks if t.status == TASK_STATUS_DONE]
    overdue_ids = [t.id for t in overdue_tasks]

    return {
        "as_of": as_of.isoformat(),
        "kpis": compute_kpis(tasks, as_of),
        "status_counts": status_counts,
        "overdue": [_task_brief(t) for t in overdue_tasks],
        "priority_soon": [_task_brief(t) for t in priority_soon_tasks],
        "changes": _compute_changes(previous_payload, all_ids, done_ids, overdue_ids),
        "state": {"all_ids": all_ids, "done_ids": done_ids, "overdue_ids": overdue_ids},
    }
