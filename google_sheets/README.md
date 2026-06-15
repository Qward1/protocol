# Google Sheets Apps Script

`Code.gs` — Web App для синхронизации реестра поручений с Google Таблицей.

## Установка

1. Создайте Google Таблицу.
2. Откройте `Расширения -> Apps Script`.
3. Вставьте содержимое `Code.gs`.
4. В `Project Settings -> Script Properties` добавьте:
   - `SCRIPT_TOKEN` — общий токен для backend.
5. `Deploy -> New deployment -> Web app`:
   - Execute as: `Me`
   - Who has access: `Anyone with the link`
6. Скопируйте URL `/exec` в `backend/config.yaml`:

```yaml
google_sheets:
  enabled: true
  webapp_url: "https://script.google.com/macros/s/.../exec"
  script_token: "тот_же_SCRIPT_TOKEN"
```

Скрипт принимает `action: "upsert"` и `action: "complete"`. При `complete`
строка поручения отмечается статусом `Выполнено` и подсвечивается зелёным.
