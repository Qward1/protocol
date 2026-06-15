# Dify Workflow — Цифровой Офис

Два файла:

- **`Ассистент Цифровой Офис (1).yml`** — исходный **production**-workflow (референс). Содержит полную «тяжёлую» логику: классификацию, извлечение протокола, итерацию по поручениям, двойной поиск по базам знаний, финализацию задачи строгим JSON, генерацию DOCX и отправку задач в `execution-control-service` (HTTP). **Не редактируем** — используем как источник промптов и схем.
- **`digital-office-workflow.yml`** — **новый** чистый workflow для backend веб-платформы. Импортируемый, advanced-chat, 11 нод. Покрывает 4 маршрута через один вход.

## Маршрутизация

Backend (`backend/app/services/dify_client.py`) вызывает `/chat-messages`, передавая:
- `inputs.command` — точное имя команды;
- ту же команду в начале `query` (Question Classifier читает `sys.query`, не `inputs`).

Имена команд должны совпадать с `backend/config.yaml → dify.command_*` и классами ноды `classifier`:

| command (config)          | Класс classifier                  | Ветка                       |
|---------------------------|-----------------------------------|-----------------------------|
| `command_protocol`        | Извлечение протокола              | `llm_protocol` → answer     |
| `command_qa`              | Вопросы пользователя              | `llm_qa` → answer           |
| `command_justification`   | Справка-обоснование               | `kr_duties` → `llm_justification` → answer |
| `command_memo`            | Создание справки(служебной записки) | `llm_memo` → answer       |

## Узлы

- **start** — переменные входа: `command`, `transcript`, `context`, `question`, `assignment`, `responsible`, `department`, `source_fragment`. Все необязательные; backend заполняет нужные под маршрут.
- **classifier** (`question-classifier`) — 4 класса (см. таблицу), модель `qwen3-32b-fp8-v2`, temp 0.0.
- **llm_protocol** — извлекает протокол + поручения, возвращает **JSON** (`meeting_title`, `protocol_date`, `protocol_number`, `body`, `tasks[]`). Каждая задача обязана нести `source_fragment` и `reason_comment` — это нужно фронту для jump-to-fragment и для справки-обоснования. Backend парсит JSON в `app/api/protocols.py`.
- **llm_qa** — отвечает только по записи/протоколу (`question` + `context`).
- **kr_duties** (`knowledge-retrieval`) — поиск должностных обязанностей по `responsible` в датасете направлений деятельности.
- **llm_justification** — формирует справку-обоснование **JSON** (`fragment`, `duty`, `text`): на основании какого фрагмента и какой должностной обязанности назначено поручение (ТЗ 2Б). Контекст — результат `kr_duties`.
- **llm_memo** — служебная записка о выполненной работе.
- **answer_\*** — отдают `text` соответствующего LLM.

## Базы знаний (datasets)

Из production-файла (значения специфичны для конкретной инстанции Dify):

- ФИО сотрудников: `akQ3ZWeGXn1iZgmfZXJhhuHwJvPTL1EA+KsMTx57k1mzAOoOtsP0zw/Jn6i1KGUr`
- Направления деятельности / должностные обязанности: `bCDop8iBsjMPI8QwUTpCNtLb1c8Ma/aptrAvy+DNBdnjEckBCH0J6AXGlXxqB/tU`

`kr_duties` использует второй датасет. При импорте в другую инстанцию **замените `dataset_ids`** на свои.

Эмбеддинги: `bge-m3-v2` (OpenAI-compatible), hybrid (vector 0.7 / keyword 0.3).

## Историческая память (Dataset API)

Транскрипты заносятся в отдельный датасет напрямую из backend (`dify_client.add_transcript_document` → `POST /datasets/{id}/document/create-by-text`) с метаданными `meeting_id`, `filename`. Семантический поиск — `POST /datasets/{id}/retrieve`. ID датасета транскриптов задаётся в `backend/config.yaml → dify.transcripts_dataset_id`.

## После импорта в Dify

1. Импортировать `digital-office-workflow.yml` (Studio → Import DSL).
2. Проверить/переподключить модели `qwen3-32b-fp8-v2`, `bge-m3-v2` и плагин document-generator.
3. Подставить свои `dataset_ids` в `kr_duties`.
4. Опубликовать, скопировать App API Key → `backend/config.yaml → dify.app_api_key`.
5. (Опционально) добавить ноды Generate DOCX к ветке обоснования/справки — по образцу production-файла, если нужны DOCX-файлы из самого workflow. Сейчас DOCX-экспорт делает backend (`exporter.py`).

## Перенос «тяжёлой» логики

Если нужна полная цепочка назначения с итерацией и двойным KB-поиском (как в production), скопируйте ноды итерации/финализации из `Ассистент Цифровой Офис (1).yml` в ветку `llm_protocol` — структура нод и промпты совместимы (та же модель, те же поля задачи).
