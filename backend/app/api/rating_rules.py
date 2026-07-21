"""CRUD правил начисления баллов рейтинга (п. 4.5.3).

Доступ — только роль admin (право ``rating_rules.manage``). ROLE_ADMIN имеет
``{"*"}``, поэтому отдельная запись в ROLE_PERMISSIONS не нужна; другим ролям это
право не выдаём (head/staff/executor рейтинг только просматривают на дашборде).

Правила редактируются здесь через API/UI — под новое правило код менять не нужно
(набор условий фиксирован, меняются только баллы/включённость)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import RatingRule
from app.schemas import (
    RatingConditionDTO,
    RatingRuleCreate,
    RatingRuleDTO,
    RatingRulesResponse,
    RatingRuleUpdate,
)
from app.security import require_permission
from app.services import analytics

router = APIRouter(
    prefix="/api/rating-rules",
    tags=["rating-rules"],
    dependencies=[Depends(require_permission("rating_rules.manage"))],
)


def _to_dto(rule: RatingRule) -> RatingRuleDTO:
    return RatingRuleDTO(
        id=rule.id,
        condition=rule.condition,
        label=analytics.RATING_CONDITIONS.get(rule.condition, rule.condition),
        points=rule.points,
        enabled=rule.enabled,
        created_at=rule.created_at,
    )


@router.get("", response_model=RatingRulesResponse)
def list_rules(db: Session = Depends(get_db)):
    """Текущие правила + фиксированный каталог доступных условий."""
    rules = db.query(RatingRule).order_by(RatingRule.created_at.asc()).all()
    conditions = [
        RatingConditionDTO(key=key, label=label)
        for key, label in analytics.RATING_CONDITIONS.items()
    ]
    return RatingRulesResponse(rules=[_to_dto(r) for r in rules], conditions=conditions)


@router.post("", response_model=RatingRuleDTO)
def create_rule(body: RatingRuleCreate, db: Session = Depends(get_db)):
    if body.condition not in analytics.RATING_CONDITIONS:
        raise HTTPException(422, f"Неизвестное условие рейтинга: {body.condition}")
    if db.query(RatingRule).filter(RatingRule.condition == body.condition).first():
        raise HTTPException(409, "Правило для этого условия уже существует")
    rule = RatingRule(condition=body.condition, points=body.points, enabled=body.enabled)
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return _to_dto(rule)


@router.patch("/{rule_id}", response_model=RatingRuleDTO)
def update_rule(rule_id: str, body: RatingRuleUpdate, db: Session = Depends(get_db)):
    rule = db.get(RatingRule, rule_id)
    if not rule:
        raise HTTPException(404, "Правило не найдено")
    if body.points is not None:
        rule.points = body.points
    if body.enabled is not None:
        rule.enabled = body.enabled
    db.commit()
    db.refresh(rule)
    return _to_dto(rule)


@router.delete("/{rule_id}")
def delete_rule(rule_id: str, db: Session = Depends(get_db)):
    rule = db.get(RatingRule, rule_id)
    if not rule:
        raise HTTPException(404, "Правило не найдено")
    db.delete(rule)
    db.commit()
    return {"deleted": rule_id}
