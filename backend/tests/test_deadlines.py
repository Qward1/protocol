"""Юнит-тесты единого парсера сроков поручений (app.services.deadlines).

Парсер — единственный источник истины для Task.deadline_at: им пользуются и
генерация протокола, и PATCH задачи, и планировщик напоминаний. Логика таймзон:
пользователь вводит срок в местном «настенном» времени, храним наивный UTC.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.services.deadlines import parse_deadline, parse_deadline_local

MSK = timezone(timedelta(hours=3))  # фиксированный офсет МСК — без зависимости от tzdata


# --- parse_deadline_local: разбор строки в наивное местное время ---

def test_local_iso_datetime():
    assert parse_deadline_local("2025-12-25 09:00") == datetime(2025, 12, 25, 9, 0)


def test_local_iso_t_datetime():
    assert parse_deadline_local("2025-12-25T09:00") == datetime(2025, 12, 25, 9, 0)


def test_local_iso_t_datetime_with_seconds():
    # Dify-workflow просит у LLM ровно формат "YYYY-MM-DDTHH:mm:ss" — он обязан разбираться.
    assert parse_deadline_local("2025-12-25T09:30:00") == datetime(2025, 12, 25, 9, 30, 0)


def test_local_dmy_datetime():
    assert parse_deadline_local("25.12.2025 18:30") == datetime(2025, 12, 25, 18, 30)


def test_local_slash_datetime():
    assert parse_deadline_local("25/12/2025 08:00") == datetime(2025, 12, 25, 8, 0)


def test_local_date_only_uses_default_time():
    # В тестовом конфиге max.default_deadline_time не задан -> дефолт 18:00.
    assert parse_deadline_local("25.12.2025") == datetime(2025, 12, 25, 18, 0)


def test_local_iso_date_only_uses_default_time():
    assert parse_deadline_local("2025-12-25") == datetime(2025, 12, 25, 18, 0)


def test_local_returns_none_for_freeform():
    assert parse_deadline_local("до пятницы") is None


def test_local_returns_none_for_empty():
    assert parse_deadline_local("") is None
    assert parse_deadline_local(None) is None
    assert parse_deadline_local("   ") is None


# --- parse_deadline: наивный UTC для хранения в deadline_at ---

def test_utc_converts_local_wallclock_to_utc():
    # 18:00 МСК (+3) -> 15:00 UTC того же дня.
    assert parse_deadline("25.12.2025 18:00", tz=MSK) == datetime(2025, 12, 25, 15, 0)


def test_utc_conversion_crosses_midnight():
    # 01:00 МСК -> 22:00 UTC предыдущих суток.
    assert parse_deadline("25.12.2025 01:00", tz=MSK) == datetime(2025, 12, 24, 22, 0)


def test_utc_none_tz_returns_local_unchanged():
    # Зона недоступна -> мягкая деградация: считаем время уже в UTC (без сдвига).
    assert parse_deadline("25.12.2025 18:00", tz=None) == datetime(2025, 12, 25, 18, 0)


def test_utc_none_for_freeform():
    assert parse_deadline("когда-нибудь", tz=MSK) is None


def test_default_path_returns_datetime():
    # Продовый путь (tz из settings.max.timezone) должен разобрать валидную строку.
    result = parse_deadline("2025-12-25 09:00")
    assert isinstance(result, datetime)
    assert result.tzinfo is None  # наивный UTC
