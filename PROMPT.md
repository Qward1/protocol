# Задача: редактирование протокола + редактируемый DOCX-шаблон протокола

Репозиторий: "Цифровой Офис" (см. CLAUDE.md в корне — прочитай его перед началом,
там описана архитектура backend/frontend, конфигурация, RBAC). Ниже — точная
спецификация двух независимых требований. Реализуй последовательно: сначала
Часть 1, затем Часть 2. После каждой части — прогони тесты.

## Часть 1 — редактирование протокола перед сохранением/выгрузкой

Правки поручений (Task) уже покрыты существующим UI
(`frontend/src/components/tasks/TaskEditForm.tsx`). Эта часть — про правку
метаданных/текста самого протокола: `title`, `date`, `number`, `body`.

### Backend
1. `backend/app/schemas.py` — добавить рядом с `ProtocolDTO`:
   ```python
   class ProtocolUpdate(BaseModel):
       title: str | None = None
       date: str | None = None
       number: str | None = None
       body: str | None = None
   ```
2. `backend/app/api/protocols.py` — добавить эндпоинт (по образцу
   `update_segments` в `backend/app/api/transcriptions.py:285`):
   ```python
   @router.put("/{protocol_id}", response_model=ProtocolDTO,
               dependencies=[Depends(require_permission("protocols.manage"))])
   def update_protocol(protocol_id: str, body: ProtocolUpdate, db: Session = Depends(get_db)):
       p = db.get(Protocol, protocol_id)
       if not p:
           raise HTTPException(404, "Protocol not found")
       for field, value in body.model_dump(exclude_unset=True).items():
           setattr(p, field, value)
       db.commit()
       db.refresh(p)
       return p
   ```
   Импортировать `ProtocolUpdate` из `app.schemas`.

### Frontend
3. `frontend/src/lib/api.ts` — добавить тип `ProtocolUpdate` (зеркало DTO) и метод
   `updateProtocol(id: string, patch: ProtocolUpdate): Promise<Protocol>` (`http.put`).
4. `frontend/src/pages/ProtocolPage.tsx` — рядом с `ExportMenu` в `actions` добавить
   кнопку «Редактировать» (видна только при `can("protocols.manage")`), которая
   переключает блок протокола (сейчас строки 94-98, `<Card>` с `p.body`) в режим
   правки: инпуты для title/date/number + `<textarea>` для body, кнопки
   «Сохранить»/«Отмена». Сохранение — через `useMutation` с `api.updateProtocol`,
   по успеху `queryClient.invalidateQueries({ queryKey: ["protocol", id] })`.

### Важно
- Никакой истории/аудита правок — просто перезапись текущего состояния.
- Ничего менять в `exporter.py` не нужно: `protocol_to_md` уже читает
  `title/date/number/body` из объекта `Protocol`, поэтому сохранённые правки
  автоматически попадут во все форматы экспорта (docx/pdf/md/txt/json).

### Приёмка части 1
- `PUT /api/protocols/{id}` с частичным телом обновляет только переданные поля,
  404 на несуществующий id, доступ только с правом `protocols.manage`.
- Тест в `backend/tests/test_api.py`, проверяющий обновление и что экспорт
  (`POST /api/export`, `object_type=protocol, fmt=md`) отдаёт новый текст.
- В UI правки видны сразу после сохранения без перезагрузки страницы.

---

## Часть 2 — редактируемый DOCX-шаблон протокола

Движок: **docxtpl** (Jinja2-плейсхолдеры прямо в тексте Word-документа).
Эта функциональность **полностью заменяет** нынешний способ получения DOCX
протокола: сейчас `protocol.docx_path` может приходить из Dify-плагина
document-generator — после этой задачи `POST /api/export` с
`object_type=protocol, fmt=docx` больше не использует это поле, а рендерит
DOCX сам через активный шаблон. Сам Dify workflow (`dify/`) не трогать —
рендеринг документа не LLM-логика, значит зона backend/Платформы. Поле
`protocol.docx_path` в модели можно оставить как есть (не используется в
экспорте, но ничего страшного, если Dify всё ещё его присылает).

### Зависимости
- Добавить `docxtpl` в `backend/requirements.txt`.

