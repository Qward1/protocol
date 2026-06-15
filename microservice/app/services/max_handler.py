from datetime import timedelta

from sqlalchemy.orm import Session

from app.config import settings
from app.models import ConfirmationSession, Task
from app.services.dify_memo_client import generate_dify_memo
from app.services.max_client import MaxClient, manager_approval_keyboard
from app.services.memo import generate_memo
from app.services.notifier import now_local_naive
from app.services.tasks import mark_task_completed


ASK_TEXT = "Введите одним сообщением, что было сделано для закрытия задачи."
WAIT_MANAGER_TEXT = "Исполнение отправлено руководителю на подтверждение."
APPROVAL_TEXT = "Руководитель, подтвердите выполнение задачи."
APPROVED_TEXT = "Выполнение задачи подтверждено."
MEMO_SENT_TEXT = "Служебная записка сформирована."


def dig(data, *paths):
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


def event_type(update: dict) -> str | None:
    return update.get("update_type") or update.get("type") or dig(update, ("update", "update_type"))


def callback_payload(update: dict) -> str | None:
    return dig(
        update,
        ("callback", "payload"),
        ("callback", "button", "payload"),
        ("message_callback", "payload"),
        ("payload",),
        ("callback_payload",),
    )


def callback_id(update: dict) -> str | None:
    return dig(update, ("callback", "callback_id"), ("message_callback", "callback_id"), ("callback_id",))


def from_user_id(update: dict) -> str | None:
    value = dig(
        update,
        ("user", "user_id"),
        ("from", "user_id"),
        ("callback", "user", "user_id"),
        ("message", "sender", "user_id"),
        ("sender", "user_id"),
    )
    return str(value) if value is not None else None


def chat_id(update: dict) -> str | None:
    value = dig(
        update,
        ("chat", "chat_id"),
        ("message", "chat", "chat_id"),
        ("callback", "message", "chat", "chat_id"),
        ("chat_id",),
    )
    return str(value) if value is not None else None


def message_text(update: dict) -> str | None:
    return dig(update, ("message", "body", "text"), ("message", "text"), ("text",), ("body", "text"))


def is_callback(update: dict) -> bool:
    return event_type(update) == "message_callback" or callback_payload(update) is not None


def is_message(update: dict) -> bool:
    return event_type(update) == "message_created" or message_text(update) is not None


def task_short_info(task: Task) -> str:
    return (
        f"Ответственный: {task.responsible or '-'}\n"
        f"Поручение: {task.assignment or '-'}"
    )


def task_review_info(task: Task) -> str:
    return (
        f"Ответственный: {task.responsible or '-'}\n"
        f"Поручение: {task.assignment or '-'}\n"
        f"Что сделано: {task.completion_text or '-'}"
    )


async def handle_employee_confirmation(db: Session, update: dict, payload: str) -> dict:
    task_id = payload.split(":", 1)[1]
    task = db.get(Task, task_id)
    user_id = from_user_id(update)

    if task is None or not user_id:
        await MaxClient().answer_callback(callback_id(update), notification="Task not found")
        return {"error": "task not found"}

    now = now_local_naive()

    db.query(ConfirmationSession).filter(
        ConfirmationSession.max_user_id == user_id,
        ConfirmationSession.active.is_(True),
    ).update({"active": False})

    session = ConfirmationSession(
        max_user_id=user_id,
        chat_id=chat_id(update),
        task_id=task_id,
        active=True,
        expires_at=now + timedelta(hours=12),
    )

    db.add(session)
    db.commit()

    await MaxClient().answer_callback(callback_id(update), notification=ASK_TEXT)

    await MaxClient().send_message(
        f"{task.max_username or ''}\n{ASK_TEXT}\n{task_short_info(task)}",
        chat_id=chat_id(update),
    )

    return {"status": "waiting_for_completion_text", "task_id": task_id}


async def handle_manager_approval(db: Session, update: dict, payload: str) -> dict:
    task_id = payload.split(":", 1)[1]
    task = db.get(Task, task_id)

    if task is None:
        await MaxClient().answer_callback(callback_id(update), notification="Task not found")
        return {"error": "task not found"}

    if not task.completion_text:
        await MaxClient().answer_callback(callback_id(update), notification="Нет текста исполнения")
        return {"error": "completion text is empty"}

    now = now_local_naive()
    task.closed_at = now
    db.commit()
    db.refresh(task)

    memo_path = await generate_dify_memo(task)

    if not memo_path and getattr(settings, "dify_memo_fallback_local", True):
        memo_path = generate_memo(task)

    mark_task_completed(db, task, task.completion_text, now, memo_path)
    db.commit()
    db.refresh(task)

    await MaxClient().answer_callback(callback_id(update), notification="Выполнение подтверждено")

    await MaxClient().send_message(
        f"{APPROVED_TEXT}\n{task_review_info(task)}",
        chat_id=chat_id(update),
    )

    if memo_path:
        await MaxClient().send_file(
            memo_path,
            text=f"{MEMO_SENT_TEXT}\n{task_short_info(task)}",
            chat_id=chat_id(update),
        )

    return {"status": "approved", "task_id": task.id, "memo_path": memo_path}


async def handle_callback(db: Session, update: dict) -> dict:
    payload = callback_payload(update) or ""

    if payload.startswith("confirm:"):
        return await handle_employee_confirmation(db, update, payload)

    if payload.startswith("approve:"):
        return await handle_manager_approval(db, update, payload)

    return {"ignored": True}


async def handle_message(db: Session, update: dict) -> dict:
    user_id = from_user_id(update)
    text = (message_text(update) or "").strip()

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
    session.active = False
    db.commit()
    db.refresh(task)

    await MaxClient().send_message(
        f"{WAIT_MANAGER_TEXT}\n\n{APPROVAL_TEXT}\n{task_review_info(task)}",
        chat_id=chat_id(update),
        attachments=manager_approval_keyboard(task.id),
    )

    return {"status": "waiting_for_manager_approval", "task_id": task.id}


async def handle_update(db: Session, update: dict) -> dict:
    if is_callback(update):
        return await handle_callback(db, update)

    if is_message(update):
        return await handle_message(db, update)

    return {"ignored": True}
