/**
 * MCP-сервер: даёт Claude два инструмента — искать в базе и читать запись целиком.
 *
 * Протокол (JSON-RPC по stdin/stdout) целиком берёт на себя официальный SDK:
 * мы описываем инструменты, а схему параметров задаём через zod — из неё SDK строит JSON Schema.
 * Важно: stdout занят протоколом, поэтому никаких console.log — только console.error.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import * as db from "./db.ts";

const CHUNK = 20_000;
const READ_ONLY = { readOnlyHint: true };

/** Ответ инструмента — JSON текстом: Claude его прочитает. */
const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });

export async function run(): Promise<void> {
  const conn = db.connect();
  const server = new McpServer(
    { name: "brain", version: "0.1.0" },
    { instructions: "Память прошлых разговоров пользователя с Claude Code." },
  );

  server.registerTool(
    "search",
    {
      description:
        "Поиск по прошлым разговорам пользователя с Claude Code.\n" +
        "Возвращает id, заголовок, проект, дату и фрагмент с совпадением. Целиком — через get_record.",
      inputSchema: { query: z.string(), limit: z.number().int().positive().default(5) },
      annotations: READ_ONLY,
    },
    async ({ query, limit }) => json(db.search(conn, query, limit)),
  );

  server.registerTool(
    "get_record",
    {
      description: "Запись целиком по id из search. Длинный текст отдаётся кусками: для продолжения передай next_offset.",
      inputSchema: { id: z.number().int(), offset: z.number().int().nonnegative().default(0) },
      annotations: READ_ONLY,
    },
    async ({ id, offset }) => {
      const row = db.get(conn, id);
      if (!row) return { ...json({ error: `нет записи ${id}` }), isError: true };
      const end = offset + CHUNK;
      return json({
        id: row.id,
        title: row.title,
        project: row.project,
        updated_at: row.updated_at,
        body: row.body.slice(offset, end),
        next_offset: end < row.body.length ? end : null,
      });
    },
  );

  await server.connect(new StdioServerTransport());
}
