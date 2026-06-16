"""Клиент MAX Bot API: сообщения, ответы на callback, загрузка и отправка файлов.

Логика перенесена в backend (раньше жила в референсном microservice/). Все вызовы
«мягкие»: если бот не сконфигурирован (`max.bot_token` пуст) — методы возвращают
``{"disabled": True}`` и ничего не шлют, чтобы остальной API работал.

Inline-кнопки используют payload вида ``confirm:<task_id>`` / ``approve:<task_id>``.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import httpx

from app.config import settings
from app.logging_config import get_logger

log = get_logger("max-client")

CONFIRM_BUTTON_TEXT = "Подтвердить исполнение"
MANAGER_CONFIRM_BUTTON_TEXT = "Подтвердить выполнение"


class MaxClient:
    def __init__(self) -> None:
        self.base_url = settings.max.api_base_url.rstrip("/")
        self.token = settings.max.bot_token

    @property
    def enabled(self) -> bool:
        return bool(self.token)

    def _headers(self) -> dict:
        return {"Authorization": self.token, "Content-Type": "application/json"}

    def _upload_headers(self) -> dict:
        return {"Authorization": self.token}

    async def send_message(
        self,
        text: str,
        chat_id: str | None = None,
        attachments: list | None = None,
    ) -> dict:
        if not self.enabled:
            return {"disabled": True, "text": text}

        # Если chat_id не передан — шлём в группу по умолчанию (max.chat_id).
        target_chat_id = chat_id or settings.max.chat_id
        if not target_chat_id:
            log.warning("MAX send_message: не задан chat_id и нет max.chat_id")
            return {"error": "no chat_id"}

        body: dict = {"text": text}
        if attachments:
            body["attachments"] = attachments

        async with httpx.AsyncClient(timeout=settings.max.request_timeout, follow_redirects=True) as client:
            response = await client.post(
                f"{self.base_url}/messages",
                params={"chat_id": target_chat_id},
                headers=self._headers(),
                json=body,
            )
            if response.status_code >= 400:
                log.warning("MAX send error %s: %s", response.status_code, response.text)
            response.raise_for_status()
            return response.json() if response.content else {"ok": True}

    async def answer_callback(
        self,
        callback_id: str | None,
        notification: str | None = None,
        message: dict | None = None,
    ) -> dict:
        if not callback_id or not self.enabled:
            return {"disabled": True}

        body: dict = {}
        if notification:
            body["notification"] = notification
        if message:
            body["message"] = message

        async with httpx.AsyncClient(timeout=settings.max.request_timeout, follow_redirects=True) as client:
            response = await client.post(
                f"{self.base_url}/answers",
                params={"callback_id": callback_id},
                headers=self._headers(),
                json=body,
            )
            if response.status_code >= 400:
                log.warning("MAX callback error %s: %s", response.status_code, response.text)
            response.raise_for_status()
            return response.json() if response.content else {"ok": True}

    async def list_subscriptions(self) -> dict:
        """Получить список зарегистрированных вебхуков бота (MAX Bot API)."""
        if not self.enabled:
            return {"disabled": True}
        async with httpx.AsyncClient(timeout=settings.max.request_timeout, follow_redirects=True) as client:
            response = await client.get(f"{self.base_url}/subscriptions", headers=self._headers())
            response.raise_for_status()
            return response.json() if response.content else {"subscriptions": []}

    async def subscribe(self, url: str) -> dict:
        """Зарегистрировать вебхук: MAX будет слать сюда сообщения и нажатия кнопок."""
        if not self.enabled:
            return {"disabled": True}
        async with httpx.AsyncClient(timeout=settings.max.request_timeout, follow_redirects=True) as client:
            response = await client.post(
                f"{self.base_url}/subscriptions",
                headers=self._headers(),
                json={"url": url},
            )
            if response.status_code >= 400:
                log.warning("MAX subscribe error %s: %s", response.status_code, response.text)
            response.raise_for_status()
            return response.json() if response.content else {"ok": True}

    async def ensure_subscription(self, url: str) -> dict:
        """Идемпотентно зарегистрировать вебхук: пропустить, если он уже есть."""
        if not self.enabled or not url:
            return {"skipped": True}
        try:
            existing = await self.list_subscriptions()
            urls = {s.get("url") for s in existing.get("subscriptions", []) if isinstance(s, dict)}
            if url in urls:
                return {"ok": True, "already": True}
            result = await self.subscribe(url)
            log.info("MAX: вебхук зарегистрирован (%s)", url)
            return result
        except Exception as exc:  # noqa: BLE001 — старт не должен падать из-за MAX
            log.warning("MAX: не удалось зарегистрировать вебхук: %s", exc)
            return {"error": str(exc)}

    async def upload_file(self, file_path: str) -> dict:
        if not self.enabled:
            return {"disabled": True}

        path = Path(file_path)
        docx_mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

        async with httpx.AsyncClient(timeout=180.0, follow_redirects=True) as client:
            upload_response = await client.post(
                f"{self.base_url}/uploads",
                params={"type": "file"},
                headers=self._upload_headers(),
            )
            upload_response.raise_for_status()
            upload_url = upload_response.json()["url"]

            with path.open("rb") as file:
                file_response = await client.post(
                    upload_url,
                    headers=self._upload_headers(),
                    files={"data": (path.name, file, docx_mime)},
                )
            if file_response.status_code >= 400:
                log.warning("MAX upload error %s: %s", file_response.status_code, file_response.text)
            file_response.raise_for_status()
            return file_response.json()

    async def send_file(self, file_path: str, text: str = "", chat_id: str | None = None) -> dict:
        upload_result = await self.upload_file(file_path)
        if upload_result.get("disabled"):
            return upload_result

        attachments = [{"type": "file", "payload": upload_result}]
        last_error: Exception | None = None

        # Файл на стороне MAX может ещё «дозревать» — повторяем несколько раз.
        for attempt in range(4):
            try:
                return await self.send_message(text or "Служебная записка", chat_id=chat_id, attachments=attachments)
            except httpx.HTTPStatusError as exc:
                last_error = exc
                body = exc.response.text if exc.response is not None else ""
                if "attachment.not.ready" not in body and "not.processed" not in body:
                    raise
                await asyncio.sleep(2 + attempt * 2)

        if last_error:
            raise last_error
        return {"error": "send_file failed"}


def confirmation_keyboard(task_id: str) -> list:
    """Кнопка для сотрудника: «Подтвердить исполнение»."""
    return [{
        "type": "inline_keyboard",
        "payload": {"buttons": [[{
            "type": "callback",
            "text": CONFIRM_BUTTON_TEXT,
            "payload": f"confirm:{task_id}",
        }]]},
    }]


def manager_approval_keyboard(task_id: str) -> list:
    """Кнопка для руководителя: «Подтвердить выполнение»."""
    return [{
        "type": "inline_keyboard",
        "payload": {"buttons": [[{
            "type": "callback",
            "text": MANAGER_CONFIRM_BUTTON_TEXT,
            "payload": f"approve:{task_id}",
        }]]},
    }]
