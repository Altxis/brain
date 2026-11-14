# brain

Личная память для Claude: собрать → сохранить → найти → отдать агенту.
Учебная пересборка «второго мозга» с нуля, этап за этапом. Выводы — в [LEARNING.md](LEARNING.md).

## Запуск

```bash
uv sync
uv run brain sync               # забрать сессии Claude Code в базу (~/.brain/brain.db, или $BRAIN_DB)
uv run brain search "migaku"    # поиск
uv run brain show 1             # запись целиком
uv run pytest                   # тесты
```

Подключить к Claude Code:

```bash
claude mcp add -s user brain -- uv run --project /путь/к/brain brain mcp
```

## Устройство

```
src/brain/
  records.py              общий формат записи
  connectors/claude_code.py  сессии Claude Code → записи
  db.py                   SQLite + FTS5: upsert, search, get
  mcp_server.py           инструменты search и get_record для Claude
  __init__.py             CLI: sync | search | show | mcp
```
