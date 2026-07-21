"""Авторизация и управление пользователями (ТЗ 3).

* ``POST /api/auth/login``  — вход по логину/паролю, выдаёт сессионный токен.
* ``POST /api/auth/logout`` — завершение сессии.
* ``GET  /api/auth/me``     — текущий пользователь и его права (+ флаг auth_enabled).
* CRUD ``/api/auth/users``  — управление пользователями (только администратор).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.logging_config import get_logger
from app.models import User
from app.schemas import (
    DemoAccountDTO,
    DemoAccountsResponse,
    LoginRequest,
    LoginResponse,
    MeResponse,
    UserCreate,
    UserDTO,
    UserUpdate,
)
from app.security import current_principal, require_permission
from app.services import auth

router = APIRouter(prefix="/api/auth", tags=["auth"])
log = get_logger("auth")


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    if not settings.auth.enabled:
        raise HTTPException(400, "Авторизация отключена (auth.enabled=false)")
    user = db.query(User).filter(User.username == body.username).first()
    if not user or not user.is_active or not auth.verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Неверный логин или пароль")
    session = auth.create_session(db, user)
    return LoginResponse(
        token=session.token,
        user=UserDTO.model_validate(user),
        permissions=auth.role_permissions(user.role),
    )


@router.get("/demo", response_model=DemoAccountsResponse)
def demo_login_accounts():
    """Демо-учётки для страницы входа (пусто, если auth.seed_demo выключен)."""
    return DemoAccountsResponse(accounts=[DemoAccountDTO(**a) for a in auth.demo_accounts()])


@router.post("/logout")
def logout(request: Request, db: Session = Depends(get_db)):
    header = request.headers.get("Authorization", "")
    token = header[7:].strip() if header.lower().startswith("bearer ") else request.headers.get("X-Auth-Token", "")
    if token:
        auth.revoke_token(db, token)
    return {"ok": True}


@router.get("/me", response_model=MeResponse)
def me(request: Request, db: Session = Depends(get_db)):
    if not settings.auth.enabled:
        # Режим без авторизации: клиент работает как полноправный пользователь.
        return MeResponse(auth_enabled=False, authenticated=True, user=None, permissions=["*"])
    principal = getattr(request.state, "principal", None)
    if principal is None:
        return MeResponse(auth_enabled=True, authenticated=False)
    user = db.get(User, principal.id)
    if not user:
        return MeResponse(auth_enabled=True, authenticated=False)
    return MeResponse(
        auth_enabled=True,
        authenticated=True,
        user=UserDTO.model_validate(user),
        permissions=auth.role_permissions(user.role),
    )


# --- Управление пользователями (только администратор) ---

@router.get("/users", response_model=list[UserDTO], dependencies=[Depends(require_permission("users.manage"))])
def list_users(db: Session = Depends(get_db)):
    return db.query(User).order_by(User.created_at.asc()).all()


@router.post("/users", response_model=UserDTO, dependencies=[Depends(require_permission("users.manage"))])
def create_user(body: UserCreate, db: Session = Depends(get_db)):
    if body.role not in auth.ROLES:
        raise HTTPException(422, f"Неизвестная роль: {body.role}")
    if not body.username.strip() or not body.password:
        raise HTTPException(422, "Логин и пароль обязательны")
    if db.query(User).filter(User.username == body.username).first():
        raise HTTPException(409, "Пользователь с таким логином уже существует")
    user = User(
        username=body.username.strip(),
        full_name=body.full_name.strip(),
        password_hash=auth.hash_password(body.password),
        role=body.role,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _is_last_active_admin(db: Session, user: User) -> bool:
    """True, если ``user`` — единственный активный администратор в системе."""
    if user.role != auth.ROLE_ADMIN or not user.is_active:
        return False
    active_admins = (
        db.query(User)
        .filter(User.role == auth.ROLE_ADMIN, User.is_active.is_(True))
        .count()
    )
    return active_admins <= 1


@router.patch("/users/{user_id}", response_model=UserDTO, dependencies=[Depends(require_permission("users.manage"))])
def update_user(user_id: str, body: UserUpdate, db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "Пользователь не найден")
    # Нельзя оставить систему без администратора: запрещаем понижение роли или
    # деактивацию последнего активного admin (защита симметрична delete_user).
    removing_admin = body.role is not None and body.role != auth.ROLE_ADMIN
    deactivating = body.is_active is False
    if (removing_admin or deactivating) and _is_last_active_admin(db, user):
        raise HTTPException(400, "Нельзя снять роль или деактивировать последнего администратора")
    if body.role is not None:
        if body.role not in auth.ROLES:
            raise HTTPException(422, f"Неизвестная роль: {body.role}")
        user.role = body.role
    if body.full_name is not None:
        user.full_name = body.full_name.strip()
    if body.password:
        user.password_hash = auth.hash_password(body.password)
    if body.is_active is not None:
        user.is_active = body.is_active
    db.commit()
    db.refresh(user)
    return user


@router.delete("/users/{user_id}")
def delete_user(user_id: str, request: Request, db: Session = Depends(get_db)):
    principal = current_principal(request)
    if not principal.has("users.manage"):
        raise HTTPException(403, "Недостаточно прав")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "Пользователь не найден")
    if user.id == principal.id:
        raise HTTPException(400, "Нельзя удалить собственную учётную запись")
    if user.role == auth.ROLE_ADMIN and db.query(User).filter(User.role == auth.ROLE_ADMIN).count() <= 1:
        raise HTTPException(400, "Нельзя удалить последнего администратора")
    db.delete(user)
    db.commit()
    return {"deleted": user_id}
