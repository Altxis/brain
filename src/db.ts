/**
 * SQLite: a records table with an FTS5 full-text index next to it.
 *
 * The simplest version for now: index on title and body, default bm25 ranking.
 * Field weights, recency and cards come in later stages.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite"; // built into Node; has FTS5 since Node 26

import type { BrainRecord } from "./records.ts";

export type DB = DatabaseSync;

// Path relative to this file, not the cwd: Claude starts the MCP server from its own working directory.
const PROJECT_ROOT = join(import.meta.dirname, "..");
export const DEFAULT_DB = process.env.BRAIN_DB ?? join(PROJECT_ROOT, "data", "brain.db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY,
    source TEXT NOT NULL,
    external_id TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    project TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE (source, external_id)
);
-- Copy of the text for search. Index rowid = record id.
CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(title, body);
`;

/** A row of the records table as stored (snake_case column names). */
export interface StoredRecord {
  id: number;
  source: string;
  external_id: string;
  title: string;
  body: string;
  project: string | null;
  updated_at: string;
}

export interface SearchHit {
  id: number;
  source: string;
  title: string;
  project: string | null;
  updated_at: string;
  snippet: string;
}

export function connect(path: string = DEFAULT_DB): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}

let savepoints = 0;

/**
 * Run fn atomically: either every query inside applies, or none does.
 * Without this SQLite commits each query on its own. Unlike BEGIN, SAVEPOINT can be nested:
 * outside a transaction it opens a new one, inside one it sets a rollback point.
 */
export function transaction<T>(db: DB, fn: () => T): T {
  const name = `sp${savepoints++}`;
  db.exec(`SAVEPOINT ${name}`);
  try {
    const result = fn();
    db.exec(`RELEASE ${name}`);
    return result;
  } catch (err) {
    db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);
    throw err;
  }
}

/** Insert or update a record — and the index along with it. Calling again with the same data changes nothing. */
export function upsert(db: DB, r: BrainRecord): void {
  transaction(db, () => {
    const { id } = db
      .prepare(
        `INSERT INTO records (source, external_id, title, body, project, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (source, external_id) DO UPDATE SET
             title = excluded.title, body = excluded.body,
             project = excluded.project, updated_at = excluded.updated_at
         RETURNING id`,
      )
      .get(r.source, r.externalId, r.title, r.body, r.project, r.updatedAt) as unknown as { id: number };
    db.prepare("DELETE FROM records_fts WHERE rowid = ?").run(id);
    db.prepare("INSERT INTO records_fts (rowid, title, body) VALUES (?, ?, ?)").run(id, r.title, r.body);
  });
}

export function search(db: DB, query: string, limit = 5): SearchHit[] {
  // Quote every word so special characters in the query (hyphen, colon) don't break FTS5 syntax.
  const words = query.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const match = words.map((w) => `"${w.replaceAll('"', '""')}"`).join(" OR ");
  return db
    .prepare(
      `SELECT r.id, r.source, r.title, r.project, r.updated_at,
              snippet(records_fts, 1, '[', ']', '…', 16) AS snippet
       FROM records_fts JOIN records r ON r.id = records_fts.rowid
       WHERE records_fts MATCH ?
       ORDER BY bm25(records_fts)
       LIMIT ?`,
    )
    .all(match, limit) as unknown as SearchHit[]; // node:sqlite doesn't know our columns — we set the row type ourselves
}

export function get(db: DB, id: number): StoredRecord | undefined {
  return db.prepare("SELECT * FROM records WHERE id = ?").get(id) as unknown as StoredRecord | undefined;
}
