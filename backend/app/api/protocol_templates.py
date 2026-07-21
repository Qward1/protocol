"""Управление редактируемыми DOCX-шаблонами протокола (часть 2).

Доступ — только роль admin (право ``templates.manage``). ROLE_ADMIN уже имеет
``{"*"}``, поэтому отдельная запись в ROLE_PERMISSIONS не нужна; другим ролям это
право не выдаём."""

from __future__ import annotations

import json
from pathlib import Path
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import ProtocolTemplate
from app.schemas import ProtocolTemplateDTO, ProtocolTemplateMappingUpdate
from app.security import require_permission
from app.services import protocol_template, storage

router = APIRouter(
    prefix="/api/protocol-templates",
    tags=["protocol-templates"],
    dependencies=[Depends(require_permission("templates.manage"))],
)

_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def _to_dto(tpl: ProtocolTemplate) -> ProtocolTemplateDTO:
    return ProtocolTemplateDTO(
        id=tpl.id,
        name=tpl.name,
        is_active=tpl.is_active,
        detected_placeholders=json.loads(tpl.detected_placeholders_json or "[]"),
        field_mapping=json.loads(tpl.field_mapping_json or "{}"),
        created_at=tpl.created_at,
    )


def _deactivate_all(db: Session) -> None:
    db.query(ProtocolTemplate).filter(ProtocolTemplate.is_active.is_(True)).update(
        {ProtocolTemplate.is_active: False}
    )


@router.post("", response_model=ProtocolTemplateDTO)
async def upload_template(file: UploadFile = File(...), db: Session = Depends(get_db)):
    filename = file.filename or "template.docx"
    if not filename.lower().endswith(".docx"):
        raise HTTPException(415, "Ожидается файл .docx")

    tid = str(uuid.uuid4())
    dest = storage.templates_dir() / f"{tid}_{storage.safe_name(filename)}"
    dest.write_bytes(await file.read())

    # Мягкая деградация: битый .docx -> понятная 400, а не 500.
    try:
        placeholders = protocol_template.extract_placeholders(str(dest))
    except protocol_template.ProtocolTemplateError as exc:
        dest.unlink(missing_ok=True)
        raise HTTPException(400, str(exc))

    mapping = protocol_template.auto_map(placeholders)
    _deactivate_all(db)  # одновременно активен ровно один шаблон
    tpl = ProtocolTemplate(
        id=tid,
        name=filename,
        docx_path=str(dest),
        is_active=True,
        detected_placeholders_json=json.dumps(placeholders, ensure_ascii=False),
        field_mapping_json=json.dumps(mapping, ensure_ascii=False),
    )
    db.add(tpl)
    db.commit()
    db.refresh(tpl)
    return _to_dto(tpl)


@router.get("", response_model=list[ProtocolTemplateDTO])
def list_templates(db: Session = Depends(get_db)):
    templates = db.query(ProtocolTemplate).order_by(ProtocolTemplate.created_at.desc()).all()
    return [_to_dto(t) for t in templates]


@router.get("/active", response_model=ProtocolTemplateDTO)
def get_active_template(db: Session = Depends(get_db)):
    tpl = (
        db.query(ProtocolTemplate)
        .filter(ProtocolTemplate.is_active.is_(True))
        .order_by(ProtocolTemplate.created_at.desc())
        .first()
    )
    if not tpl:
        raise HTTPException(404, "Активный шаблон не найден")
    return _to_dto(tpl)


@router.put("/{template_id}/mapping", response_model=ProtocolTemplateDTO)
def update_mapping(
    template_id: str, body: ProtocolTemplateMappingUpdate, db: Session = Depends(get_db)
):
    tpl = db.get(ProtocolTemplate, template_id)
    if not tpl:
        raise HTTPException(404, "Шаблон не найден")
    tpl.field_mapping_json = json.dumps(body.field_mapping, ensure_ascii=False)
    db.commit()
    db.refresh(tpl)
    return _to_dto(tpl)


@router.post("/{template_id}/activate", response_model=ProtocolTemplateDTO)
def activate_template(template_id: str, db: Session = Depends(get_db)):
    tpl = db.get(ProtocolTemplate, template_id)
    if not tpl:
        raise HTTPException(404, "Шаблон не найден")
    _deactivate_all(db)
    tpl.is_active = True
    db.commit()
    db.refresh(tpl)
    return _to_dto(tpl)


@router.get("/{template_id}/file")
def get_template_file(template_id: str, db: Session = Depends(get_db)):
    tpl = db.get(ProtocolTemplate, template_id)
    if not tpl:
        raise HTTPException(404, "Шаблон не найден")
    path = Path(tpl.docx_path)
    if not path.is_file():
        raise HTTPException(404, "Файл шаблона не найден")
    return FileResponse(str(path), filename=path.name, media_type=_DOCX_MIME)
