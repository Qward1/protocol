"""Лёгкая чистка накопившихся данных при старте приложения.

Вызывается один раз из ``lifespan`` (без фоновых демонов): удаляет истёкшие
сессии авторизации и давно заброшенные пустые чат-сессии, чтобы таблицы не
росли бесконечно. Всё «мягко» — сбой чистки не должен мешать старту сервиса.
"""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy.orm import Session

from app.logging_config import get_logger
from app.models import AuthSession, ChatMessage, ChatSession, _now

log = get_logger("maintenance")


def purge_expired_sessions(db: Session) -> int:
    """Удалить истёкшие сессии авторизации. Возвращает число удалённых."""
    now = _now()
    expired = (
        db.query(AuthSession)
        .filter(AuthSession.expires_at.isnot(None), AuthSession.expires_at < now)
        .all()
    )
    for session in expired:
        db.delete(session)
    if expired:
        db.commit()
    return len(expired)


def purge_empty_chat_sessions(db: Session, older_than_days: int = 30) -> int:
    """Удалить пустые (без сообщений) чат-сессии старше ``older_than_days`` дней."""
    cutoff = _now() - timedelta(days=older_than_days)
    used_session_ids = db.query(ChatMessage.session_id).distinct()
    stale = (
        db.query(ChatSession)
        .filter(ChatSession.created_at < cutoff)
        .filter(ChatSession.id.notin_(used_session_ids))
        .all()
    )
    for session in stale:
        db.delete(session)
    if stale:
        db.commit()
    return len(stale)


def run_startup_cleanup(db: Session) -> None:
    """Один проход стартовой чистки. Ошибки логируются, но не пробрасываются."""
    try:
        sessions = purge_expired_sessions(db)
        chats = purge_empty_chat_sessions(db)
    except Exception as exc:  # noqa: BLE001 — чистка не должна ронять старт
        db.rollback()
        log.warning("Сбой стартовой чистки: %s", exc)
        return
    if sessions or chats:
        log.info("Стартовая чистка: истёкших сессий %d, пустых чатов %d", sessions, chats)
