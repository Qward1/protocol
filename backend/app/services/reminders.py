"""Напоминания о приближении срока поручения через MAX-бота.

Фоновый планировщик периодически сканирует поручения и за
``max.reminder_lead_minutes`` минут до дедлайна отправляет в чат кнопку
«Подтвердить исполнение». Повторно по одной задаче не напоминает
(флаг ``Task.reminder_sent``).

Срок (``Task.deadline``) — свободная строка из Dify; разбираем терпимо
несколькими форматами, неразобранные сроки тихо пропускаем.
"""

from __future__ import annotations

import asyncio
from datetime import datetime

from app.config import settings
from app.db import SessionLocal
from app.logging_config import get_logger
from app.models import Task
from app.services.max_client import MaxClient, confirmation_keyboard

log = get_logger("reminders")

# Статусы, при которых напоминать уже не нужно.
_CLOSED_STATUSES = {"Выполнено", "Отменено"}

_DATE_FORMATS = (
    "%Y-%m-%d %H:%M",
    "%Y-%m-%dT%H:%M",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d",
    "%d.%m.%Y %H:%M",
    "%d.%m.%Y",
    "%d/%m/%Y %H:%M",
    "%d/%m/%Y",
)


def _tzinfo():
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo(settings.max.timezone)
    except Exception:
        return None


def now_local_naive() -> datetime:
    """Текущее время в настроенной таймзоне, без tzinfo (для сравнения с naive БД)."""
    tz = _tzinfo()
    if tz is None:
        return datetime.now()
    return datetime.now(tz).replace(tzinfo=None)


def parse_deadline(value: str) -> datetime | None:
    """Разобрать строковый дедлайн. Если задана только дата — берём default_deadline_time."""
    if not value:
        return None
    raw = value.strip()
    for fmt in _DATE_FORMATS:
        try:
            dt = datetime.strptime(raw, fmt)
        except ValueError:
            continue
        # Формат без времени -> подставляем время дня из конфига.
        if "%H" not in fmt:
            hour, _, minute = settings.max.default_deadline_time.partition(":")
            try:
                dt = dt.replace(hour=int(hour), minute=int(minute or 0))
            except ValueError:
                dt = dt.replace(hour=18, minute=0)
        return dt
    return None


def _chat_for(task: Task) -> str:
    return task.max_chat_id or settings.max.chat_id


async def _send_reminder(task: Task) -> bool:
    """Отправить напоминание-кнопку по задаче. True — если ушло (или бот выключен мягко)."""
    chat_id = _chat_for(task)
    if not chat_id:
        return False
    mention = f"{task.max_username} " if task.max_username else ""
    text = (
        f"{mention}Напоминание о сроке поручения.\n"
        f"Ответственный: {task.responsible or '-'}\n"
        f"Поручение: {task.assignment or '-'}\n"
        f"Срок: {task.deadline or '-'}\n\n"
        f"Когда выполните — нажмите «Подтвердить исполнение»."
    )
    result = await MaxClient().send_message(
        text, chat_id=chat_id, attachments=confirmation_keyboard(task.id)
    )
    return not result.get("error")


async def scan_once() -> int:
    """Один проход планировщика. Возвращает число отправленных напоминаний."""
    sent = 0
    now = now_local_naive()
    lead = settings.max.reminder_lead_minutes

    db = SessionLocal()
    try:
        candidates = (
            db.query(Task)
            .filter(Task.reminder_sent.is_(False))
            .filter(~Task.status.in_(_CLOSED_STATUSES))
            .all()
        )
        for task in candidates:
            deadline = parse_deadline(task.deadline)
            if deadline is None:
                continue
            minutes_left = (deadline - now).total_seconds() / 60.0
            # Пора напомнить: до дедлайна осталось <= lead (включая просрочку).
            if minutes_left <= lead:
                if await _send_reminder(task):
                    task.reminder_sent = True
                    task.notified_at = now
                    db.commit()
                    sent += 1
    except Exception as exc:  # noqa: BLE001 — планировщик не должен падать
        log.warning("Сбой прохода напоминаний: %s", exc)
        db.rollback()
    finally:
        db.close()

    if sent:
        log.info("Отправлено напоминаний: %d", sent)
    return sent


async def reminder_loop() -> None:
    """Бесконечный цикл планировщика (запускается в lifespan при max.enabled)."""
    period = max(10, settings.max.reminder_scan_seconds)
    log.info("Планировщик напоминаний запущен (период %d c, lead %d мин)",
             period, settings.max.reminder_lead_minutes)
    while True:
        await scan_once()
        await asyncio.sleep(period)
