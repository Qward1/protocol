"""Клиент Dify: /chat-messages (текст + DOCX) и Dataset API (историческая память).

Логика стриминга и сбора файловых URL переиспользует подход из
microservice/app/services/dify_memo_client.py.

Все вызовы «мягкие»: при отсутствии ключей/ошибке возвращают пустой результат,
чтобы каркас работал даже без настроенного Dify (фронт получит понятный ответ).
"""

from __future__ import annotations

from dataclasses import dataclass, field
import json
from pathlib import Path
import re
from typing import Any
from urllib.parse import urljoin

import httpx

from app.config import settings
from app.logging_config import get_logger
from app.services import storage

log = get_logger("dify")


@dataclass
class DifyResult:
    answer: str = ""
    files: list[str] = field(default_factory=list)  # локальные пути скачанных файлов
    raw: dict[str, Any] = field(default_factory=dict)


def app_enabled() -> bool:
    return bool(settings.dify.app_api_key)


def dataset_enabled() -> bool:
    return bool(settings.dify.dataset_api_key and settings.dify.transcripts_dataset_id)


def _response_text(response: httpx.Response) -> str:
    """Безопасно вернуть тело ответа для логов, включая streaming responses."""
    try:
        return response.text[:1000]
    except httpx.ResponseNotRead:
        return "<streaming response body was not read>"
    except Exception:
        return ""


# --- сбор файловых URL (как в dify_memo_client) ---

def _looks_like_file_url(value: str) -> bool:
    lower = value.lower()
    return (
        lower.startswith(("http://", "https://", "/files/", "/v1/files/"))
        and (".docx" in lower or "file" in lower or "files" in lower)
    )


def _collect_file_urls(value: Any) -> list[str]:
    urls: list[str] = []
    if isinstance(value, dict):
        for key in ("url", "remote_url", "download_url", "file_url", "preview_url"):
            found = value.get(key)
            if isinstance(found, str) and _looks_like_file_url(found):
                urls.append(found)
        for nested in value.values():
            urls.extend(_collect_file_urls(nested))
    elif isinstance(value, list):
        for item in value:
            urls.extend(_collect_file_urls(item))
    elif isinstance(value, str):
        for found in re.findall(r"https?://[^\s'\"<>]+", value):
            if _looks_like_file_url(found):
                urls.append(found)
    seen: set[str] = set()
    out: list[str] = []
    for url in urls:
        if url not in seen:
            seen.add(url)
            out.append(url)
    return out


def _absolute_url(url: str) -> str:
    if url.startswith(("http://", "https://")):
        return url
    base = settings.dify.base_url.rstrip("/") + "/"
    return urljoin(base, url.lstrip("/"))


async def _download(client: httpx.AsyncClient, url: str, name_hint: str) -> str:
    resp = await client.get(_absolute_url(url))
    resp.raise_for_status()
    out = storage.docs_dir() / f"{storage.safe_name(name_hint)}.docx"
    out.write_bytes(resp.content)
    return str(out)


# --- основной вызов команды workflow ---

async def run_command(
    command: str,
    query: str,
    inputs: dict[str, Any] | None = None,
    name_hint: str = "dify",
    conversation_id: str = "",
) -> DifyResult:
    """Вызвать ветку workflow (Question Classifier маршрутизирует по `command`).

    `query` — пользовательский ввод (включая текст транскрипта/вопроса).
    `inputs` — переменные workflow.
    """
    if not app_enabled():
        return DifyResult(answer="", raw={"error": "dify app_api_key not configured"})

    cfg = settings.dify
    # Question Classifier маршрутизирует по sys.query. Большие тексты (транскрипты)
    # не кладём в query: Dify часто отвечает 400 на длинный query. Полный текст
    # передаётся через inputs, а query остаётся короткой командой/вопросом.
    if command:
        routed_query = command if len(query) > 4000 else f"{command}\n\n{query}"
    else:
        routed_query = query
    payload = {
        "inputs": {"command": command, **(inputs or {})},
        "query": routed_query,
        "response_mode": cfg.response_mode,
        "conversation_id": conversation_id,
        "user": cfg.user,
        "files": [],
    }
    headers = {"Authorization": f"Bearer {cfg.app_api_key}", "Content-Type": "application/json"}
    timeout = httpx.Timeout(cfg.request_timeout, connect=20.0)

    try:
        async with httpx.AsyncClient(
            base_url=cfg.base_url.rstrip("/"), headers=headers, timeout=timeout, follow_redirects=True
        ) as client:
            if cfg.response_mode == "streaming":
                result = await _run_streaming(client, payload)
            else:
                result = await _run_blocking(client, payload)
            for url in _collect_file_urls(result.raw):
                result.files.append(await _download(client, url, name_hint))
            return result
    except Exception as exc:  # каркас не должен падать из-за внешнего сервиса
        detail = ""
        if isinstance(exc, httpx.HTTPStatusError):
            detail = f" response={_response_text(exc.response)}"
        log.warning("Dify run_command(%s) failed: %s%s", command, exc, detail)
        return DifyResult(answer="", raw={"error": str(exc)})


