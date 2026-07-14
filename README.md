# Цифровой Офис — транскрибация, протоколы, контроль исполнения

Веб-платформа для работы со встречами: загрузка аудио/видео → распознавание речи →
автоматический протокол и поручения → реестр поручений и контроль исполнения →
вопросы по записям и справки-обоснования назначений. Текстовая логика и базы знаний
вынесены в **Dify-workflow**, распознавание речи — в **OpenRouter**, оркестрация и UI —
в собственных backend/frontend. **Бот MAX** (подтверждение исполнения inline-кнопками,
напоминания) реализован в backend и включается опционально.

> Подробный гайд для разработчиков и AI-агентов — в [CLAUDE.md](CLAUDE.md).

## Возможности

- 🎙️ **Транскрибация** аудио и видео (OpenRouter, Gemini), тайм-коды и диаризация говорящих.
- 📄 **Протоколы и поручения** из транскрипта (Dify): ответственный, срок, статус,
  фрагмент-источник.
- 🧾 **Справка-обоснование** назначения: на основании какого фрагмента и какой
  должностной обязанности поручение отдано сотруднику.
- 💬 **Вопросы (Q&A)** по выбранным записям и протоколам — с цитатами и переходом к фрагменту.
- 🔎 **Семантический поиск** по всем встречам (историческая память).
- ✅ **Реестр поручений**: статусы, фильтры, поиск, правка сроков/ответственных,
  отправка в группу MAX, текст исполнения, подтверждение выполнения, справка о работе.
- 🗂️ **Экспорт** протоколов/транскриптов/чата/справок в DOCX, PDF, MD, TXT, JSON.
- 🌗 Светлая/тёмная темы, кликабельный транскрипт с аудиоплеером.

## Архитектура

```
            ┌────────────┐      /api      ┌──────────────┐   chat-messages   ┌─────────┐
   браузер →│  frontend  │ ─────────────→ │   backend    │ ────────────────→ │  Dify   │
            │ React/Vite │ ←───────────── │   FastAPI    │ ←──────────────── │workflow │
            └────────────┘                └──────┬───────┘                   └─────────┘
                                                 │ audio (base64)
                                                 ▼
                                          ┌──────────────┐        ┌──────────────────┐
                                          │  OpenRouter  │        │     Бот MAX      │ (опц.)
                                          │   (ASR)      │        │   (в backend)    │
                                          └──────────────┘        └──────────────────┘
```

