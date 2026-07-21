"""Авторизация и ролевая модель (RBAC, ТЗ 3).

Здесь — «чистая» логика без FastAPI: хэширование паролей (stdlib pbkdf2, без
внешних зависимостей), выпуск/проверка сессионных токенов и таблица прав по
ролям. FastAPI-зависимости, которые защищают маршруты, живут в ``app/security.py``.
"""

from __future__ import annotations

from datetime import timedelta
import hashlib
import hmac
import secrets

from sqlalchemy.orm import Session

from app.config import settings
from app.models import AuthSession, User, _now

# --- Роли ---

ROLE_ADMIN = "admin"        # Администратор — полный доступ
ROLE_HEAD = "head"          # Глава — просмотр дашборда/рейтингов/протоколов/поручений
ROLE_STAFF = "staff"        # Сотрудник аппарата / секретарь — ведение встреч и поручений
ROLE_EXECUTOR = "executor"  # Исполнитель — только свои поручения

ROLES = [ROLE_ADMIN, ROLE_HEAD, ROLE_STAFF, ROLE_EXECUTOR]

ROLE_LABELS: dict[str, str] = {
    ROLE_ADMIN: "Администратор",
    ROLE_HEAD: "Глава",
    ROLE_STAFF: "Сотрудник аппарата",
    ROLE_EXECUTOR: "Исполнитель",
}

# --- Права (permissions) ---
# Строковые ключи, которые маршруты требуют через require_permission(...).

ROLE_PERMISSIONS: dict[str, set[str]] = {
    ROLE_ADMIN: {"*"},  # всё
    ROLE_HEAD: {
        "dashboard.view", "ratings.view",
        "tasks.view_all", "protocols.view", "transcripts.view",
        "library.view", "qa.use", "export",
    },
    ROLE_STAFF: {
        "dashboard.view", "ratings.view",
        "tasks.view_all", "tasks.manage", "tasks.execute",
        "protocols.view", "protocols.manage",
        "transcripts.view", "transcripts.manage", "speakers.manage", "upload",
        "library.view", "qa.use", "export",
    },
    ROLE_EXECUTOR: {
        "tasks.view_own", "tasks.execute",
    },
}


def has_permission(role: str, permission: str) -> bool:
    perms = ROLE_PERMISSIONS.get(role, set())
    return "*" in perms or permission in perms


def role_permissions(role: str) -> list[str]:
    """Плоский список прав роли (для отдачи на фронтенд)."""
    perms = ROLE_PERMISSIONS.get(role, set())
    return ["*"] if "*" in perms else sorted(perms)


# --- Пароли (pbkdf2-sha256, только stdlib) ---

_PBKDF2_ITERATIONS = 120_000


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${_PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, iterations, salt_hex, hash_hex = stored.split("$")
        if algorithm != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(iterations)
        )
    except (ValueError, AttributeError):
        return False
    return hmac.compare_digest(digest.hex(), hash_hex)


# --- Сессионные токены ---

def create_session(db: Session, user: User) -> AuthSession:
    session = AuthSession(
        token=secrets.token_urlsafe(32),
        user_id=user.id,
        expires_at=_now() + timedelta(hours=settings.auth.session_ttl_hours),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def resolve_session(db: Session, token: str) -> User | None:
    """Вернуть активного пользователя по токену (или None, если токен невалиден/истёк)."""
    if not token:
        return None
    session = db.get(AuthSession, token)
    if not session:
        return None
    if session.expires_at and session.expires_at < _now():
        db.delete(session)
        db.commit()
        return None
    user = db.get(User, session.user_id)
    if not user or not user.is_active:
        return None
    return user


def revoke_token(db: Session, token: str) -> None:
    session = db.get(AuthSession, token)
    if session:
        db.delete(session)
        db.commit()


def seed_admin(db: Session) -> None:
    """Создать начального администратора, если в системе ещё нет пользователей."""
    if not settings.auth.seed_admin:
        return
    if db.query(User).count() > 0:
        return
    admin = User(
        username=settings.auth.admin_username,
        full_name=settings.auth.admin_full_name,
        password_hash=hash_password(settings.auth.admin_password),
        role=ROLE_ADMIN,
        is_active=True,
    )
    db.add(admin)
    db.commit()


# --- Демо-пользователи (opt-in auth.seed_demo) -----------------------------
# Логины/пароли намеренно известны и показываются на странице входа, чтобы
# продемонстрировать вход разными ролями. Не использовать в проде.
DEMO_USERS: list[dict[str, str]] = [
    {"username": "admin", "password": "demoadmin", "full_name": "Администратор (демо)", "role": ROLE_ADMIN},
    {"username": "head", "password": "demohead", "full_name": "Глава (демо)", "role": ROLE_HEAD},
    {"username": "staff", "password": "demostaff", "full_name": "Секретарь аппарата (демо)", "role": ROLE_STAFF},
    {"username": "executor", "password": "demoexec", "full_name": "Исполнитель (демо)", "role": ROLE_EXECUTOR},
]


def seed_demo_users(db: Session) -> None:
    """Идемпотентно посеять демо-пользователей всех ролей.

    Создаёт отсутствующих и приводит пароль/роль/активность к известным
    демо-значениям при каждом старте, чтобы GET /api/auth/demo мог честно
    показывать актуальные логины и пароли.
    """
    if not settings.auth.seed_demo:
        return
    for spec in DEMO_USERS:
        user = db.query(User).filter(User.username == spec["username"]).first()
        if user is None:
            db.add(
                User(
                    username=spec["username"],
                    full_name=spec["full_name"],
                    password_hash=hash_password(spec["password"]),
                    role=spec["role"],
                    is_active=True,
                )
            )
        else:
            user.password_hash = hash_password(spec["password"])
            user.role = spec["role"]
            user.is_active = True
            if not user.full_name:
                user.full_name = spec["full_name"]
    db.commit()


def demo_accounts() -> list[dict[str, str]]:
    """Список демо-учёток для страницы входа (пусто, если seed_demo выключен)."""
    if not settings.auth.seed_demo:
        return []
    return [
        {
            "username": s["username"],
            "password": s["password"],
            "role": s["role"],
            "role_label": ROLE_LABELS[s["role"]],
            "full_name": s["full_name"],
        }
        for s in DEMO_USERS
    ]


def task_belongs_to(task, principal) -> bool:
    """Считается ли поручение «своим» для исполнителя.

    Связь пользователь ↔ поручение — по ФИО (task.responsible ≈ full_name) либо
    по логину, продублированному в max_username. Сопоставление нестрогое: имена
    приходят из распознавания/Dify свободным текстом.
    """
    responsible = (task.responsible or "").strip().lower()
    full_name = (principal.full_name or "").strip().lower()
    username = (principal.username or "").strip().lower()
    if responsible and full_name and (
        responsible == full_name or full_name in responsible or responsible in full_name
    ):
        return True
    if username and (task.max_username or "").strip().lower() == username:
        return True
    return False