### Модель данных
`backend/app/models.py` — новая таблица (обычный `create_all` подхватит её
автоматически, никаких ручных ALTER не нужно — это НЕ новая колонка в
существующей таблице, а целая новая таблица):
```python
class ProtocolTemplate(Base):
    __tablename__ = "protocol_templates"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String, default="")
    docx_path: Mapped[str] = mapped_column(String, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    detected_placeholders_json: Mapped[str] = mapped_column(Text, default="[]")
    field_mapping_json: Mapped[str] = mapped_column(Text, default="{}")  # {canonical_field: placeholder}
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
```

### Канонический каталог полей (фиксированный, НЕ придумывать новые поля —
только то, что реально есть в `Protocol`/`Task`)
`title`, `date`, `number`, `body`, и цикл `tasks` (список объектов с
`assignment`, `responsible`, `department`, `deadline`, `status`).

### `backend/app/services/protocol_template.py` (новый файл)
```python
CANONICAL_FIELDS = ["title", "date", "number", "body", "tasks"]

def extract_placeholders(docx_path: str) -> list[str]:
    """docxtpl.DocxTemplate(docx_path).get_undeclared_template_variables()"""

def auto_map(placeholders: list[str]) -> dict[str, str]:
    """Точное совпадение имени плейсхолдера с CANONICAL_FIELDS -> {field: placeholder}.
    Несовпавшие канонические поля просто отсутствуют в словаре (unmapped)."""

def build_context(protocol) -> dict:
    """{"title": ..., "date": ..., "number": ..., "body": ...,
        "tasks": [{"assignment":..., "responsible":..., "department":...,
                    "deadline":..., "status":...} for t in protocol.tasks]}"""

def render(protocol, template: "ProtocolTemplate") -> Path:
    """Взять build_context(protocol), переложить ключи через
    json.loads(template.field_mapping_json) в имена плейсхолдеров реального
    файла, отрендерить docxtpl.DocxTemplate(template.docx_path), сохранить в
    storage.exports_dir(), вернуть Path."""
```
Мягкая деградация: если `extract_placeholders`/`render` бросает исключение
(битый docx) — не 500, а понятная ошибка вызывающему коду (см. паттерн
"мягких" деградаций в CLAUDE.md), т.к. активный шаблон трогает пользователь
намеренно (upload/export), а не фоновый процесс.

### `backend/app/services/storage.py`
Добавить `templates_dir() -> Path` по образцу `exports_dir()`/`docs_dir()`.

### Схемы (`backend/app/schemas.py`)
```python
class ProtocolTemplateDTO(BaseModel):
    id: str
    name: str
    is_active: bool
    detected_placeholders: list[str] = Field(default_factory=list)
    field_mapping: dict[str, str] = Field(default_factory=dict)
    created_at: datetime
    # detected_placeholders/field_mapping собираются из *_json полей в API-слое,
    # либо задать как computed field — на усмотрение реализации.

class ProtocolTemplateMappingUpdate(BaseModel):
    field_mapping: dict[str, str]
```

### Новый роутер `backend/app/api/protocol_templates.py`
Права: **новое право `templates.manage`**, доступно только роли `admin`.
Т.к. `ROLE_ADMIN` в `backend/app/services/auth.py` уже имеет `{"*"}`, ничего
менять в `ROLE_PERMISSIONS` не нужно — `require_permission("templates.manage")`
и так пройдёт только для admin (и для синтетического admin при
`auth.enabled: false`). Не добавляй это право другим ролям.

Эндпоинты:
- `POST /api/protocol-templates` — загрузка `.docx` (`UploadFile`), сохранить в
  `storage.templates_dir()`, вызвать `extract_placeholders` + `auto_map`,
  снять `is_active` с текущего активного шаблона, создать новую запись с
  `is_active=True`. Вернуть `ProtocolTemplateDTO`.
- `GET /api/protocol-templates` — список всех (история), сортировка по
  `created_at desc`.
- `GET /api/protocol-templates/active` — текущий активный (404 если нет).
- `PUT /api/protocol-templates/{id}/mapping` — принять
  `ProtocolTemplateMappingUpdate`, перезаписать `field_mapping_json`.
- `POST /api/protocol-templates/{id}/activate` — сделать этот активным,
  снять флаг с остальных.
- `GET /api/protocol-templates/{id}/file` — `FileResponse` с `.docx`.

Зарегистрировать роутер в `backend/app/main.py`: добавить `protocol_templates`
в импорт из `app.api` (строки 25-35) и в кортеж на строке 156
(`for module in (auth_api, transcriptions, protocols, tasks, qa, search, library, export, max_api, protocol_templates)`).

