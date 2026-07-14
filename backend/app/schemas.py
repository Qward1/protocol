"""Pydantic DTO для REST API."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


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
    status: str
    source_fragment: str = ""
    reason_comment: str = ""
    confidence: float = 0.0
    max_username: str = ""
    max_chat_id: str = ""
    completion_text: str = ""
    closed_at: datetime | None = None
    notified_at: datetime | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TaskUpdate(BaseModel):
    """Частичное обновление поручения (ручная правка)."""

    assignment: str | None = None
    responsible: str | None = None
    department: str | None = None
    deadline: str | None = None
    status: str | None = None
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
    object_type: str  # protocol | transcription | chat | justification
    object_id: str
    fmt: str  # docx | pdf | md | txt | json


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
