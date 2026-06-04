# YouGile MCP Server

MCP сервер для управления YouGile прямо из Claude.

## Инструменты

- `yougile_list_projects` — список проектов
- `yougile_list_boards` — доски проекта
- `yougile_list_columns` — колонки доски
- `yougile_list_tasks` — задачи в колонке
- `yougile_create_task` — создать задачу
- `yougile_update_task` — обновить задачу
- `yougile_list_users` — список сотрудников
- `yougile_send_message` — сообщение в чат задачи

## Деплой на Railway

1. Создай новый репозиторий на GitHub
2. Загрузи все файлы
3. Railway → New Project → Deploy from GitHub
4. Variables: добавь `YOUGILE_KEY`
5. MCP URL: `https://твой-домен.up.railway.app/mcp`

## Подключение в Claude

Settings → Integrations → Add MCP Server
URL: `https://твой-домен.up.railway.app/mcp`
