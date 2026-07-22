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


# Допустимые статусы поручения. Единый источник правды: используется и как
# значение по умолчанию у Task.status, и для валидации API (schemas.TaskUpdate).
TASK_STATUS_NEW = "Новое"
TASK_STATUS_REVIEW = "Требует проверки"
TASK_STATUS_DONE = "Выполнено"
TASK_STATUS_CLOSED = "Закрыто"  # закрыто без исполнения (не выполнено)
TASK_STATUSES: tuple[str, ...] = (
    TASK_STATUS_NEW, TASK_STATUS_REVIEW, TASK_STATUS_DONE, TASK_STATUS_CLOSED,
)
# Терминальные статусы: задача завершена и выпадает из «в работе»/«просрочено» и
# из напоминаний. «Выполнено» — исполнено, «Закрыто» — снято без исполнения.
TASK_TERMINAL_STATUSES: frozenset[str] = frozenset({TASK_STATUS_DONE, TASK_STATUS_CLOSED})

# Приоритет поручения (аналитика/подсветка, п. 4.5). Единый источник правды —
# как и статусы: значение по умолчанию Task.priority, валидация в schemas.TaskUpdate,
# зеркало TASK_PRIORITY в frontend/src/lib/api.ts. Подсветка (4.5.4) и условие
# рейтинга done_priority срабатывают на «Высокий»/«Критический».
TASK_PRIORITY_LOW = "Низкий"
TASK_PRIORITY_NORMAL = "Обычный"
TASK_PRIORITY_HIGH = "Высокий"
TASK_PRIORITY_CRITICAL = "Критический"
TASK_PRIORITIES: tuple[str, ...] = (
    TASK_PRIORITY_LOW, TASK_PRIORITY_NORMAL, TASK_PRIORITY_HIGH, TASK_PRIORITY_CRITICAL,
)
# Приоритеты, считающиеся «повышенными» (подсветка + условие рейтинга done_priority).
TASK_ELEVATED_PRIORITIES: frozenset[str] = frozenset({TASK_PRIORITY_HIGH, TASK_PRIORITY_CRITICAL})


def _now() -> datetime:
    # Политика таймзон: ВСЕ datetime-поля БД (created_at, closed_at, notified_at,
    # deadline_at, expires_at, ...) хранятся в наивном UTC. Срок вводится в местном
    # времени, но services.deadlines.parse_deadline переводит его в UTC при записи,
    # поэтому сравнения (напоминания) идут в одной зоне.
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
    deadline: Mapped[str] = mapped_column(String, default="")  # исходная строка от LLM/пользователя
    # Разобранный срок в наивном UTC (см. services/deadlines.parse_deadline).
    # Единый источник истины для сортировки, «просрочено» и напоминаний; NULL —
    # если строку не удалось распознать.
    deadline_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String, default=TASK_STATUS_NEW)  # см. TASK_STATUSES
    # Черновик: поручение сформировано из протокола, но ещё не подтверждено и не
    # попало в реестр активных. Исключается из списка задач, аналитики и напоминаний
    # до подтверждения (protocols.confirm_tasks переводит is_draft -> False).
    is_draft: Mapped[bool] = mapped_column(Boolean, default=False)
    # Срезы для аналитического дашборда и фильтров (п. 4.5). priority — из
    # TASK_PRIORITIES; location/object/theme — свободный текст, как department.
    priority: Mapped[str] = mapped_column(String, default=TASK_PRIORITY_NORMAL)
    location: Mapped[str] = mapped_column(String, default="")
    object: Mapped[str] = mapped_column(String, default="")
    theme: Mapped[str] = mapped_column(String, default="")
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


class ProtocolTemplate(Base):
    """Загруженный пользователем DOCX-шаблон протокола (docxtpl, часть 2).

    Плейсхолдеры Jinja2 вписаны прямо в текст Word-документа. Одновременно
    активен ровно один шаблон (``is_active``); история версий сохраняется.
    ``field_mapping_json`` — {каноническое_поле: имя_плейсхолдера_в_файле}."""

    __tablename__ = "protocol_templates"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String, default="")
    docx_path: Mapped[str] = mapped_column(String, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    detected_placeholders_json: Mapped[str] = mapped_column(Text, default="[]")
    field_mapping_json: Mapped[str] = mapped_column(Text, default="{}")  # {canonical_field: placeholder}
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class RatingRule(Base):
    """Настраиваемое правило начисления баллов рейтинга исполнителей (п. 4.5.3).

    ``condition`` — ключ из фиксированного каталога ``analytics.RATING_CONDITIONS``
    (исполнено в срок / с опозданием / просрочено / исполнено приоритетное).
    ``points`` — начисление (или списание при отрицательном) за одно поручение,
    подошедшее под условие. Заказчик (роль admin) правит баллы/включённость через
    UI — без изменения кода. Одно правило на условие.
    """

    __tablename__ = "rating_rules"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    condition: Mapped[str] = mapped_column(String, index=True)
    points: Mapped[float] = mapped_column(Float, default=0.0)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class MorningBrief(Base):
    """Автоматическая утренняя справка — детерминированный снимок реестра (п. 4.5.2).

    Формируется по расписанию (и вручную) сервисом ``morning_brief`` из данных
    ``Task`` без обращения к LLM. ``payload_json`` — полный снимок (счётчики по
    статусам, просроченные, приоритетные с приближающимся сроком, изменения с
    прошлой справки). ``as_of`` — срез (наивный UTC), на который посчитаны цифры.
    """

    __tablename__ = "morning_briefs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    as_of: Mapped[datetime] = mapped_column(DateTime, default=_now)
    generated_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    payload_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


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
