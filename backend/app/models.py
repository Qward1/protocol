"""ORM-модели. Минимальный, но полный для каркаса набор сущностей.

Поток данных:
    Transcription 1..* Segment
    Transcription 1..* Protocol 1..* Task 1..1 Justification
    ChatSession 1..* ChatMessage
"""

from __future__ import annotations

from datetime import datetime, timezone
import uuid

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    # Наивный UTC (совместим с колонками DateTime), без deprecated utcnow().
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Transcription(Base):
    __tablename__ = "transcriptions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    filename: Mapped[str] = mapped_column(String, default="")
    media_path: Mapped[str] = mapped_column(String, default="")
    media_kind: Mapped[str] = mapped_column(String, default="audio")  # audio | video
    status: Mapped[str] = mapped_column(String, default="pending")  # pending|processing|done|error
    error: Mapped[str] = mapped_column(Text, default="")
    language: Mapped[str] = mapped_column(String, default="ru")
    duration: Mapped[float] = mapped_column(Float, default=0.0)
    full_text: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    segments: Mapped[list["Segment"]] = relationship(
        back_populates="transcription", cascade="all, delete-orphan", order_by="Segment.start"
    )
    protocols: Mapped[list["Protocol"]] = relationship(
        back_populates="transcription", cascade="all, delete-orphan"
    )
    speaker_labels: Mapped[list["SpeakerLabel"]] = relationship(
        back_populates="transcription", cascade="all, delete-orphan"
    )

    @property
    def speaker_map(self) -> dict[str, str]:
        """Сопоставление технических меток («Спикер 1») с ФИО/должностями."""
        return {label.speaker: label.display_name for label in self.speaker_labels if label.display_name}

    def display_speaker(self, speaker: str) -> str:
        """Отображаемое имя говорящего с учётом ручного сопоставления."""
        return self.speaker_map.get(speaker, speaker)


class Segment(Base):
    __tablename__ = "segments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    transcription_id: Mapped[str] = mapped_column(ForeignKey("transcriptions.id"))
    start: Mapped[float] = mapped_column(Float, default=0.0)  # секунды
    end: Mapped[float] = mapped_column(Float, default=0.0)
    speaker: Mapped[str] = mapped_column(String, default="")  # «Спикер 1»
    text: Mapped[str] = mapped_column(Text, default="")

    transcription: Mapped[Transcription] = relationship(back_populates="segments")


