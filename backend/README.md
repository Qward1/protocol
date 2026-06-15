# Backend — Digital Office API

FastAPI-сервис для веб-UI: транскрибация (OpenRouter), генерация протоколов и
поручений, Q&A, семантический поиск, справки-обоснования, экспорт.

## Запуск

```bash
cd backend
python -m venv .venv && . .venv/Scripts/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp config.example.yaml config.yaml                 # заполнить ключи
uvicorn app.main:app --reload --host 0.0.0.0 --port 8080
```

Открыть Swagger: http://localhost:8080/docs · здоровье: `/api/health`.

## Запуск на одном внешнем порту

Если наружу открыт только порт 8080, соберите frontend и запускайте один FastAPI:

```bash
# из корня репозитория
.\scripts\start_8080.ps1     # Windows PowerShell
# или
bash scripts/start_8080.sh   # Linux/macOS
```

Скрипт создаёт `.venv`, ставит `requirements.txt`, затем FastAPI отдаёт
`../frontend/dist` и API из одного процесса. Для внешнего URL вида
`/jnserver/1109/application/` используйте:

```yaml
port: 8080
public_base_path: /jnserver/1109/application/
```

## Конфигурация

Только YAML, без `.env`. Поиск файла: `CONFIG_PATH` → `./config.yaml` → `backend/config.yaml`.
Ключевые секции: `openrouter` (ASR-модель), `dify` (app + dataset API), `media` (ffmpeg).

## Зависимости среды

- **ffmpeg** в PATH (или укажите `media.ffmpeg_path`) — нужен для видео и нарезки аудио.
- Ключ **OpenRouter** — для распознавания речи.
- Ключи **Dify** — для протоколов / Q&A / справок и исторической памяти (Dataset API).

Сервис не падает, если внешние ключи не заданы: ASR/Dify-вызовы вернут пустой
результат, остальной API (хранение, экспорт, локальный поиск) работает.

## Структура

```
app/
  config.py        загрузка YAML -> Pydantic
  db.py, models.py каркас БД (SQLite)
  schemas.py       DTO
  api/             роутеры (transcriptions, protocols, tasks, qa, search, library, export)
  services/        openrouter_asr, media(ffmpeg), dify_client, exporter, storage
  core/prompts.py  системные промпты ASR/диаризации
```

## Что уже реализовано

- ASR через OpenRouter с чанкингом, тайм-кодами, диаризацией; формат аудио-части
  конфигурируем (`openrouter.audio_part_type`).
- Контроль исполнения: `PATCH /api/tasks/{id}`, `POST .../execution` (что сделано),
  `POST .../confirm` (подтверждение руководителем + справка через Dify + опц. MAX).
- Справка-обоснование (`POST /api/tasks/{id}/justification`).
- CRUD: удаление/перезапуск транскрипции, правка сегментов, удаление протокола.
- Загрузка: потоковая запись, лимит размера (`upload.max_mb`), белый список расширений.
- Экспорт DOCX (реальные таблицы) / PDF (кириллический шрифт) / MD / TXT / JSON.
- Аутентификация X-Api-Key на изменяющих запросах (`security.require_auth`).
- Дублирование поручений во внешний сервис (`execution_control.enabled`).
- Мост к MAX (`max.enabled`), структурное логирование, тесты (`pytest`).

## Тесты

```bash
cd backend && python -m pytest -q
```

## Точки расширения (осознанно не доделано)

- **Очередь задач**: ASR работает на FastAPI `BackgroundTasks` (в процессе). Для
  продакшена вынести в воркер (RQ/Celery/arq) с устойчивостью к рестарту.
- **Live-проверка Dify Dataset API**: имена полей `create-by-text` / `retrieve`
  выверены по документации, но не проверены на живой инстанции.
- **Миграции БД**: сейчас `create_all` (без Alembic) — изменение моделей требует
  пересоздания `app.db`.
- Уточнить формат `input_audio` под конкретную модель OpenRouter на первом прогоне.
