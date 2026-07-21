# Аналитический дашборд и рейтинг исполнителей — дизайн

> Спецификация к требованиям п. 4.5.1–4.5.5. Ветка `prompt-2-ux-deadlines`.
> Согласованные решения: отдельная страница «Аналитика»; шкала приоритета из 4
> уровней; 4 фиксированных условия рейтинга; утренняя справка по расписанию +
> вручную.

## Сквозное требование (4.5.5)

Все числовые показатели дашборда, утренней справки и рейтинга — детерминированная
SQL/Python-агрегация из таблицы поручений (`Task`). Ни один показатель не
генерируется Dify/LLM. Справка всегда фиксирует дату/время среза (`as_of`) и период.

## 1. Модель данных (без Alembic: `create_all` + `_TASK_ADDED_COLUMNS`)

### Task — новые колонки
- `priority: str` (default `"Обычный"`). Константы `TASK_PRIORITIES = (Низкий,
  Обычный, Высокий, Критический)` в `models.py`; зеркало `TASK_PRIORITY` в
  `api.ts`; валидация в `TaskUpdate` через `Literal[TASK_PRIORITIES]` (как статус).
- `location: str`, `object: str`, `theme: str` (default `""`) — свободный текст
  как `department`; в фильтрах — выпадающие списки из distinct-значений данных.

Все четыре добавляются в `_TASK_ADDED_COLUMNS` (`priority` с DEFAULT `'Обычный'`,
остальные с DEFAULT `''`).

### RatingRule
`id, condition, points: float, enabled: bool, created_at`. `condition` — из
фиксированного каталога `analytics.RATING_CONDITIONS`:
- `done_on_time` — «Исполнено в срок»: `status=Выполнено ∧ deadline_at ∧ closed_at ≤ deadline_at`
- `done_late` — «Исполнено с опозданием»: `status=Выполнено ∧ deadline_at ∧ closed_at > deadline_at`
- `overdue_open` — «Просрочено (не исполнено)»: `status≠Выполнено ∧ deadline_at < now`
- `done_priority` — «Исполнено приоритетное»: `status=Выполнено ∧ priority ∈ {Высокий, Критический}`

Правила складываются по каждому поручению исполнителя. Дефолты сеются при старте
только если таблица пуста (как `seed_admin`): `+10 / +3 / −5 / +5`. Заказчик
(роль admin) меняет баллы/включённость через UI — без правки кода.

### MorningBrief
`id, as_of, generated_at, payload_json, created_at`. `payload_json` — полный
детерминированный снимок (счётчики по статусам, просроченные, приоритетные с
приближающимся сроком, изменения с прошлой справки, метка периода).

## 2. Агрегация — `app/services/analytics.py` (без Dify/LLM)
- `TaskFilters` (period_from/to, responsible, location, object, theme, priority,
  status) + `apply_filters(query, filters)`.
- `compute_kpis` → `{total, in_work, done, overdue}` как разбиение
  (`total = in_work + done + overdue`; `overdue` = не выполнено ∧ `deadline_at < now`).
- `compute_ratings(tasks, rules, now)` → по исполнителю сумма баллов + детализация
  `[{condition, count, points, task_ids}]`.
- `compute_highlights(tasks, now)` → `{overdue:[…], priority:[…]}` (Высокий/Критич.).
- `distinct_filter_values(db)` — значения для фильтров.
- `build_brief(db, as_of)` → снимок + «изменения с прошлой справки» (дифф к
  предыдущему `MorningBrief`).

## 3. Плановый job утренней справки (единственный новый фоновый цикл)
`app/services/morning_brief.py`: `generate_and_store(db, as_of)` + `brief_loop()`,
спящий до следующего локального времени и сохраняющий снимок. Конфиг-секция
`analytics` (`morning_brief_enabled: true`, `morning_brief_time: "08:00"`, зона —
`max.timezone`). Запуск/отмена в lifespan рядом с `reminder_task`. Тесты зовут
`build_brief`/`generate_and_store` напрямую.

## 4. API
- `app/api/analytics.py` (`require_permission("dashboard.view")`):
  `GET /api/analytics/dashboard?…filters` → `{kpis, ratings, highlights,
  filter_options, now}`; `GET /api/analytics/brief/latest`,
  `GET /api/analytics/briefs`, `POST /api/analytics/brief`.
- `app/api/rating_rules.py` (`require_permission("rating_rules.manage")` — только
  admin, покрыт `"*"`, другим ролям не выдаётся): `GET` (правила + каталог
  условий), `POST`, `PATCH/{id}`, `DELETE/{id}`.
- `/api/export`: `object_type == "brief"` → `exporter.brief_to_md` → docx/pdf.

## 5. Frontend
- `AnalyticsPage.tsx` (`/analytics`, gated `dashboard.view`): фильтры → KPI-карточки
  → рейтинг с раскрываемой детализацией и ссылками на поручения → блок подсветки →
  блок утренней справки (последняя / «Сформировать сейчас» / выгрузка Word·PDF).
- `RatingRulesPage.tsx` (`/rating-rules`, gated `rating_rules.manage`, группа
  «Администрирование») — CRUD по образцу `AdminUsersPage`.
- Реестр (двойная поверхность подсветки, 4.5.4): `TaskCard` получает чип приоритета
  и визуальный акцент для просроченных/высокоприоритетных; `DashboardPage` читает
  `?focus={taskId}` и подскролливает+подсвечивает карточку — ссылки из аналитики
  ведут «к его карточке».
- `api.ts` зеркалит: приоритет, фильтры, DTO дашборда, правило + каталог условий,
  справку. `TaskEditForm`/`Draft` получают priority/location/object/theme.
  Старый клиентский `Ratings` на реестре убирается (заменён страницей аналитики).

## 6. Порядок реализации (тесты после каждой части)
A. Фундамент (поля Task + миграция + схемы + форма правки + мягкий маппинг Dify) →
1. KPI/фильтры + каркас AnalyticsPage → 2. Утренняя справка → 3. Рейтинг + CRUD
правил → 4. Подсветка + focus-ссылка. Backend-наборы: `test_analytics.py`,
`test_rating_rules.py`, `test_brief.py`; фронт — `npm run build`.
