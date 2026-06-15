"""Обработка входящих апдейтов MAX-бота (вебхук).

Цепочка подтверждения исполнения:
1. Сотрудник нажимает «Подтвердить исполнение» (``confirm:<task_id>``).
2. Бот просит написать, что сделано; открывается ConfirmationSession.
3. Сотрудник присылает текст -> статус «Требует проверки», руководителю уходит
   кнопка «Подтвердить выполнение» (``approve:<task_id>``).
4. Руководитель подтверждает -> задача «Выполнено», формируется справка (Dify или
   локальный DOCX), строка в Google Таблице зеленеет, DOCX уходит в тот же чат.
"""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy.orm import Session

from app.logging_config import get_logger
from app.models import ConfirmationSession, Task
from app.config import settings
from app.services import memo, sheet_client
from app.services.max_client import MaxClient, confirmation_keyboard, manager_approval_keyboard
from app.services.reminders import now_local_naive

log = get_logger("max-handler")

ASK_TEXT = "Введите одним сообщением, что было сделано для закрытия задачи."
WAIT_MANAGER_TEXT = "Исполнение отправлено руководителю на подтверждение."
APPROVAL_TEXT = "Руководитель, подтвердите выполнение задачи."
APPROVED_TEXT = "Выполнение задачи подтверждено."
MEMO_SENT_TEXT = "Служебная записка сформирована."


# --- извлечение полей из разных форм апдейта MAX ---

def _dig(data, *paths):
    for path in paths:
        current = data
        ok = True
        for key in path:
            if isinstance(current, dict) and key in current:
                current = current[key]
            else:
                ok = False
                break
        if ok and current is not None:
            return current
    return None


def _event_type(update: dict) -> str | None:
    return update.get("update_type") or update.get("type") or _dig(update, ("update", "update_type"))


def _callback_payload(update: dict) -> str | None:
    return _dig(
        update,
        ("callback", "payload"),
        ("callback", "button", "payload"),
        ("message_callback", "payload"),
        ("payload",),
        ("callback_payload",),
    )


def _callback_id(update: dict) -> str | None:
    return _dig(update, ("callback", "callback_id"), ("message_callback", "callback_id"), ("callback_id",))


def _from_user_id(update: dict) -> str | None:
    value = _dig(
        update,
        ("user", "user_id"),
        ("from", "user_id"),
        ("callback", "user", "user_id"),
        ("message", "sender", "user_id"),
        ("sender", "user_id"),
    )
    return str(value) if value is not None else None


def _chat_id(update: dict) -> str | None:
    value = _dig(
        update,
        ("chat", "chat_id"),
        ("message", "chat", "chat_id"),
        ("callback", "message", "chat", "chat_id"),
        ("chat_id",),
    )
    return str(value) if value is not None else None


def _message_text(update: dict) -> str | None:
    return _dig(update, ("message", "body", "text"), ("message", "text"), ("text",), ("body", "text"))


def _is_callback(update: dict) -> bool:
    return _event_type(update) == "message_callback" or _callback_payload(update) is not None


def _is_message(update: dict) -> bool:
    return _event_type(update) == "message_created" or _message_text(update) is not None


def _short(task: Task) -> str:
    return f"Ответственный: {task.responsible or '-'}\nПоручение: {task.assignment or '-'}"


def _review(task: Task) -> str:
    return (
        f"Ответственный: {task.responsible or '-'}\n"
        f"Поручение: {task.assignment or '-'}\n"
        f"Что сделано: {task.completion_text or '-'}"
    )


# --- обработчики шагов ---

async def _handle_employee_confirmation(db: Session, update: dict, payload: str) -> dict:
    task_id = payload.split(":", 1)[1]
    task = db.get(Task, task_id)
    user_id = _from_user_id(update)
    chat_id = _chat_id(update)

    if task is None or not user_id:
        await MaxClient().answer_callback(_callback_id(update), notification="Задача не найдена")
        return {"error": "task not found"}

    now = now_local_naive()
    # Гасим прочие активные сессии этого пользователя.
    db.query(ConfirmationSession).filter(
        ConfirmationSession.max_user_id == user_id,
        ConfirmationSession.active.is_(True),
    ).update({"active": False})

    db.add(ConfirmationSession(
        max_user_id=user_id,
        chat_id=chat_id or "",
        task_id=task_id,
        active=True,
        expires_at=now + timedelta(hours=12),
    ))
    db.commit()

    await MaxClient().answer_callback(_callback_id(update), notification=ASK_TEXT)
    await MaxClient().send_message(
        f"{task.max_username or ''}\n{ASK_TEXT}\n{_short(task)}",
        chat_id=chat_id,
    )
    return {"status": "waiting_for_completion_text", "task_id": task_id}


