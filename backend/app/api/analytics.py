"""Аналитический дашборд: KPI, рейтинг, подсветка, фильтры (п. 4.5.1).

Только для ролей с правом ``dashboard.view`` (Глава/Администрация/секретарь).
Все показатели считает ``services.analytics`` детерминированно по данным ``Task``
(сквозное требование 4.5.5) — здесь лишь разбор query-параметров и сериализация.
"""

from __future__ import annotations

from datetime import date, datetime, time, timezone
import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import MorningBrief
from app.schemas import (
    DashboardAnalyticsDTO,
    MorningBriefDTO,
    MorningBriefListItem,
)
from app.security import require_permission
from app.services import analytics, morning_brief

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


def _configured_tz():
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo(settings.max.timezone)
    except Exception:
        return None


def _to_utc_naive(local_dt: datetime) -> datetime:
    """Местное «настенное» время -> наивный UTC (как хранится created_at)."""
    tz = _configured_tz()
    if tz is None:
        return local_dt
    return local_dt.replace(tzinfo=tz).astimezone(timezone.utc).replace(tzinfo=None)


def _parse_period(period_from: str | None, period_to: str | None) -> tuple[datetime | None, datetime | None]:
    """Разобрать даты периода (YYYY-MM-DD) в наивные UTC-границы дня.

    Период фильтрует ``Task.created_at``. Границы дня берём в настроенной зоне и
    переводим в UTC, чтобы «сегодня» совпадало с ожиданием пользователя."""
    def bound(value: str | None, end: bool) -> datetime | None:
        if not value:
            return None
        try:
            d = date.fromisoformat(value)
        except ValueError as exc:
            raise HTTPException(422, f"Некорректная дата периода: {value}") from exc
        return _to_utc_naive(datetime.combine(d, time.max if end else time.min))

    return bound(period_from, end=False), bound(period_to, end=True)


@router.get(
    "/dashboard", response_model=DashboardAnalyticsDTO,
    dependencies=[Depends(require_permission("dashboard.view"))],
)
def dashboard(
    period_from: str | None = None,
    period_to: str | None = None,
    responsible: str | None = None,
    location: str | None = None,
    object: str | None = None,
    theme: str | None = None,
    priority: str | None = None,
    status: str | None = None,
    db: Session = Depends(get_db),
):
    """Сводка дашборда под фильтром: KPI, рейтинг, подсветка, значения фильтров."""
    pf, pt = _parse_period(period_from, period_to)
    filters = analytics.TaskFilters(
        period_from=pf,
        period_to=pt,
        responsible=responsible,
        location=location,
        object=object,
        theme=theme,
        priority=priority,
        status=status,
    )
    return analytics.dashboard(db, filters)


# --- Утренняя справка (п. 4.5.2) ---

def _brief_to_dto(brief: MorningBrief) -> MorningBriefDTO:
    """Собрать DTO из ORM-снимка + сохранённого payload_json."""
    payload = json.loads(brief.payload_json or "{}")
    return MorningBriefDTO(
        id=brief.id,
        as_of=brief.as_of,
        generated_at=brief.generated_at,
        kpis=payload.get("kpis") or {"total": 0, "in_work": 0, "done": 0, "overdue": 0},
        status_counts=payload.get("status_counts") or {},
        overdue=payload.get("overdue") or [],
        priority_soon=payload.get("priority_soon") or [],
        changes=payload.get("changes") or {},
    )


@router.get(
    "/brief/latest", response_model=MorningBriefDTO | None,
    dependencies=[Depends(require_permission("dashboard.view"))],
)
def latest_brief(db: Session = Depends(get_db)):
    """Последняя сформированная утренняя справка (или null, если ещё не было)."""
    brief = morning_brief.latest_brief(db)
    return _brief_to_dto(brief) if brief else None


@router.get(
    "/briefs", response_model=list[MorningBriefListItem],
    dependencies=[Depends(require_permission("dashboard.view"))],
)
def list_briefs(db: Session = Depends(get_db)):
    """История справок (для выбора/выгрузки)."""
    return (
        db.query(MorningBrief).order_by(MorningBrief.generated_at.desc()).limit(60).all()
    )


@router.post(
    "/brief", response_model=MorningBriefDTO,
    dependencies=[Depends(require_permission("dashboard.view"))],
)
def generate_brief(db: Session = Depends(get_db)):
    """Сформировать справку на текущий момент вручную («Сформировать сейчас»)."""
    brief = morning_brief.generate_and_store(db)
    return _brief_to_dto(brief)
