/** Сквозной тест «нити»: JSONL-сессия → запись → база → поиск. */
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
    { type: "user", cwd: "/w/proj", timestamp: "2026-11-01T10:00:00Z", message: { content: "Как выгрузить слова из Migaku?" } },
    {
      type: "assistant",
      timestamp: "2026-11-01T10:00:05Z",
      message: {
        content: [
          { type: "thinking", thinking: "скрыто" },
          { type: "text", text: "Через расширение Word Exporter." },
        ],
      },
    },
    { type: "user", timestamp: "2026-11-01T10:00:06Z", message: { content: [{ type: "tool_result", content: "вывод инструмента" }] } },
    { type: "attachment", timestamp: "2026-11-01T10:00:07Z" },
  ];
  const d = join(root, "-w-proj");
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, `${name}.jsonl`), jsonl(events) + "\n{обрезано");
  const sub = join(d, name, "subagents");
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(sub, "agent-1.jsonl"), JSON.stringify(events[0]));
}

test("parse keeps only dialogue", () => {
  const root = tmp();
  writeSession(root);
  const records = [...claudeCode.fetch(root)];
  assert.equal(records.length, 1); // подагент не попал
  const record = records[0]!;
  assert.equal(record.externalId, "abc123");
  assert.equal(record.title, "Как выгрузить слова из Migaku?");
  assert.equal(record.project, "/w/proj");
  assert.ok(record.body.includes("Word Exporter"));
  assert.ok(!record.body.includes("скрыто") && !record.body.includes("вывод инструмента"));
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
  assert.ok(hits[0]!.title.startsWith("Как выгрузить"));
  conn.close();
});

test("session split across project dirs is merged", () => {
  // Сессия началась в /w/a, потом сменилась папка — продолжение лежит в другой папке с тем же id.
  // Новый файл повторяет старую историю (те же uuid) и дописывает продолжение.
  const root = tmp();
  const first = { type: "user", uuid: "u1", cwd: "/w/a", timestamp: "2026-11-01T10:00:00Z", message: { content: "начало в проекте A" } };
  const copy = { ...first, cwd: "/w/b" };
  const next = { type: "user", uuid: "u2", cwd: "/w/b", timestamp: "2026-11-02T10:00:00Z", message: { content: "продолжение в проекте B" } };
  for (const [folder, events] of [["-w-a", [first]], ["-w-b", [copy, next]]] as const) {
    mkdirSync(join(root, folder));
    writeFileSync(join(root, folder, "same-id.jsonl"), jsonl(events));
  }
  const records = [...claudeCode.fetch(root)];
  assert.equal(records.length, 1);
  const body = records[0]!.body;
  assert.equal(body.split("начало").length - 1, 1);
  assert.ok(body.indexOf("начало") < body.indexOf("продолжение"));
  assert.equal(records[0]!.project, "/w/a");
  assert.ok(records[0]!.updatedAt.startsWith("2026-11-02"));
});
