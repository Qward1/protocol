"""Экспорт протокола / транскрипта / чата / справки в DOCX, PDF, MD, TXT, JSON."""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import ChatSession, Justification, Protocol, Task, Transcription
from app.schemas import ExportRequest
from app.services import exporter

router = APIRouter(prefix="/api/export", tags=["export"])


@router.post("")
def export_object(req: ExportRequest, db: Session = Depends(get_db)):
    if req.fmt not in exporter.SUPPORTED:
        raise HTTPException(400, f"Unsupported format: {req.fmt}")

    if req.object_type == "transcription":
        t = db.get(Transcription, req.object_id)
        if not t:
            raise HTTPException(404, "Not found")
        md = exporter.transcription_to_md(t)
        raw = {
            "id": t.id, "filename": t.filename,
            "segments": [{"start": s.start, "end": s.end, "speaker": s.speaker, "text": s.text} for s in t.segments],
        }
        name = f"transcript_{t.id}"

    elif req.object_type == "protocol":
        p = db.get(Protocol, req.object_id)
        if not p:
            raise HTTPException(404, "Not found")
        md = exporter.protocol_to_md(p)
        raw = json.loads(p.raw_json or "{}")
        name = f"protocol_{p.id}"

    elif req.object_type == "chat":
        s = db.get(ChatSession, req.object_id)
        if not s:
            raise HTTPException(404, "Not found")
        md = exporter.chat_to_md(s)
        raw = {"title": s.title, "messages": [{"role": m.role, "content": m.content} for m in s.messages]}
        name = f"chat_{s.id}"

    elif req.object_type == "justification":
        j = db.get(Justification, req.object_id)
        if not j:
            raise HTTPException(404, "Not found")
        task = db.get(Task, j.task_id)
        md = exporter.justification_to_md(j, task)
        raw = {"fragment": j.fragment, "duty": j.duty, "text": j.text}
        name = f"justification_{j.id}"

    else:
        raise HTTPException(400, f"Unknown object_type: {req.object_type}")

    path = exporter.render(md, raw, req.fmt, name)
    return FileResponse(str(path), filename=path.name)
