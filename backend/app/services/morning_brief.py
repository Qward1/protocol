"""Формирование и планирование утренней справки (п. 4.5.2).

Справка — детерминированный снимок реестра поручений (``analytics.build_brief``),
без LLM. Плановый ``brief_loop`` — единственный новый фоновый job; интегрирован в
lifespan рядом с планировщиком напоминаний (не отдельный поллинг-демон). Расчёт
цифр вынесен в ``services.analytics``; здесь — хранение снимков и расписание.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import json

from sqlalchemy.orm import Session

from app.config import settings
from app.db import SessionLocal
from app.logging_config import get_logger
from app.models import MorningBrief, _now
from app.services import analytics

log = get_logger("morning_brief")


def latest_brief(db: Session) -> MorningBrief | None:
    return db.query(MorningBrief).order_by(MorningBrief.generated_at.desc()).first()


def latest_payload(db: Session) -> dict | None:
    brief = latest_brief(db)
    if not brief:
        return None
    try:
        return json.loads(brief.payload_json or "{}")
    except json.JSONDecodeError:
        return None


def generate_and_store(db: Session, as_of: datetime | None = None) -> MorningBrief:
    """Сформировать справку на ``as_of`` (по умолчанию — сейчас) и сохранить снимок."""
    as_of = as_of or _now()
    payload = analytics.build_brief(db, as_of, previous_payload=latest_payload(db))
    brief = MorningBrief(
        as_of=as_of,
        generated_at=_now(),
        payload_json=json.dumps(payload, ensure_ascii=False),
    )
    db.add(brief)
    db.commit()
    db.refresh(brief)
    return brief


# --- Планировщик (один плановый job, запускается из lifespan) ---

def _configured_tz():
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo(settings.max.timezone)
    except Exception:
        return None


def _parse_hh_mm(value: str) -> tuple[int, int]:
    hour, _, minute = value.partition(":")
    try:
        return max(0, min(23, int(hour))), max(0, min(59, int(minute or 0)))
    except ValueError:
        return 8, 0


def seconds_until_next_run(now_utc: datetime | None = None) -> float:
    """Секунды до следующего наступления ``morning_brief_time`` в настроенной зоне."""
    tz = _configured_tz()
    now_utc = now_utc or datetime.now(timezone.utc).replace(tzinfo=None)
    hour, minute = _parse_hh_mm(settings.analytics.morning_brief_time)

    if tz is None:
        # Зона недоступна — считаем время в UTC (мягко, как в deadlines).
        now_local = now_utc
        target = now_local.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if target <= now_local:
            target += timedelta(days=1)
        return (target - now_local).total_seconds()

    now_aware = now_utc.replace(tzinfo=timezone.utc).astimezone(tz)
    target = now_aware.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if target <= now_aware:
        target += timedelta(days=1)
    return (target - now_aware).total_seconds()


async def brief_loop() -> None:
    """Плановый цикл: спит до следующего времени формирования и сохраняет снимок."""
    if not settings.analytics.morning_brief_enabled:
        return
    log.info(
        "Планировщик утренней справки запущен (ежедневно в %s, зона %s)",
        settings.analytics.morning_brief_time, settings.max.timezone,
    )
    while True:
        await asyncio.sleep(max(1.0, seconds_until_next_run()))
        try:
            with SessionLocal() as db:
                brief = generate_and_store(db)
            log.info("Утренняя справка сформирована (as_of=%s)", brief.as_of)
        except Exception as exc:  # noqa: BLE001 — планировщик не должен падать
            log.warning("Сбой формирования утренней справки: %s", exc)
