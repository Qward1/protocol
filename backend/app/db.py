"""SQLAlchemy engine / session. По умолчанию SQLite в storage_dir."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings
from app.logging_config import get_logger

log = get_logger("db")


class Base(DeclarativeBase):
    pass


def _ensure_sqlite_dir(database_url: str) -> None:
    prefix = "sqlite:///"
    if database_url.startswith(prefix):
        db_path = Path(database_url[len(prefix):])
        db_path.parent.mkdir(parents=True, exist_ok=True)


_ensure_sqlite_dir(settings.database_url)

connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


# Колонки, добавленные после первого релиза. create_all не меняет существующие
# таблицы, поэтому для SQLite добавляем недостающие колонки вручную (идемпотентно).
_TASK_ADDED_COLUMNS = {
    "max_user_id": "VARCHAR DEFAULT ''",
    "max_chat_id": "VARCHAR DEFAULT ''",
    "memo_path": "VARCHAR DEFAULT ''",
    "reminder_sent": "BOOLEAN DEFAULT 0",
    "notified_at": "DATETIME",
}


def _migrate_sqlite_columns() -> None:
    """Добавить недостающие колонки в существующую таблицу tasks (только SQLite)."""
    if not settings.database_url.startswith("sqlite"):
        return
    inspector = inspect(engine)
    if "tasks" not in inspector.get_table_names():
        return
    existing = {col["name"] for col in inspector.get_columns("tasks")}
    with engine.begin() as conn:
        for name, ddl in _TASK_ADDED_COLUMNS.items():
            if name not in existing:
                conn.execute(text(f"ALTER TABLE tasks ADD COLUMN {name} {ddl}"))
                log.info("Добавлена колонка tasks.%s", name)


def init_db() -> None:
    """Создать таблицы. Для каркаса достаточно create_all (без миграций)."""
    from app import models  # noqa: F401  (регистрация моделей)

    Base.metadata.create_all(bind=engine)
    _migrate_sqlite_columns()


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