class SpeakerLabel(Base):
    """Ручное сопоставление говорящего с человеком в рамках одного совещания.

    Хранит соответствие технической метки диаризации («Спикер 1») реальному
    ФИО/должности/произвольному названию. Привязано к конкретной транскрипции —
    при повторном открытии совещания сопоставления загружаются автоматически.
    """

    __tablename__ = "speaker_labels"
    __table_args__ = (UniqueConstraint("transcription_id", "speaker", name="uq_speaker_per_transcription"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    transcription_id: Mapped[str] = mapped_column(ForeignKey("transcriptions.id"))
    speaker: Mapped[str] = mapped_column(String, default="")        # исходная метка, напр. «Спикер 1»
    display_name: Mapped[str] = mapped_column(String, default="")   # ФИО / должность / произвольное имя

    transcription: Mapped[Transcription] = relationship(back_populates="speaker_labels")


class Protocol(Base):
    __tablename__ = "protocols"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    transcription_id: Mapped[str | None] = mapped_column(ForeignKey("transcriptions.id"), nullable=True)
    title: Mapped[str] = mapped_column(String, default="")
    date: Mapped[str] = mapped_column(String, default="")
    number: Mapped[str] = mapped_column(String, default="")
    docx_path: Mapped[str] = mapped_column(String, default="")
    raw_json: Mapped[str] = mapped_column(Text, default="{}")  # сырой ответ Dify
    body: Mapped[str] = mapped_column(Text, default="")        # отрендеренный текст протокола
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    transcription: Mapped[Transcription | None] = relationship(back_populates="protocols")
    tasks: Mapped[list["Task"]] = relationship(
        back_populates="protocol", cascade="all, delete-orphan"
    )


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    protocol_id: Mapped[str] = mapped_column(ForeignKey("protocols.id"))
    assignment: Mapped[str] = mapped_column(Text, default="")
    responsible: Mapped[str] = mapped_column(String, default="")
    department: Mapped[str] = mapped_column(String, default="")
    deadline: Mapped[str] = mapped_column(String, default="")
    status: Mapped[str] = mapped_column(String, default="Новое")  # Новое|Требует проверки|Выполнено
    source_fragment: Mapped[str] = mapped_column(Text, default="")
    reason_comment: Mapped[str] = mapped_column(Text, default="")
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    max_username: Mapped[str] = mapped_column(String, default="")
    # Получатель в MAX (заполняется при доставке в группу/чат)
    max_user_id: Mapped[str] = mapped_column(String, default="")
    max_chat_id: Mapped[str] = mapped_column(String, default="")
    # Контроль исполнения (ТЗ 3, 4)
    completion_text: Mapped[str] = mapped_column(Text, default="")  # что сделал сотрудник
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    memo_path: Mapped[str] = mapped_column(String, default="")      # путь к справке (DOCX)
    # Напоминания о приближении срока
    reminder_sent: Mapped[bool] = mapped_column(Boolean, default=False)
    notified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    protocol: Mapped[Protocol] = relationship(back_populates="tasks")
    justification: Mapped["Justification | None"] = relationship(
        back_populates="task", cascade="all, delete-orphan", uselist=False
    )


class Justification(Base):
    """Справка-обоснование назначения поручения (ТЗ 2Б)."""

    __tablename__ = "justifications"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    task_id: Mapped[str] = mapped_column(ForeignKey("tasks.id"))
    fragment: Mapped[str] = mapped_column(Text, default="")   # на основании какого фрагмента
    duty: Mapped[str] = mapped_column(Text, default="")       # на основании какой должностной обязанности
    text: Mapped[str] = mapped_column(Text, default="")       # полный текст справки
    docx_path: Mapped[str] = mapped_column(String, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    task: Mapped[Task] = relationship(back_populates="justification")


class ConfirmationSession(Base):
    """Активный диалог подтверждения в MAX: бот ждёт от сотрудника текст о сделанном.

    Создаётся по нажатию «Подтвердить исполнение», закрывается, когда сотрудник
    прислал текст (или истёк ``expires_at``)."""

    __tablename__ = "confirmation_sessions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    max_user_id: Mapped[str] = mapped_column(String, index=True, default="")
    chat_id: Mapped[str] = mapped_column(String, default="")
    task_id: Mapped[str] = mapped_column(ForeignKey("tasks.id"))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    title: Mapped[str] = mapped_column(String, default="Новый чат")
    scope_json: Mapped[str] = mapped_column(Text, default="{}")  # {protocol_ids:[], transcription_ids:[]}
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    messages: Mapped[list["ChatMessage"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", order_by="ChatMessage.created_at"
    )


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(ForeignKey("chat_sessions.id"))
    role: Mapped[str] = mapped_column(String, default="user")  # user | assistant
    content: Mapped[str] = mapped_column(Text, default="")
    citations_json: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    session: Mapped[ChatSession] = relationship(back_populates="messages")


class User(Base):
    """Учётная запись пользователя (авторизация + ролевая модель, ТЗ 3).

    Роли: ``admin`` (администратор), ``head`` (глава), ``staff`` (сотрудник
    аппарата/секретарь), ``executor`` (исполнитель). Права по ролям — в
    ``app/services/auth.py`` (ROLE_PERMISSIONS).
    """

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    username: Mapped[str] = mapped_column(String, unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String, default="")
    password_hash: Mapped[str] = mapped_column(String, default="")
    role: Mapped[str] = mapped_column(String, default="executor")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    sessions: Mapped[list["AuthSession"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class AuthSession(Base):
    """Активная сессия пользователя: непрозрачный токен -> пользователь.

    Токен передаётся с фронтенда в заголовке ``Authorization: Bearer <token>``.
    Логаут удаляет сессию, истечение контролируется ``expires_at``.
    """

    __tablename__ = "auth_sessions"

    token: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    user: Mapped[User] = relationship(back_populates="sessions")
