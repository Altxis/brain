/** brain — личная память для Claude: собрать → сохранить → найти → отдать агенту. */
import { parseArgs } from "node:util";

import * as claudeCode from "./connectors/claudeCode.ts";
import * as db from "./db.ts";

const HELP = `usage: brain <команда>

  sync                  забрать сессии в базу
  search <запрос> [-n N]  поиск (по умолчанию 5 результатов)
  show <id>             запись целиком
  mcp                   MCP-сервер для Claude (stdio)`;

function sync(): void {
  const conn = db.connect();
  let n = 0;
  // Одна внешняя транзакция на весь проход — в разы быстрее, чем коммит на каждую запись.
  db.transaction(conn, () => {
    for (const record of claudeCode.fetch()) {
      db.upsert(conn, record);
      n++;
    }
  });
  conn.close();
  console.log(`claude_code: ${n} сессий в базе`);
}

function search(query: string, limit: number): void {
  const conn = db.connect();
  const rows = db.search(conn, query, limit);
  conn.close();
  for (const r of rows) console.log(`#${r.id}  ${r.updated_at.slice(0, 10)}  ${r.title}\n    ${r.snippet}\n`);
  if (rows.length === 0) console.log("ничего не нашлось");
}

function show(id: number): void {
  const conn = db.connect();
  const row = db.get(conn, id);
  conn.close();
  console.log(row ? row.body : `нет записи ${id}`);
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { limit: { type: "string", short: "n", default: "5" }, help: { type: "boolean", short: "h" } },
  });
  const [command, arg] = positionals;

  if (values.help || !command) return console.log(HELP);
  if (command === "sync") return sync();
  if (command === "search" && arg) return search(arg, Number(values.limit));
  if (command === "show" && arg) return show(Number(arg));
  if (command === "mcp") {
    const { run } = await import("./mcpServer.ts"); // SDK грузим только когда нужен сервер
    return run();
  }
  console.error(HELP);
  process.exitCode = 2;
}

await main();
