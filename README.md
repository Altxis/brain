# brain

Личная память для Claude: собрать → сохранить → найти → отдать агенту.
Учебная пересборка «второго мозга» с нуля, этап за этапом. Выводы — в [LEARNING.md](LEARNING.md).

## Запуск

Нужен Node.js 26 (версия в `.nvmrc`: `nvm use` в корне проекта переключит на неё).

```bash
npm install
npm run brain sync              # забрать сессии Claude Code в базу (data/brain.db в проекте, или $BRAIN_DB)
npm run brain -- search migaku  # поиск (`--` нужен, чтобы npm не съел флаги вроде -n)
npm run brain -- show 1         # запись целиком
npm test                        # тесты (node:test)
npm run typecheck               # проверка типов
```

Подключить к Claude Code (путь к `tsx` абсолютный: `npm run` печатает баннер в stdout и ломает протокол):

```bash
claude mcp add -s user brain -- /путь/к/brain/node_modules/.bin/tsx /путь/к/brain/src/cli.ts mcp
```

## Устройство

```
src/
  records.ts                общий формат записи (BrainRecord)
  connectors/claudeCode.ts  сессии Claude Code → записи
  db.ts                     SQLite (встроенный node:sqlite) + FTS5: upsert, search, get
  mcpServer.ts              инструменты search и get_record для Claude
  cli.ts                    CLI: sync | search | show | mcp
tests/thread.test.ts        сквозной тест: JSONL → запись → база → поиск
```
