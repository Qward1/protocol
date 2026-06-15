# Цифровой Офис — транскрибация, протоколы, контроль исполнения

Веб-платформа для работы со встречами: загрузка аудио/видео → распознавание речи →
автоматический протокол и поручения → контроль исполнения → вопросы по записям и
справки-обоснования назначений. Текстовая логика и базы знаний вынесены в
**Dify-workflow**, распознавание речи — в **OpenRouter**, оркестрация и UI — в
собственных backend/frontend. Интеграция с мессенджером **MAX** подключается опционально.

> Подробный гайд для разработчиков и AI-агентов — в [CLAUDE.md](CLAUDE.md).

## Возможности

- 🎙️ **Транскрибация** аудио и видео (OpenRouter, Gemini), тайм-коды и диаризация говорящих.
- 📄 **Протоколы и поручения** из транскрипта (Dify): ответственный, срок, статус,
  фрагмент-источник.
- 🧾 **Справка-обоснование** назначения: на основании какого фрагмента и какой
  должностной обязанности поручение отдано сотруднику.
- 💬 **Вопросы (Q&A)** по выбранным записям и протоколам — с цитатами и переходом к фрагменту.
- 🔎 **Семантический поиск** по всем встречам (историческая память).
- ✅ **Контроль исполнения**: дашборд статусов, подтверждение выполнения, справка о работе.
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
                                          │  OpenRouter  │        │  MAX microservice │ (опц.)
                                          │   (ASR)      │        └──────────────────┘
                                          └──────────────┘
```

- **frontend/** — React + Vite + TypeScript + Tailwind (UI).
- **backend/** — FastAPI: ASR (OpenRouter), оркестрация Dify, хранение (SQLite + файлы),
  экспорт, REST API, мост к MAX.
- **dify/** — workflow: протокол, Q&A, справка-обоснование, справка о работе, БЗ.
- **microservice/** — референс интеграции с MAX (inline-кнопки, цепочка подтверждения).

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
backend/                          FastAPI-сервис (см. backend/README.md)
frontend/                         React-приложение (см. frontend/README.md)
microservice/                     референс интеграции с MAX
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
uvicorn app.main:app --reload --port 8000
```

Проверка: Swagger — http://localhost:8000/docs, здоровье — http://localhost:8000/api/health.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev                              # http://localhost:5173
```

Vite проксирует `/api` на `http://localhost:8000`, поэтому backend должен быть запущен.

### 3. Dify workflow

1. В Dify Studio → **Import DSL** загрузите [dify/digital-office-workflow.yml](dify/digital-office-workflow.yml).
2. Переподключите модели (`qwen3-32b-fp8-v2`, `bge-m3-v2`) и плагин document-generator.
3. Подставьте свои `dataset_ids` в ноду «Поиск должностных обязанностей».
4. Опубликуйте, скопируйте **App API Key** → `backend/config.yaml → dify.app_api_key`.

Детали — в [dify/WORKFLOW.md](dify/WORKFLOW.md).

### 4. MAX (опционально)

Включается `backend/config.yaml → max.enabled: true` + `max.base_url`. Логика
цепочки подтверждения — в [microservice/](microservice/) (референс).

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
3. **Протокол** → текст + таблица поручений → «Обоснование» по каждому поручению.
4. **Библиотека** → отметьте записи/протоколы → «Вопросы по выбранному» или семантический поиск.
5. **Вопросы** → чат по выбранному контексту с цитатами.
6. **Дашборд** → статусы поручений, подтверждение выполнения.
7. **Экспорт** → DOCX/PDF/MD/TXT/JSON на нужной странице.

## Основные эндпоинты API

| Метод | Путь | Назначение |
|---|---|---|
| POST | `/api/transcriptions` | загрузка медиа + запуск ASR |
| GET | `/api/transcriptions/{id}` | статус + сегменты |
| POST | `/api/protocols` | протокол + поручения из транскрипта |
| POST | `/api/tasks/{id}/justification` | справка-обоснование |
| POST | `/api/tasks/{id}/execution` · `/confirm` | контроль исполнения |
| POST | `/api/qa` · `/api/search` | вопросы · семантический поиск |
| POST | `/api/export` | экспорт в выбранном формате |

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
- **CORS/`/api` не отвечает** — backend не запущен на `:8000` или изменён `cors_origins`.
