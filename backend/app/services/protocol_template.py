"""Рендеринг протокола по редактируемому DOCX-шаблону (docxtpl, часть 2).

Пользователь загружает Word-документ с Jinja2-плейсхолдерами прямо в тексте
(``{{ title }}``, ``{% for t in tasks %}…{% endfor %}``). Мы обнаруживаем
плейсхолдеры, авто-сопоставляем их с каноническим каталогом полей протокола и
рендерим документ реальными данными.

Это НЕ LLM-логика (генерация документа), поэтому живёт в backend/, а не в Dify.
Мягкая деградация: битый .docx приводит к понятной ``ProtocolTemplateError``,
а не к сырому исключению/500 (шаблон пользователь трогает намеренно).
"""

from __future__ import annotations

import json
from pathlib import Path

from app.services import storage

# Канонический каталог полей. Только то, что реально есть в Protocol/Task —
# новых полей (председатель, присутствующие и т.п.) не придумываем.
CANONICAL_FIELDS = ["title", "date", "number", "body", "tasks"]


class ProtocolTemplateError(Exception):
    """Понятная ошибка обработки шаблона (битый .docx и т.п.)."""


def extract_placeholders(docx_path: str) -> list[str]:
    """Список неопределённых Jinja2-переменных шаблона (плейсхолдеров).

    Переменные циклов (``t`` в ``{% for t in tasks %}``) сюда не попадают —
    docxtpl считает их объявленными."""
    from docxtpl import DocxTemplate

    try:
        doc = DocxTemplate(docx_path)
        return sorted(doc.get_undeclared_template_variables())
    except Exception as exc:  # битый/не-docx файл
        raise ProtocolTemplateError(
            "Не удалось прочитать шаблон: файл повреждён или это не .docx."
        ) from exc


def auto_map(placeholders: list[str]) -> dict[str, str]:
    """Точное совпадение имени плейсхолдера с каноническим полем.

    Возвращает {каноническое_поле: плейсхолдер}. Несовпавшие канонические поля
    просто отсутствуют в словаре (остаются unmapped)."""
    return {name: name for name in placeholders if name in CANONICAL_FIELDS}


def build_context(protocol) -> dict:
    """Значения канонических полей протокола для рендеринга шаблона."""
    return {
        "title": protocol.title,
        "date": protocol.date,
        "number": protocol.number,
        "body": protocol.body,
        "tasks": [
            {
                "assignment": t.assignment,
                "responsible": t.responsible,
                "department": t.department,
                "deadline": t.deadline,
                "status": t.status,
            }
            for t in protocol.tasks
        ],
    }


def render(protocol, template) -> Path:
    """Отрендерить протокол по активному шаблону, вернуть путь к .docx.

    Значения канонических полей перекладываются в реальные имена плейсхолдеров
    файла через ``template.field_mapping_json`` ({каноническое_поле: плейсхолдер})."""
    from docxtpl import DocxTemplate

    context = build_context(protocol)
    mapping = json.loads(template.field_mapping_json or "{}")
    render_context = {
        placeholder: context[field]
        for field, placeholder in mapping.items()
        if field in context
    }
    try:
        doc = DocxTemplate(template.docx_path)
        doc.render(render_context)
        out = storage.exports_dir() / f"{storage.safe_name('protocol_' + protocol.id)}.docx"
        doc.save(str(out))
        return out
    except Exception as exc:
        raise ProtocolTemplateError(
            "Не удалось отрендерить протокол по шаблону: файл повреждён или несовместим."
        ) from exc
