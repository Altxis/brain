/** End-to-end "thread" test: JSONL session → record → database → search. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import * as claudeCode from "../src/connectors/claudeCode.ts";
import * as db from "../src/db.ts";

const tmpDirs: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "brain-test-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const jsonl = (events: readonly object[]) => events.map((e) => JSON.stringify(e)).join("\n");

function writeSession(root: string, name = "abc123"): void {
  const events = [
    { type: "user", cwd: "/w/proj", timestamp: "2026-11-01T10:00:00Z", message: { content: "How do I export words from Migaku?" } },
    {
      type: "assistant",
      timestamp: "2026-11-01T10:00:05Z",
      message: {
        content: [
          { type: "thinking", thinking: "hidden" },
          { type: "text", text: "Use the Word Exporter extension." },
        ],
      },
    },
    { type: "user", timestamp: "2026-11-01T10:00:06Z", message: { content: [{ type: "tool_result", content: "tool output" }] } },
    { type: "attachment", timestamp: "2026-11-01T10:00:07Z" },
  ];
  const d = join(root, "-w-proj");
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, `${name}.jsonl`), jsonl(events) + "\n{truncated");
  const sub = join(d, name, "subagents");
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(sub, "agent-1.jsonl"), JSON.stringify(events[0]));
}

test("parse keeps only dialogue", () => {
  const root = tmp();
  writeSession(root);
  const records = [...claudeCode.fetch(root)];
  assert.equal(records.length, 1); // the subagent did not get in
  const record = records[0]!;
  assert.equal(record.externalId, "abc123");
  assert.equal(record.title, "How do I export words from Migaku?");
  assert.equal(record.project, "/w/proj");
  assert.ok(record.body.includes("Word Exporter"));
  assert.ok(!record.body.includes("hidden") && !record.body.includes("tool output"));
});

test("sync is idempotent and searchable", () => {
  const root = tmp();
  writeSession(join(root, "projects"));
  const conn = db.connect(join(root, "brain.db"));
  for (let i = 0; i < 2; i++) {
    for (const r of claudeCode.fetch(join(root, "projects"))) db.upsert(conn, r);
  }
  const count = (table: string) => (conn.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
  assert.equal(count("records"), 1);
  assert.equal(count("records_fts"), 1);
  const hits = db.search(conn, "Exporter");
  assert.equal(hits.length, 1);
  assert.ok(hits[0]!.title.startsWith("How do I export"));
  conn.close();
});

test("session split across project dirs is merged", () => {
  // The session started in /w/a, then the folder changed — the continuation lives in another folder with the same id.
  // The new file repeats the old history (same uuids) and appends the continuation.
  const root = tmp();
  const first = { type: "user", uuid: "u1", cwd: "/w/a", timestamp: "2026-11-01T10:00:00Z", message: { content: "start in project A" } };
  const copy = { ...first, cwd: "/w/b" };
  const next = { type: "user", uuid: "u2", cwd: "/w/b", timestamp: "2026-11-02T10:00:00Z", message: { content: "continued in project B" } };
  for (const [folder, events] of [["-w-a", [first]], ["-w-b", [copy, next]]] as const) {
    mkdirSync(join(root, folder));
    writeFileSync(join(root, folder, "same-id.jsonl"), jsonl(events));
  }
  const records = [...claudeCode.fetch(root)];
  assert.equal(records.length, 1);
  const body = records[0]!.body;
  assert.equal(body.split("start in").length - 1, 1);
  assert.ok(body.indexOf("start in") < body.indexOf("continued in"));
  assert.equal(records[0]!.project, "/w/a");
  assert.ok(records[0]!.updatedAt.startsWith("2026-11-02"));
});
