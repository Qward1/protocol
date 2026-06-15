# Dify memo patch

Заменить/добавить файлы:

- `app/services/dify_memo_client.py` — новая отдельная логика вызова Dify и скачивания DOCX.
- `app/services/max_client.py` — добавлены `manager_approval_keyboard`, `upload_file`, `send_file`.
- `app/services/max_handler.py` — после подтверждения руководителем вызывает Dify, закрывает задачу и отправляет DOCX в MAX.
- `app/config.py` — добавлены настройки Dify.

В `config.json` добавить поля из `CONFIG_DIFY_MEMO_EXAMPLE.json`.

После замены:

```bash
python -m py_compile app/services/dify_memo_client.py app/services/max_client.py app/services/max_handler.py app/config.py
pkill -f uvicorn
uvicorn app.main:app --host 0.0.0.0 --port 8080
```

Логика:

1. Сотрудник нажимает кнопку `Подтвердить исполнение`.
2. Бот просит написать, что сделано.
3. После текста сотрудника бот отправляет руководителю inline-кнопку `Подтвердить выполнение`.
4. Руководитель нажимает кнопку.
5. Микросервис отправляет в Dify:
   - саму задачу;
   - текст сотрудника;
   - фразу `Создание справки(служебной записки)`.
6. Микросервис скачивает DOCX из ответа Dify.
7. Задача становится `Выполнено`; актуальный статус хранится в backend-приложении.
8. DOCX отправляется в ту же группу MAX.
