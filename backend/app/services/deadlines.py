"""Единый парсер срока поручения (``Task.deadline`` -> ``Task.deadline_at``).

Вынесен из ``reminders.py``, чтобы вычисление ``deadline_at`` не тянуло
MAX-зависимости (reminders импортирует ``max_client``). Один и тот же парсер
используют генерация протокола, PATCH задачи и планировщик напоминаний — раньше
логика была продублирована в backend и на фронте и расходилась.

Политика таймзон: срок пользователь/LLM задаёт в местном «настенном» времени
(``settings.max.timezone``). В БД храним НАИВНЫЙ UTC — как и все datetime-поля
(см. ``models._now``): так ``deadline_at`` сравним с ``_now()`` в напоминаниях и
корректно отображается на фронте (``fmtDate`` дописывает ``Z``).
"""

from __future__ import annotations

from datetime import datetime, timezone, tzinfo

from app.config import settings

# Терпимо разбираем несколько числовых форматов (без названий месяцев).
_DATE_FORMATS = (
    "%Y-%m-%d %H:%M",
    "%Y-%m-%dT%H:%M",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%dT%H:%M:%S",  # ISO с секундами — ровно этот формат Dify-workflow просит у LLM
    "%Y-%m-%d",
    "%d.%m.%Y %H:%M",
    "%d.%m.%Y",
    "%d/%m/%Y %H:%M",
    "%d/%m/%Y",
)

_UNSET = object()  # маркер «использовать зону из настроек» (tz=None означает «без зоны»)


def _configured_tz() -> tzinfo | None:
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo(settings.max.timezone)
    except Exception:
        return None


def _default_time() -> tuple[int, int]:
    hour, _, minute = settings.max.default_deadline_time.partition(":")
    try:
        return int(hour), int(minute or 0)
    except ValueError:
        return 18, 0


def parse_deadline_local(value: str | None) -> datetime | None:
    """Разобрать срок в НАИВНОЕ местное время (как его ввёл пользователь).

    Если в строке только дата без времени — подставляем ``default_deadline_time``.
    Нераспознанные строки (например «до пятницы») возвращают ``None``.
    """
    if not value:
        return None
    raw = value.strip()
    if not raw:
        return None
    for fmt in _DATE_FORMATS:
        try:
            dt = datetime.strptime(raw, fmt)
        except ValueError:
            continue
        if "%H" not in fmt:  # формат без времени -> время дня из конфига
            hour, minute = _default_time()
            dt = dt.replace(hour=hour, minute=minute)
        return dt
    return None


def parse_deadline(value: str | None, *, tz: tzinfo | None = _UNSET) -> datetime | None:  # type: ignore[assignment]
    """Разобрать срок в НАИВНЫЙ UTC для хранения в ``Task.deadline_at``.

    Местное время интерпретируем в ``tz`` (по умолчанию — ``settings.max.timezone``)
    и переводим в UTC. Если зона недоступна — мягко считаем, что время уже в UTC
    (без сдвига). ``tz`` можно передать явно (в т.ч. фиксированный офсет) для тестов.
    """
    local = parse_deadline_local(value)
    if local is None:
        return None
    zone = _configured_tz() if tz is _UNSET else tz
    if zone is None:
        return local
    return local.replace(tzinfo=zone).astimezone(timezone.utc).replace(tzinfo=None)
