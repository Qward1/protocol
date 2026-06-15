"""Локальная служебная записка (DOCX) — фоллбэк, когда Dify не вернул файл.

Собирает markdown и рендерит существующим конвертером ``exporter._write_docx``,
чтобы не плодить вторую реализацию DOCX. Мягкий: при ошибке возвращает "".
"""

from __future__ import annotations

from datetime import datetime

from app.config import settings
from app.logging_config import get_logger
from app.models import Task
from app.services import dify_client, exporter, storage

log = get_logger("memo")


def _meeting_title(task: Task) -> str:
    protocol = getattr(task, "protocol", None)
    return (protocol.title if protocol else "") or "-"


def memo_to_md(task: Task) -> str:
    closed = task.closed_at.strftime("%d.%m.%Y %H:%M") if task.closed_at else "-"
    return "\n".join([
        "# Служебная записка о выполнении поручения",
        "",
        f"**Встреча:** {_meeting_title(task)}",
        f"**Ответственный:** {task.responsible or '-'}",
        f"**Поручение:** {task.assignment or '-'}",
        f"**Срок исполнения:** {task.deadline or '-'}",
        f"**Дата закрытия:** {closed}",
        "",
        "## Что сделано",
        task.completion_text or "-",
        "",
        f"_Сформировано автоматически {datetime.now().strftime('%d.%m.%Y %H:%M')}._",
    ])


async def build_memo(task: Task) -> str:
    """Сформировать справку: сначала через Dify, при неудаче — локальный DOCX.

    Возвращает путь к файлу или "". Используется и REST-подтверждением, и MAX-ботом.
    """
    query = (
        f"{settings.dify.command_memo}\n\n"
        f"Встреча: {task.protocol.title if getattr(task, 'protocol', None) else '-'}\n"
        f"Поручение: {task.assignment}\nОтветственный: {task.responsible}\n"
        f"Срок исполнения: {task.deadline}\n"
        f"Что сделал сотрудник: {task.completion_text}"
    )
    result = await dify_client.run_command(
        command=settings.dify.command_memo,
        query=query,
        inputs={
            "assignment": task.assignment,
            "responsible": task.responsible,
            "completion_text": task.completion_text,
            "context": task.completion_text,
        },
        name_hint=f"memo_{task.id}",
    )
    if result.files:
        return result.files[0]
    return generate_memo(task)


def generate_memo(task: Task) -> str:
    """Сгенерировать локальный DOCX по задаче. Возвращает путь к файлу или ""."""
    try:
        out = exporter.render(memo_to_md(task), {}, "docx", f"spravka_{task.id}")
        return str(out)
    except Exception as exc:  # noqa: BLE001
        log.warning("Локальная справка не сформирована: %s", exc)
        # Текстовый суррогат, чтобы поток подтверждения не падал без python-docx.
        try:
            path = storage.docs_dir() / f"spravka_{storage.safe_name(task.id)}.txt"
            path.write_text(memo_to_md(task), encoding="utf-8")
            return str(path)
        except Exception:
            return ""
