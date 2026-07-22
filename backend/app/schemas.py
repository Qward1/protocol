"""Pydantic DTO для REST API."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models import TASK_PRIORITIES, TASK_STATUSES


# --- Transcription ---

class SegmentDTO(BaseModel):
    start: float
    end: float
    speaker: str = ""
    text: str = ""


class TranscriptionDTO(BaseModel):
    id: str
    filename: str
    media_kind: str
    status: str
    error: str = ""
    language: str = "ru"
    duration: float = 0.0
    full_text: str = ""
    created_at: datetime
    segments: list[SegmentDTO] = Field(default_factory=list)
    # Сопоставление технических меток («Спикер 1») с ФИО/должностями (ТЗ 2).
    speaker_map: dict[str, str] = Field(default_factory=dict)

    model_config = ConfigDict(from_attributes=True)


class SpeakerMapUpdate(BaseModel):
    """Ручное сопоставление говорящих с людьми в рамках совещания.

    ``mappings`` — словарь {исходная метка: ФИО/должность}. Пустое значение
    убирает сопоставление и возвращает техническую метку.
    """

    mappings: dict[str, str] = Field(default_factory=dict)


class TranscriptionListItem(BaseModel):
    id: str
    filename: str
    media_kind: str = "audio"
    status: str
    duration: float
    segments_count: int = 0
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TextTranscriptionCreate(BaseModel):
    """Создание транскрипции из уже готового текста встречи."""

    title: str = "Текст встречи"
    text: str


# --- Protocol / Task ---

class TaskDTO(BaseModel):
    id: str
    protocol_id: str
    assignment: str
    responsible: str
    department: str
    deadline: str
    deadline_at: datetime | None = None  # разобранный срок (наивный UTC), NULL если не распознан
    status: str
    priority: str = ""
    location: str = ""
    object: str = ""
    theme: str = ""
    source_fragment: str = ""
    reason_comment: str = ""
    confidence: float = 0.0
    max_username: str = ""
    max_chat_id: str = ""
    completion_text: str = ""
    closed_at: datetime | None = None
    notified_at: datetime | None = None
    is_draft: bool = False
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TaskUpdate(BaseModel):
    """Частичное обновление поручения (ручная правка)."""

    assignment: str | None = None
    responsible: str | None = None
    department: str | None = None
    deadline: str | None = None
    status: Literal[TASK_STATUSES] | None = None
    priority: Literal[TASK_PRIORITIES] | None = None
    location: str | None = None
    object: str | None = None
    theme: str | None = None
    max_username: str | None = None


class TaskExecutionSubmit(BaseModel):
    completion_text: str


class TaskConfirm(BaseModel):
    """Подтверждение руководителем. notify_max — отправить справку в MAX, если мост включён."""

    notify_max: bool = False


class ProtocolDTO(BaseModel):
    id: str
    transcription_id: str | None = None
    title: str
    date: str
    number: str
    body: str = ""
    docx_path: str = ""
    created_at: datetime
    tasks: list[TaskDTO] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class ProtocolUpdate(BaseModel):
    """Частичное обновление метаданных/текста протокола (ручная правка)."""

    title: str | None = None
    date: str | None = None
    number: str | None = None
    body: str | None = None


class ProtocolListItem(BaseModel):
    id: str
    title: str
    date: str
    number: str = ""
    tasks_count: int = 0
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class GenerateProtocolRequest(BaseModel):
    transcription_id: str


class SegmentUpdate(BaseModel):
    """Ручная правка сегментов транскрипта (текст/спикеры)."""

    segments: list[SegmentDTO]


# --- Protocol templates (редактируемый DOCX-шаблон, часть 2) ---

class ProtocolTemplateDTO(BaseModel):
    id: str
    name: str
    is_active: bool
    detected_placeholders: list[str] = Field(default_factory=list)
    field_mapping: dict[str, str] = Field(default_factory=dict)
    created_at: datetime
    # detected_placeholders/field_mapping собираются из *_json полей в API-слое.


class ProtocolTemplateMappingUpdate(BaseModel):
    field_mapping: dict[str, str]


# --- Justification ---

class JustificationDTO(BaseModel):
    id: str
    task_id: str
    fragment: str
    duty: str
    text: str
    docx_path: str = ""

    model_config = ConfigDict(from_attributes=True)


# --- Q&A / Search ---

class QAScope(BaseModel):
    protocol_ids: list[str] = Field(default_factory=list)
    transcription_ids: list[str] = Field(default_factory=list)


class QARequest(BaseModel):
    question: str
    scope: QAScope = Field(default_factory=QAScope)
    session_id: str | None = None


class Citation(BaseModel):
    source_type: str  # protocol | transcription
    source_id: str
    title: str = ""
    fragment: str = ""
    start: float | None = None  # для jump-to-fragment


class QAResponse(BaseModel):
    session_id: str
    answer: str
    citations: list[Citation] = Field(default_factory=list)


class ChatHistoryMessage(BaseModel):
    role: str  # user | assistant
    content: str
    citations: list[Citation] = Field(default_factory=list)


class ChatHistoryResponse(BaseModel):
    """История одной сессии чата (для «Продолжить прошлый разговор»)."""

    session_id: str
    title: str = ""
    messages: list[ChatHistoryMessage] = Field(default_factory=list)


class SearchRequest(BaseModel):
    query: str
    top_k: int = 8


class SearchHit(BaseModel):
    transcription_id: str | None = None
    title: str = ""
    fragment: str = ""
    score: float = 0.0
    start: float | None = None


class SearchResponse(BaseModel):
    hits: list[SearchHit] = Field(default_factory=list)


# --- Library ---

class LibraryResponse(BaseModel):
    protocols: list[ProtocolListItem] = Field(default_factory=list)
    transcriptions: list[TranscriptionListItem] = Field(default_factory=list)


# --- Export ---

class ExportRequest(BaseModel):
    object_type: str  # protocol | transcription | chat | justification | brief
    object_id: str
    fmt: str  # docx | pdf | md | txt | json


# --- Аналитический дашборд (п. 4.5) ---

class KpiDTO(BaseModel):
    """Ключевые показатели-разбиение: total = in_work + done + overdue + closed."""

    total: int
    in_work: int
    done: int
    overdue: int
    closed: int = 0  # закрыто без исполнения (отдельная категория)


class HighlightsDTO(BaseModel):
    overdue: list[TaskDTO] = Field(default_factory=list)
    priority: list[TaskDTO] = Field(default_factory=list)


class FilterOptionsDTO(BaseModel):
    responsibles: list[str] = Field(default_factory=list)
    locations: list[str] = Field(default_factory=list)
    objects: list[str] = Field(default_factory=list)
    themes: list[str] = Field(default_factory=list)
    priorities: list[str] = Field(default_factory=list)
    statuses: list[str] = Field(default_factory=list)


class RatingBreakdownDTO(BaseModel):
    """Детализация вклада одного условия в балл исполнителя (со ссылками)."""

    condition: str          # ключ из analytics.RATING_CONDITIONS
    label: str              # человекочитаемая формулировка условия
    count: int              # сколько поручений подошло под условие
    points_each: float      # балл за одно поручение (из правила)
    points: float           # суммарный вклад (count * points_each)
    task_ids: list[str] = Field(default_factory=list)


class ExecutorRatingDTO(BaseModel):
    responsible: str
    score: float
    total_tasks: int
    breakdown: list[RatingBreakdownDTO] = Field(default_factory=list)


class DashboardAnalyticsDTO(BaseModel):
    now: datetime  # срез, на который посчитаны показатели
    kpis: KpiDTO
    ratings: list[ExecutorRatingDTO] = Field(default_factory=list)
    highlights: HighlightsDTO
    filter_options: FilterOptionsDTO


# --- Утренняя справка (п. 4.5.2) ---

class BriefTaskDTO(BaseModel):
    id: str
    assignment: str = ""
    responsible: str = ""
    deadline: str = ""
    priority: str = ""


class BriefChangesDTO(BaseModel):
    since: datetime | None = None  # as_of прошлой справки
    first: bool = False            # первая справка (сравнивать не с чем)
    new_tasks: int = 0
    newly_done: int = 0
    newly_overdue: int = 0


class MorningBriefDTO(BaseModel):
    id: str
    as_of: datetime            # срез (дата/время), на который сформирована — 4.5.5
    generated_at: datetime
    kpis: KpiDTO
    status_counts: dict[str, int] = Field(default_factory=dict)
    overdue: list[BriefTaskDTO] = Field(default_factory=list)
    priority_soon: list[BriefTaskDTO] = Field(default_factory=list)
    changes: BriefChangesDTO = Field(default_factory=BriefChangesDTO)


class MorningBriefListItem(BaseModel):
    id: str
    as_of: datetime
    generated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# --- Правила рейтинга (п. 4.5.3, CRUD для admin) ---

class RatingConditionDTO(BaseModel):
    """Элемент фиксированного каталога условий начисления баллов."""

    key: str
    label: str


class RatingRuleDTO(BaseModel):
    id: str
    condition: str
    label: str      # формулировка условия из каталога
    points: float
    enabled: bool
    created_at: datetime


class RatingRuleCreate(BaseModel):
    condition: str
    points: float
    enabled: bool = True


class RatingRuleUpdate(BaseModel):
    points: float | None = None
    enabled: bool | None = None


class RatingRulesResponse(BaseModel):
    rules: list[RatingRuleDTO] = Field(default_factory=list)
    conditions: list[RatingConditionDTO] = Field(default_factory=list)  # доступный каталог


# --- Auth / Users (ТЗ 3) ---

class LoginRequest(BaseModel):
    username: str
    password: str


class UserDTO(BaseModel):
    id: str
    username: str
    full_name: str = ""
    role: str
    is_active: bool = True
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class LoginResponse(BaseModel):
    token: str
    user: UserDTO
    permissions: list[str] = Field(default_factory=list)


class MeResponse(BaseModel):
    """Текущий пользователь + флаг, включена ли авторизация в системе."""

    auth_enabled: bool
    authenticated: bool
    user: UserDTO | None = None
    permissions: list[str] = Field(default_factory=list)


class DemoAccountDTO(BaseModel):
    """Демо-учётка для страницы входа (opt-in auth.seed_demo). Пароль отдаётся
    намеренно — это одноразовые демо-роли, чтобы показать вход разным ролям."""

    username: str
    password: str
    role: str
    role_label: str
    full_name: str = ""


class DemoAccountsResponse(BaseModel):
    accounts: list[DemoAccountDTO] = Field(default_factory=list)


class UserCreate(BaseModel):
    username: str
    password: str
    full_name: str = ""
    role: str = "executor"


class UserUpdate(BaseModel):
    full_name: str | None = None
    role: str | None = None
    password: str | None = None
    is_active: bool | None = None