- **frontend/** — React + Vite + TypeScript + Tailwind (UI).
- **backend/** — FastAPI: ASR (OpenRouter), оркестрация Dify, хранение (SQLite + файлы),
  экспорт, REST API, бот MAX (кнопки подтверждения, напоминания).
- **dify/** — workflow: протокол, Q&A, справка-обоснование, справка о работе, БЗ.
- **microservice/** — историческая референс-копия MAX-логики (перенесена в backend).

**Принцип разделения:** простая логика, LLM по тексту и базы знаний → **Dify**;
распознавание речи, медиа (ffmpeg), хранение, оркестрация, экспорт → **backend**.

## Структура репозитория

```
README.md                         этот файл
CLAUDE.md                         гайд для разработки
dify/
  Ассистент Цифровой Офис (1).yml  production-workflow (РЕФЕРЕНС, не трогать)
  digital-office-workflow.yml      новый workflow (импортируемый)
  WORKFLOW.md                      описание нод/маршрутов/датасетов
backend/                          FastAPI-сервис: API, ASR, Dify, экспорт, бот MAX
frontend/                         React-приложение (см. frontend/README.md)
microservice/                     историческая референс-копия MAX-логики
```

## Требования

- **Python 3.11+**
- **Node.js 18+** и npm
- **ffmpeg** в PATH (для видео и нарезки аудио)
- Ключ **OpenRouter** (распознавание речи)
- Ключи **Dify** — App API Key и (для исторической памяти) Dataset API Key

Без внешних ключей сервис не падает: ASR/Dify вернут пустой результат, а хранение,
экспорт и локальный поиск будут работать.

## Быстрый старт

### 1. Backend

```bash
cd backend
python -m venv .venv
# Windows:
.venv\Scripts\activate
# Linux/macOS:
# source .venv/bin/activate

pip install -r requirements.txt
cp config.example.yaml config.yaml      # заполнить ключи (openrouter, dify)
uvicorn app.main:app --reload --host 0.0.0.0 --port 8080
```

Проверка: Swagger — http://localhost:8080/docs, здоровье — http://localhost:8080/api/health.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev                              # http://localhost:5173
```

Vite проксирует `/api` на `http://localhost:8080`, поэтому backend должен быть запущен.

### Запуск за прокси на единственном порту 8080

Для окружения, где наружу открыт только порт 8080 и приложение доступно по
`https://custom-servers.t1v.scibox.tech/jnserver/1109/application/`, запускайте
единый backend+frontend:

```bash
# Windows PowerShell
.\scripts\start_8080.ps1

# Linux/macOS
bash scripts/start_8080.sh
```

Скрипт ставит frontend-зависимости, собирает `frontend/dist`, создаёт backend
`.venv`, ставит `backend/requirements.txt`, после чего FastAPI раздаёт UI и `/api`
из одного процесса на `0.0.0.0:8080`. Внешний путь задаётся в `backend/config.yaml`:

```yaml
port: 8080
public_base_path: /jnserver/1109/application/
```

### 3. Dify workflow

1. В Dify Studio → **Import DSL** загрузите [dify/digital-office-workflow.yml](dify/digital-office-workflow.yml).
2. Переподключите модели (`qwen3-32b-fp8-v2`, `bge-m3-v2`) и плагин document-generator.
3. Подставьте свои `dataset_ids` в ноду «Поиск должностных обязанностей».
4. Опубликуйте, скопируйте **App API Key** → `backend/config.yaml → dify.app_api_key`.

Детали — в [dify/WORKFLOW.md](dify/WORKFLOW.md).

### 4. Бот MAX (опционально)

Включается в `backend/config.yaml`:

```yaml
max:
  enabled: true
  bot_token: "<токен бота MAX>"
  chat_id: "-100..."                # ID группы (для групп — отрицательный)
  webhook_secret: "<секрет>"
  webhook_public_url: "https://host/jnserver/1109/application/api/max/webhook?secret=<секрет>"
```

Что делает бот: отправляет в группу карточку поручения с кнопкой «Подтвердить
исполнение», ведёт цепочку подтверждения (сотрудник пишет, что сделано → статус
«Требует проверки» → руководитель жмёт «Подтвердить выполнение» → справка DOCX в
чат), напоминает о приближении срока.

**Важно:** чтобы нажатия inline-кнопок доходили до backend, MAX должен знать URL
вебхука. Если задан `webhook_public_url`, backend сам регистрирует подписку при
старте. Проверить — `GET /api/max/status`; переустановить вручную —
`POST /api/max/subscribe`. Логика — в `backend/app/services/max_*.py`
(в [microservice/](microservice/) лежит её историческая референс-копия).

## Конфигурация

**Только YAML, без `.env`.** Backend читает `backend/config.yaml`
(поиск: `CONFIG_PATH` → `./config.yaml` → `backend/config.yaml`). Шаблон со всеми
полями и комментариями — [backend/config.example.yaml](backend/config.example.yaml).
Секреты в репозиторий не коммитятся (`backend/.gitignore`).

Ключевые секции: `openrouter` (ASR-модель), `dify` (app + dataset + имена команд),
`media` (ffmpeg), `security` (X-Api-Key), `upload`, `export`, `execution_control`, `max`.

## Сценарий использования

1. **Загрузка** → перетащите файл встречи → идёт распознавание (статус обновляется сам).
2. **Транскрипт** → плеер + кликабельные сегменты со спикерами → «Сформировать протокол».
3. **Протокол** → текст + поручения → «Обоснование» по каждому поручению.
4. **Библиотека** → отметьте записи/протоколы → «Вопросы по выбранному» или семантический поиск.
5. **Вопросы** → чат по выбранному контексту с цитатами.
6. **Реестр поручений** → поиск, правка поручений, статусы, текст исполнения, подтверждение выполнения.
7. **Экспорт** → DOCX/PDF/MD/TXT/JSON на нужной странице.

## Основные эндпоинты API

| Метод | Путь | Назначение |
|---|---|---|
| POST | `/api/transcriptions` | загрузка медиа + запуск ASR |
| GET | `/api/transcriptions/{id}` | статус + сегменты |
| POST | `/api/protocols` | протокол + поручения из транскрипта |
| POST | `/api/tasks/{id}/justification` | справка-обоснование |
| POST | `/api/tasks/{id}/execution` · `/confirm` · `/send-max` | контроль исполнения и MAX |
| POST | `/api/qa` · `/api/search` | вопросы · семантический поиск |
| POST | `/api/export` | экспорт в выбранном формате |
| POST/GET | `/api/max/webhook` · `/api/max/status` · `/api/max/subscribe` | вебхук, статус и подписка бота MAX |

Полный список — в Swagger (`/docs`).

## Тесты и проверки

```bash
# backend
cd backend && python -m pytest -q

# frontend
cd frontend && npm run build       # tsc + vite
```

## Траблшутинг

- **`/api/health` → `ffmpeg: false`** — установите ffmpeg или укажите путь в `media.ffmpeg_path`.
- **Транскрипция в статусе `error`** — проверьте `openrouter.api_key` и формат
  аудио-части модели (`openrouter.audio_part_type`); смотрите логи backend.
- **Пустые ответы Q&A/протокола** — не задан `dify.app_api_key` или workflow не опубликован.
- **Кириллица квадратами в PDF** — укажите TTF в `export.pdf_font_path`.
- **Кнопки в MAX не реагируют** — не зарегистрирован вебхук. Задайте
  `max.webhook_public_url` (с `?secret=…`) и проверьте `GET /api/max/status`;
  переустановить — `POST /api/max/subscribe`. URL должен быть доступен извне.
- **CORS/`/api` не отвечает** — backend не запущен на `:8080` или изменён `cors_origins`.
