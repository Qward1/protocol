import asyncio
from pathlib import Path

import httpx

from app.config import settings


CONFIRM_BUTTON_TEXT = "Подтвердить исполнение"
MANAGER_CONFIRM_BUTTON_TEXT = "Подтвердить выполнение"


class MaxClient:
    def __init__(self) -> None:
        self.base_url = settings.max_api_base_url.rstrip("/")
        self.token = settings.max_bot_token

    @property
    def enabled(self) -> bool:
        return bool(self.token)

    def headers(self) -> dict:
        return {"Authorization": self.token, "Content-Type": "application/json"}

    def upload_headers(self) -> dict:
        return {"Authorization": self.token}

    async def send_message(self, text: str, chat_id: str | None = None, attachments: list | None = None) -> dict:
        if not self.enabled:
            return {"disabled": True, "text": text}

        target_chat_id = chat_id or settings.max_chat_id
        params = {"chat_id": target_chat_id}
        body = {"text": text}

        if attachments:
            body["attachments"] = attachments

        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            response = await client.post(
                f"{self.base_url}/messages",
                params=params,
                headers=self.headers(),
                json=body,
            )

            if response.status_code >= 400:
                print("MAX SEND ERROR STATUS:", response.status_code)
                print("MAX SEND ERROR BODY:", response.text)
                print("MAX SEND PAYLOAD:", body)

            response.raise_for_status()
            return response.json() if response.content else {"ok": True}

    async def answer_callback(self, callback_id: str | None, notification: str | None = None, message: dict | None = None) -> dict:
        if not callback_id or not self.enabled:
            return {"disabled": True}

        body = {}

        if notification:
            body["notification"] = notification

        if message:
            body["message"] = message

        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            response = await client.post(
                f"{self.base_url}/answers",
                params={"callback_id": callback_id},
                headers=self.headers(),
                json=body,
            )

            if response.status_code >= 400:
                print("MAX CALLBACK ERROR STATUS:", response.status_code)
                print("MAX CALLBACK ERROR BODY:", response.text)

            response.raise_for_status()
            return response.json() if response.content else {"ok": True}

    async def upload_file(self, file_path: str) -> dict:
        if not self.enabled:
            return {"disabled": True}

        path = Path(file_path)

        async with httpx.AsyncClient(timeout=180.0, follow_redirects=True) as client:
            upload_response = await client.post(
                f"{self.base_url}/uploads",
                params={"type": "file"},
                headers=self.upload_headers(),
            )
            upload_response.raise_for_status()
            upload_info = upload_response.json()
            upload_url = upload_info["url"]

            with path.open("rb") as file:
                file_response = await client.post(
                    upload_url,
                    headers=self.upload_headers(),
                    files={"data": (path.name, file, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
                )

            if file_response.status_code >= 400:
                print("MAX FILE UPLOAD ERROR STATUS:", file_response.status_code)
                print("MAX FILE UPLOAD ERROR BODY:", file_response.text)

            file_response.raise_for_status()
            return file_response.json()

    async def send_file(self, file_path: str, text: str = "", chat_id: str | None = None) -> dict:
        upload_result = await self.upload_file(file_path)

        if upload_result.get("disabled"):
            return upload_result

        attachments = [
            {
                "type": "file",
                "payload": upload_result,
            }
        ]

        last_error = None

        for attempt in range(4):
            try:
                return await self.send_message(text or "Служебная записка", chat_id=chat_id, attachments=attachments)
            except httpx.HTTPStatusError as exc:
                last_error = exc
                body = exc.response.text if exc.response is not None else ""

                if "attachment.not.ready" not in body and "not.processed" not in body:
                    raise

                await asyncio.sleep(2 + attempt * 2)

        raise last_error


def confirmation_keyboard(task_id: str) -> list:
    return [
        {
            "type": "inline_keyboard",
            "payload": {
                "buttons": [
                    [
                        {
                            "type": "callback",
                            "text": CONFIRM_BUTTON_TEXT,
                            "payload": f"confirm:{task_id}",
                        }
                    ]
                ]
            },
        }
    ]


def manager_approval_keyboard(task_id: str) -> list:
    return [
        {
            "type": "inline_keyboard",
            "payload": {
                "buttons": [
                    [
                        {
                            "type": "callback",
                            "text": MANAGER_CONFIRM_BUTTON_TEXT,
                            "payload": f"approve:{task_id}",
                        }
                    ]
                ]
            },
        }
    ]
