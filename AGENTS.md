# AGENTS.md

Гайд для работы с этим репозиторием (Codex и разработчики).

## Что это

Веб-платформа **«Цифровой Офис»**: транскрибация записей встреч, генерация
протоколов и поручений, контроль исполнения, Q&A по записям, справки-обоснования
назначений и историческая память. Состоит из фронтенда, backend-оркестратора,
Dify-workflow (вся текстовая LLM-логика и базы знаний) и референсного
MAX-микросервиса.

## Карта репозитория

```
dify/
  Ассистент Цифровой Офис (1).yml   production-workflow — РЕФЕРЕНС логики (не редактировать)
  digital-office-workflow.yml       НОВЫЙ workflow для backend (импортируемый)
  WORKFLOW.md                       описание нод, маршрутов, датасетов
backend/                            FastAPI: ASR, оркестрация Dify, хранение, экспорт, REST API
frontend/                           React + Vite + TS + Tailwind (UI)
microservice/                       РЕФЕРЕНС интеграции с мессенджером MAX (не идеал)
```

## Архитектурный принцип (важно)

- **Dify-workflow** = простые логические операции, вызовы LLM по тексту и работа с
  базами знаний: генерация протокола, извлечение/назначение поручений, Q&A,
  справка-обоснование, справка о выполненной работе, занесение транскриптов в БЗ.
- **backend** = всё остальное: распознавание речи (**OpenRouter**, не Dify), работа
  с медиа (ffmpeg), хранение (БД/файлы), оркестрация вызовов Dify, экспорт, REST API,
  мост к MAX.

При добавлении функции сначала решите, к какому слою она относится по этому правилу.

## Конфигурация

**Только YAML, без `.env`.** Backend читает `backend/config.yaml`
(поиск: `CONFIG_PATH` → `./config.yaml` → `backend/config.yaml`). Шаблон —
`backend/config.example.yaml`. Секреты в репозиторий не коммитим
(`backend/.gitignore`).

Ключевые секции: `openrouter` (ASR-модель, по умолчанию `google/gemini-2.5-flash`),
`dify` (app + dataset API, имена команд-маршрутов), `media` (ffmpeg), `max` (мост).

## Запуск

Backend:
```bash
cd backend && pip install -r requirements.txt
cp config.example.yaml config.yaml      # заполнить ключи
uvicorn app.main:app --reload --port 8000   # Swagger: /docs, здоровье: /api/health
```

Frontend:
```bash
cd frontend && npm install && npm run dev   # http://localhost:5173, прокси /api -> :8000
```

Требуется **ffmpeg** в PATH (видео → аудио, нарезка). Сервис не падает без ключей —
ASR/Dify вернут пустой результат, остальной API работает.

## Поток данных

1. Загрузка медиа → `POST /api/transcriptions` → фоновый ASR (OpenRouter, чанкинг,
   тайм-коды, спикеры) → сегменты в БД → транскрипт уходит в датасет Dify
   (историческая память).
2. `POST /api/protocols` → Dify (`Извлечение протокола`) → протокол + поручения
   (с `source_fragment`, `reason_comment`).
3. `POST /api/tasks/{id}/justification` → Dify (`Справка-обоснование`) → фрагмент +
   должностная обязанность из БЗ (ТЗ 2Б).
4. `POST /api/qa` → Dify (`Вопросы пользователя`) по выбранному scope, с цитатами.
5. `POST /api/search` → Dify Dataset retrieve по всем встречам (фоллбэк — локальный
   полнотекстовый поиск).
6. `POST /api/export` → DOCX/PDF/MD/TXT/JSON.

Маршруты Dify задаются полем `command`; имена должны совпадать в трёх местах:
`backend/config.yaml → dify.command_*`, классах ноды `classifier` и таблице в
`dify/WORKFLOW.md`.

## MAX (референс)

`microservice/` показывает интеграцию с мессенджером MAX: inline-кнопки
`confirm:`/`approve:`, цепочка подтверждения исполнения, вызов Dify на справку,
отправка DOCX. Подключается опционально через `backend/config.yaml → max.enabled`
(точка расширения, по умолчанию выключено). Переиспользуемые файлы:
`max_client.py`, `max_handler.py`, `dify_memo_client.py`.

## Конвенции

- Backend: Python 3.11+, FastAPI, SQLAlchemy 2.0, async httpx. Внешние вызовы
  «мягкие» — при ошибке возвращают пустой результат, а не падают. Комментарии и
  пользовательские строки — на русском.
- Frontend: TypeScript strict, функциональные компоненты, React Query для серверного
  состояния, Zustand для UI-состояния. Тема — CSS-переменные + класс `dark`.
  Палитра в `src/index.css`, UI-классы (`.card`, `.btn-primary`, `.input`) там же.
- Проверки: backend — `python -m py_compile app/**/*.py`; frontend — `npm run build`
  (tsc + vite).

## Точки расширения (TODO в коде)

- Уточнить формат `input_audio` под конкретную ASR-модель OpenRouter
  (`backend/app/services/openrouter_asr.py`).
- Перенос «тяжёлой» цепочки назначения (итерация + двойной KB-поиск + DOCX) из
  production-workflow в `llm_protocol` (см. `dify/WORKFLOW.md`).
- Связка статусов поручений backend ↔ подтверждения MAX (общая БД или HTTP-мост).
