/**
 * MCP server: gives Claude two tools — search the database and read a full record.
 *
 * The official SDK handles the protocol (JSON-RPC over stdin/stdout) entirely:
 * we describe the tools and define the parameter schema with zod — the SDK builds JSON Schema from it.
 * Important: stdout is taken by the protocol, so no console.log — only console.error.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import * as db from "./db.ts";

const CHUNK = 20_000;
const READ_ONLY = { readOnlyHint: true };

/** Tool response — JSON as text: Claude will read it. */
const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });

export async function run(): Promise<void> {
  const conn = db.connect();
  const server = new McpServer(
    { name: "brain", version: "0.1.0" },
    { instructions: "Memory of the user's past conversations with Claude Code." },
  );

  server.registerTool(
    "search",
    {
      description:
        "Search the user's past conversations with Claude Code.\n" +
        "Returns id, title, project, date and a snippet with the match. Full text via get_record.",
      inputSchema: { query: z.string(), limit: z.number().int().positive().default(5) },
      annotations: READ_ONLY,
    },
    async ({ query, limit }) => json(db.search(conn, query, limit)),
  );

  server.registerTool(
    "get_record",
    {
      description: "Full record by id from search. Long text comes in chunks: pass next_offset to continue.",
      inputSchema: { id: z.number().int(), offset: z.number().int().nonnegative().default(0) },
      annotations: READ_ONLY,
    },
    async ({ id, offset }) => {
      const row = db.get(conn, id);
      if (!row) return { ...json({ error: `no record ${id}` }), isError: true };
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