async def _handle_manager_approval(db: Session, update: dict, payload: str) -> dict:
    task_id = payload.split(":", 1)[1]
    task = db.get(Task, task_id)

    if task is None:
        await MaxClient().answer_callback(_callback_id(update), notification="Задача не найдена")
        return {"error": "task not found"}
    if not task.completion_text:
        await MaxClient().answer_callback(_callback_id(update), notification="Нет текста исполнения")
        return {"error": "completion text is empty"}

    task.closed_at = now_local_naive()
    task.status = "Выполнено"
    db.commit()
    db.refresh(task)

    memo_path = await memo.build_memo(task)
    if memo_path:
        task.memo_path = memo_path
    db.commit()
    db.refresh(task)

    # Реестр в Google Таблице: строка зеленеет.
    await sheet_client.mark_completed(task)

    chat_id = _chat_id(update)
    await MaxClient().answer_callback(_callback_id(update), notification="Выполнение подтверждено")
    await MaxClient().send_message(f"{APPROVED_TEXT}\n{_review(task)}", chat_id=chat_id)

    if memo_path:
        await MaxClient().send_file(memo_path, text=f"{MEMO_SENT_TEXT}\n{_short(task)}", chat_id=chat_id)

    return {"status": "approved", "task_id": task.id, "memo_path": memo_path}


async def _handle_callback(db: Session, update: dict) -> dict:
    payload = _callback_payload(update) or ""
    if payload.startswith("confirm:"):
        return await _handle_employee_confirmation(db, update, payload)
    if payload.startswith("approve:"):
        return await _handle_manager_approval(db, update, payload)
    return {"ignored": True}


async def _handle_message(db: Session, update: dict) -> dict:
    user_id = _from_user_id(update)
    text = (_message_text(update) or "").strip()
    if not user_id or not text:
        return {"ignored": True}

    now = now_local_naive()
    session = (
        db.query(ConfirmationSession)
        .filter(ConfirmationSession.max_user_id == user_id)
        .filter(ConfirmationSession.active.is_(True))
        .filter(ConfirmationSession.expires_at >= now)
        .order_by(ConfirmationSession.created_at.desc())
        .first()
    )
    if session is None:
        return {"ignored": True}

    task = db.get(Task, session.task_id)
    if task is None:
        session.active = False
        db.commit()
        return {"error": "task not found"}

    task.completion_text = text
    task.status = "Требует проверки"
    session.active = False
    db.commit()
    db.refresh(task)

    await sheet_client.upsert_task(task)
    await MaxClient().send_message(
        f"{WAIT_MANAGER_TEXT}\n\n{APPROVAL_TEXT}\n{_review(task)}",
        chat_id=_chat_id(update),
        attachments=manager_approval_keyboard(task.id),
    )
    return {"status": "waiting_for_manager_approval", "task_id": task.id}


async def notify_task_assigned(db: Session, task: Task, chat_id: str | None = None) -> dict:
    """Отправить в группу MAX карточку поручения с кнопкой «Подтвердить исполнение».

    Запоминает чат доставки в ``task.max_chat_id`` — туда же пойдут напоминания.
    """
    target = chat_id or task.max_chat_id or settings.max.chat_id
    if not target:
        return {"error": "no chat_id"}

    mention = f"{task.max_username} " if task.max_username else ""
    text = (
        f"{mention}Назначено поручение.\n"
        f"Ответственный: {task.responsible or '-'}\n"
        f"Поручение: {task.assignment or '-'}\n"
        f"Срок: {task.deadline or '-'}"
    )
    result = await MaxClient().send_message(
        text, chat_id=target, attachments=confirmation_keyboard(task.id)
    )
    if not result.get("error") and not result.get("disabled"):
        task.max_chat_id = target
        db.commit()
    return result


async def handle_update(db: Session, update: dict) -> dict:
    """Точка входа вебхука: маршрутизирует апдейт по типу."""
    if _is_callback(update):
        return await _handle_callback(db, update)
    if _is_message(update):
        return await _handle_message(db, update)
    return {"ignored": True}
