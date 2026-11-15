/** brain — personal memory for Claude: collect → store → find → hand to the agent. */
import { parseArgs } from "node:util";

import * as claudeCode from "./connectors/claudeCode.ts";
import * as db from "./db.ts";

const HELP = `usage: brain <command>

  sync                  pull sessions into the database
  search <query> [-n N] search (5 results by default)
  show <id>             full record
  mcp                   MCP server for Claude (stdio)`;

function sync(): void {
  const conn = db.connect();
  let n = 0;
  // One outer transaction for the whole pass — many times faster than a commit per record.
  db.transaction(conn, () => {
    for (const record of claudeCode.fetch()) {
      db.upsert(conn, record);
      n++;
    }
  });
  conn.close();
  console.log(`claude_code: ${n} sessions in the database`);
}

function search(query: string, limit: number): void {
  const conn = db.connect();
  const rows = db.search(conn, query, limit);
  conn.close();
  for (const r of rows) console.log(`#${r.id}  ${r.updated_at.slice(0, 10)}  ${r.title}\n    ${r.snippet}\n`);
  if (rows.length === 0) console.log("nothing found");
}

function show(id: number): void {
  const conn = db.connect();
  const row = db.get(conn, id);
  conn.close();
  console.log(row ? row.body : `no record ${id}`);
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
    const { run } = await import("./mcpServer.ts"); // load the SDK only when the server is needed
    return run();
  }
  console.error(HELP);
  process.exitCode = 2;
}

await main();