### Интеграция с экспортом
`backend/app/services/exporter.py` — новая функция:
```python
def render_protocol_docx(protocol, template) -> Path:
    from app.services import protocol_template
    return protocol_template.render(protocol, template)
```
`backend/app/api/export.py`, в ветке `object_type == "protocol"` — если
`fmt == "docx"`, проверить активный `ProtocolTemplate` в БД: если есть —
вызвать `exporter.render_protocol_docx(p, active_template)` и вернуть этот
файл напрямую (`FileResponse`); если активного шаблона нет — оставить
текущее поведение (`exporter.render(md, raw, "docx", name)`, generic
markdown->docx). Никаких 500 при отсутствии шаблона.

### Frontend
5. `frontend/src/lib/api.ts` — типы `ProtocolTemplate`, `ProtocolTemplateMappingUpdate`
   + методы: `listProtocolTemplates()`, `getActiveProtocolTemplate()`,
   `uploadProtocolTemplate(file: File)` (multipart/form-data),
   `updateProtocolTemplateMapping(id, mapping)`, `activateProtocolTemplate(id)`.
6. Новая страница `frontend/src/pages/ProtocolTemplatePage.tsx`
   (по образцу `frontend/src/pages/AdminUsersPage.tsx`):
   - загрузка нового `.docx` (input type=file + кнопка «Загрузить»);
   - таблица найденных плейсхолдеров активного шаблона, с `<select>` в каждой
     строке — выбор канонического поля (`title/date/number/body/tasks` и т.п.)
     из `CANONICAL_FIELDS`; сохранение через `updateProtocolTemplateMapping`;
   - список предыдущих версий шаблона с кнопкой «Сделать активным».
7. `frontend/src/components/Layout.tsx` — в массив `NAV` (строка 32) добавить
   пункт `{ to: "/protocol-template", label: "Шаблон протокола", icon: FileCog /* или похожая из lucide-react */, group: "Администрирование", perms: ["templates.manage"] }`.
8. `frontend/src/App.tsx` — добавить `<Route>` на `/protocol-template`,
   обёрнутый в `<RequirePerm perms={["templates.manage"]}>` (по образцу
   маршрута `/users`, строки ~100-102).

### Приёмка части 2
- Загрузка `.docx` с плейсхолдерами `{{ title }}`, `{{ date }}`, `{{ number }}`,
  `{{ body }}` и `{% for t in tasks %}...{{ t.assignment }}...{% endfor %}`
  → все они автоматически распознаются и авто-сопоставляются с каноническими
  полями.
- Ручная правка маппинга через `PUT .../mapping` меняет, какое поле протокола
  попадает в конкретный плейсхолдер, без переисполнения загрузки файла.
- `POST /api/export` с `object_type=protocol, fmt=docx` при наличии активного
  шаблона отдаёт файл, отрендеренный именно по этому шаблону с реальными
  данными протокола; без активного шаблона — прежнее поведение не ломается.
- Страница управления шаблоном видна только пользователю с ролью admin.

---

## Тестирование (обязательно перед сдачей)
- Backend: `cd backend && python -m pytest -q` — добавить тесты:
  `test_protocol_update` (часть 1), `test_protocol_template_upload_detects_placeholders`,
  `test_protocol_template_mapping_update`, `test_export_protocol_docx_uses_active_template`
  (сгенерировать фикстурный `.docx` в самом тесте через `python-docx`, вписав
  текст плейсхолдеров прямо в параграф — `docxtpl` считает такой файл валидным
  шаблоном).
- Frontend: `cd frontend && npm run build` (tsc -b && vite build) должен
  проходить без ошибок типов — это единственный "тест" фронтенда в проекте.
- Ручная проверка в браузере (`npm run dev` + backend на :8080): открыть
  протокол, отредактировать текст и сохранить; зайти в «Шаблон протокола»,
  загрузить тестовый `.docx`, проверить обнаруженные поля и маппинг, затем
  экспортировать протокол в docx и открыть результат.

## Явные ограничения (не выходить за рамки)
- Один активный шаблон одновременно — не делать выбор шаблона "под тип
  совещания" и не хранить несколько активных.
- Никакой истории/undo для правок текста протокола (часть 1).
- Не добавлять новые канонические поля, которых нет в моделях `Protocol`/`Task`
  (без организации/председателя/списка присутствующих и т.п.).
- Не трогать `dify/` (workflow DSL) и не менять Dify-command роутинг.
- Не давать право `templates.manage` ролям `head`/`staff`/`executor`.
