"""Напоминания о приближении срока поручения через MAX-бота.

Фоновый планировщик периодически сканирует поручения и за
``max.reminder_lead_minutes`` минут до дедлайна отправляет в чат кнопку
«Подтвердить исполнение». Повторно по одной задаче не напоминает
(флаг ``Task.reminder_sent``).

Срок берём из разобранного ``Task.deadline_at`` (наивный UTC, единый источник
истины — см. ``services/deadlines``). Для старых задач без ``deadline_at`` мягко
разбираем строку ``Task.deadline`` тем же парсером; неразобранные сроки пропускаем.
"""

from __future__ import annotations

import asyncio

from app.config import settings
from app.db import SessionLocal
from app.logging_config import get_logger
from app.models import TASK_STATUS_DONE, Task, _now
from app.services.deadlines import parse_deadline
from app.services.max_client import MaxClient, confirmation_keyboard

log = get_logger("reminders")

# Статусы, при которых напоминать уже не нужно. Единый источник — models.TASK_STATUSES;
# закрытый статус ровно один («Выполнено»), «Отменённого» в модели нет.
_CLOSED_STATUSES = {TASK_STATUS_DONE}


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
    now = _now()  # наивный UTC — в той же зоне, что и deadline_at
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
            # deadline_at — разобранный срок (наивный UTC). Фоллбэк на строку —
            # для старых задач, созданных до появления колонки.
            deadline = task.deadline_at or parse_deadline(task.deadline)
            if deadline is None:
                continue
            minutes_left = (deadline - now).total_seconds() / 60.0
            # Пора напомнить: до дедлайна осталось <= lead (включая просрочку).
            if minutes_left <= lead:
                if await _send_reminder(task):
                    # notified_at означает «отправлено в MAX» (max_handler); у
                    # напоминаний свой флаг reminder_sent — их не смешиваем (1.15).
                    task.reminder_sent = True
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