async def _run_blocking(client: httpx.AsyncClient, payload: dict) -> DifyResult:
    resp = await client.post("/chat-messages", json=payload)
    resp.raise_for_status()
    data = resp.json()
    return DifyResult(answer=str(data.get("answer", "")), raw=data)


async def _run_streaming(client: httpx.AsyncClient, payload: dict) -> DifyResult:
    answer_parts: list[str] = []
    raw_events: list[dict] = []
    async with client.stream("POST", "/chat-messages", json=payload) as resp:
        if resp.status_code >= 400:
            await resp.aread()
        resp.raise_for_status()
        async for line in resp.aiter_lines():
            line = line.strip()
            if not line or not line.startswith("data:"):
                continue
            chunk = line.removeprefix("data:").strip()
            if chunk == "[DONE]":
                break
            try:
                event = json.loads(chunk)
            except Exception:
                continue
            raw_events.append(event)
            if event.get("event") in ("message", "agent_message") and event.get("answer"):
                answer_parts.append(event["answer"])
    return DifyResult(answer="".join(answer_parts), raw={"events": raw_events})


# --- Dataset API: занесение транскрипта в БЗ (историческая память) ---

async def add_transcript_document(title: str, text: str, metadata: dict[str, Any]) -> dict[str, Any]:
    """Добавить транскрипт в датасет Dify как документ (create-by-text).

    Возвращает ответ Dify или {"error": ...}. Не падает при отсутствии конфигурации.
    """
    if not dataset_enabled():
        return {"error": "dify dataset not configured"}

    cfg = settings.dify
    url = f"{cfg.base_url.rstrip('/')}/datasets/{cfg.transcripts_dataset_id}/document/create-by-text"
    payload = {
        "name": title[:128] or "transcript",
        "text": text,
        "indexing_technique": "high_quality",
        "process_rule": {"mode": "automatic"},
        # метаданные (meeting_id, дата) для цитат и фильтрации в поиске
        "doc_metadata": metadata,
    }
    headers = {"Authorization": f"Bearer {cfg.dataset_api_key}", "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=cfg.request_timeout) as client:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            return resp.json()
    except Exception as exc:
        log.warning("Dify add_transcript_document failed: %s", exc)
        return {"error": str(exc)}


async def retrieve(query: str, top_k: int = 8) -> list[dict[str, Any]]:
    """Семантический поиск по датасету транскриптов (Dataset retrieve API)."""
    if not dataset_enabled():
        return []

    cfg = settings.dify
    url = f"{cfg.base_url.rstrip('/')}/datasets/{cfg.transcripts_dataset_id}/retrieve"
    payload = {
        "query": query,
        "retrieval_model": {
            "search_method": "hybrid_search",
            "reranking_enable": False,
            "top_k": top_k,
            "score_threshold_enabled": False,
        },
    }
    headers = {"Authorization": f"Bearer {cfg.dataset_api_key}", "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=cfg.request_timeout) as client:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            return data.get("records", []) or data.get("query", {}).get("records", [])
    except Exception as exc:
        log.warning("Dify retrieve failed: %s", exc)
        return []


def _safe_json_loads(text: str) -> dict[str, Any]:
    """Извлечь JSON из ответа LLM (на случай обёртки в ```json ... ```)."""
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(\{.*\}|\[.*\])\s*```", text, re.DOTALL)
    if fence:
        text = fence.group(1)
    try:
        return json.loads(text)
    except Exception:
        # пробуем найти первый сбалансированный объект
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except Exception:
                return {}
        return {}
