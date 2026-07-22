# Цифровой Офис — транскрибация, протоколы, контроль исполнения

Веб-платформа для работы со встречами: загрузка аудио/видео → распознавание речи →
автоматический протокол и поручения → реестр поручений и контроль исполнения →
вопросы по записям и семантический поиск по прошлым встречам.

Разделение ответственности:

- **backend** (FastAPI) — распознавание речи (OpenRouter), оркестрация, хранение
  (SQLite + файлы), экспорт, REST API, бот MAX.
- **frontend** (React + Vite + TypeScript + Tailwind) — веб-интерфейс.
- **Dify workflow** — текстовая LLM-логика и базы знаний (протокол, Q&A,
  справка-обоснование, справка о работе), вызывается по HTTP.
- **OpenRouter** — распознавание речи (ASR).
- **Бот MAX** — опционально: подтверждение исполнения inline-кнопками и напоминания.

Без внешних ключей сервис не падает: вызовы ASR/Dify возвращают пустой результат, а
локальное хранение, экспорт и полнотекстовый поиск продолжают работать.

## Возможности

- Транскрибация аудио/видео с тайм-кодами и диаризацией говорящих.
- Автоматические протоколы и поручения (ответственный, срок, статус, фрагмент-источник).
- Справка-обоснование назначения поручения по должностной обязанности.
- Вопросы (Q&A) по выбранным записям с цитатами и переходом к фрагменту.
- Семантический поиск по всем встречам.
- Реестр поручений: статусы, фильтры, правка сроков/ответственных, контроль исполнения.
- Экспорт протоколов/транскриптов/чата/справок в DOCX, PDF, MD, TXT, JSON.
- Светлая/тёмная темы, кликабельный транскрипт с аудиоплеером, RBAC-авторизация.

## Требования

- Python 3.11+
- Node.js 18+ и npm
- ffmpeg в PATH (для видео и нарезки аудио); при отсутствии используется bundled
  `imageio-ffmpeg`
- Ключ OpenRouter (распознавание речи)
- Ключи Dify: App API Key и Dataset API Key (для семантического поиска)

## Быстрый старт

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp config.example.yaml config.yaml # заполнить ключи openrouter/dify
uvicorn app.main:app --reload --host 0.0.0.0 --port 8080
```

Swagger — http://localhost:8080/docs, состояние сервисов — http://localhost:8080/api/health.

### Frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173, проксирует /api → :8080
npm run build      # production-сборка: tsc -b && vite build
```

### Dify workflow

Текстовая логика вынесена в Dify-workflow. Импортируйте его в Dify Studio, подключите
модели (`qwen3-32b-fp8-v2`, `bge-m3-v2`) и плагин document-generator, подставьте свои
`dataset_ids`, опубликуйте и скопируйте App API Key в
`backend/config.yaml → dify.app_api_key`.

### Бот MAX (опционально)

Включается в `backend/config.yaml` (`max.enabled: true`, `bot_token`, `chat_id`,
`webhook_secret`, `webhook_public_url`). Бот отправляет в группу карточку поручения с
кнопкой подтверждения, ведёт цепочку подтверждения (статус «Требует проверки» →
«Выполнено» + справка DOCX в чат) и напоминает о приближении срока. Чтобы нажатия
inline-кнопок доходили до backend, MAX должен знать URL вебхука: при заданном
`webhook_public_url` backend регистрирует подписку при старте (проверка —
`GET /api/max/status`, переустановка — `POST /api/max/subscribe`).

## Развёртывание за одним портом

Для окружения, где наружу открыт только порт 8080 и backend раздаёт и UI, и API из
одного процесса:

```bash
bash scripts/start_8080.sh      # Linux/macOS
scripts/start_8080.ps1          # Windows PowerShell
```

Скрипт ставит frontend-зависимости, собирает `frontend/dist`, создаёт backend `.venv`,
ставит `requirements.txt` и запускает uvicorn. Внешний путь за reverse-proxy задаётся в
`backend/config.yaml`:

```yaml
port: 8080
public_base_path: /jnserver/1109/application/
```

## Конфигурация

Конфигурация — только YAML, без `.env`. Backend читает `backend/config.yaml`
(порядок поиска: `CONFIG_PATH` → `./config.yaml` → `backend/config.yaml`). Полный
шаблон со всеми полями и комментариями — `backend/config.example.yaml`; скопируйте его
в `backend/config.yaml` и заполните ключи. Секреты в репозиторий не коммитятся.

Ключевые секции: `openrouter` (ASR-модель), `dify` (app/dataset ключи, имена команд),
`media` (ffmpeg), `security`, `upload`, `export`, `execution_control`, `max`, `auth`.

При `auth.enabled: true` включается RBAC (`admin`, `head` — только чтение, `staff` —
секретарь, `executor` — свои поручения); вход — `POST /api/auth/login`, токен сессии
передаётся как `Authorization: Bearer`. Начальный администратор создаётся при первом
старте из `auth.admin_*`. По умолчанию (`auth.enabled: false`) вход не требуется.

## Структура репозитория

```
backend/       FastAPI-сервис
  app/api/         роутеры /api/*
  app/services/    ASR, Dify-клиент, экспорт, хранение, auth, бот MAX
  app/models.py    ORM-модели (SQLite)
  tests/           pytest
frontend/      React + Vite + TypeScript + Tailwind
  src/pages/       страницы-маршруты
  src/components/   переиспользуемые компоненты
  src/lib/         API-клиент, авторизация, темы, утилиты
microservice/  историческая референс-копия логики бота MAX (не развивается)
scripts/       запуск backend+frontend за одним портом
```

## Тесты и проверки

```bash
cd backend && python -m pytest -q     # backend
cd frontend && npm run build          # frontend: проверка типов (tsc) + сборка
```
