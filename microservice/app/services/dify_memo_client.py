from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import httpx

from app.config import settings
from app.models import Task


TRIGGER_MESSAGE = "Создание справки(служебной записки)"


def _get_setting(name: str, default=None):
    return getattr(settings, name, default)


def enabled() -> bool:
    return bool(_get_setting("dify_memo_api_key", ""))


def _format_value(value) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.isoformat(sep=" ", timespec="minutes")
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def build_query(task: Task) -> str:
    trigger = _get_setting("dify_memo_trigger_message", TRIGGER_MESSAGE) or TRIGGER_MESSAGE

    return (
        f"{trigger}\n\n"
        f"Задача: {task.assignment or '-'}\n"
        f"Ответственный: {task.responsible or '-'}\n"
        f"Встреча: {task.meeting_title or '-'}\n"
        f"Срок исполнения: {_format_value(task.deadline)}\n"
        f"Дата закрытия: {_format_value(task.closed_at)}\n"
        f"Что сделал сотрудник: {task.completion_text or '-'}"
    )


def build_inputs(task: Task) -> dict[str, str]:
    return {
        "task": task.assignment or "",
        "assignment": task.assignment or "",
        "responsible": task.responsible or "",
        "meeting_title": task.meeting_title or "",
        "deadline": _format_value(task.deadline),
        "closed_at": _format_value(task.closed_at),
        "completion_text": task.completion_text or "",
        "command": _get_setting("dify_memo_trigger_message", TRIGGER_MESSAGE) or TRIGGER_MESSAGE,
    }


def _storage_path(task: Task) -> Path:
    storage_dir = Path(_get_setting("storage_dir", "./storage")) / "dify_memos"
    storage_dir.mkdir(parents=True, exist_ok=True)
    safe_id = re.sub(r"[^A-Za-z0-9_.-]+", "_", task.id)
    return storage_dir / f"spravka_{safe_id}.docx"


def _looks_like_docx_url(value: str) -> bool:
    lower = value.lower()
    return (
        lower.startswith("http://")
        or lower.startswith("https://")
        or lower.startswith("/files/")
        or lower.startswith("/v1/files/")
    ) and (".docx" in lower or "file" in lower or "files" in lower)


def _collect_file_urls(value: Any) -> list[str]:
    urls: list[str] = []

    if isinstance(value, dict):
        for key in ("url", "remote_url", "download_url", "file_url", "preview_url"):
            found = value.get(key)
            if isinstance(found, str) and _looks_like_docx_url(found):
                urls.append(found)

        for nested in value.values():
            urls.extend(_collect_file_urls(nested))

    elif isinstance(value, list):
        for item in value:
            urls.extend(_collect_file_urls(item))

    elif isinstance(value, str):
        for found in re.findall(r"https?://[^\s'\"<>]+", value):
            if _looks_like_docx_url(found):
                urls.append(found)

    result = []
    seen = set()
    for url in urls:
        if url not in seen:
            seen.add(url)
            result.append(url)
    return result


def _absolute_url(url: str) -> str:
    if url.startswith("http://") or url.startswith("https://"):
        return url
    return urljoin((_get_setting("dify_memo_base_url", "https://dify.t1v.scibox.tech/v1") or "").rstrip("/") + "/", url.lstrip("/"))


async def _download_file(client: httpx.AsyncClient, url: str, task: Task) -> str:
    out_path = _storage_path(task)
    response = await client.get(_absolute_url(url))
    response.raise_for_status()
    out_path.write_bytes(response.content)
    return str(out_path)


async def _request_blocking(client: httpx.AsyncClient, payload: dict, task: Task) -> str | None:
    response = await client.post("/chat-messages", json=payload)
    response.raise_for_status()
    data = response.json()
    urls = _collect_file_urls(data)
    if not urls:
        return None
    return await _download_file(client, urls[0], task)


async def _request_streaming(client: httpx.AsyncClient, payload: dict, task: Task) -> str | None:
    urls: list[str] = []

    async with client.stream("POST", "/chat-messages", json=payload) as response:
        response.raise_for_status()
        async for line in response.aiter_lines():
            line = line.strip()
            if not line or not line.startswith("data:"):
                continue

            raw = line.removeprefix("data:").strip()
            if raw == "[DONE]":
                break

            try:
                event = json.loads(raw)
            except Exception:
                continue

            urls.extend(_collect_file_urls(event))

    if not urls:
        return None

    return await _download_file(client, urls[0], task)


async def generate_dify_memo(task: Task) -> str | None:
    if not enabled():
        return None

    base_url = (_get_setting("dify_memo_base_url", "https://dify.t1v.scibox.tech/v1") or "").rstrip("/")
    api_key = _get_setting("dify_memo_api_key", "")
    response_mode = _get_setting("dify_memo_response_mode", "streaming") or "streaming"
    user = _get_setting("dify_memo_user", "execution-control-service") or "execution-control-service"

    payload = {
        "inputs": build_inputs(task),
        "query": build_query(task),
        "response_mode": response_mode,
        "conversation_id": "",
        "user": user,
        "files": [],
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    timeout = httpx.Timeout(180.0, connect=20.0)

    try:
        async with httpx.AsyncClient(base_url=base_url, headers=headers, timeout=timeout, follow_redirects=True) as client:
            if response_mode == "streaming":
                return await _request_streaming(client, payload, task)
            return await _request_blocking(client, payload, task)

    except Exception as exc:
        print(f"Dify memo generation failed: {exc}")
        return None
