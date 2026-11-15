/**
 * SQLite: таблица записей и полнотекстовый индекс FTS5 рядом с ней.
 *
 * Пока самый простой вариант: индекс по title и body, ранжирование bm25 по умолчанию.
 * Веса полей, свежесть и карточки — на следующих этапах.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite"; // встроен в Node; FTS5 в нём есть начиная с Node 26

import type { BrainRecord } from "./records.ts";

export type DB = DatabaseSync;

// Путь от этого файла, а не от текущей папки: MCP-сервер Claude запускает из своей рабочей папки.
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
-- Копия текста под поиск. rowid в индексе = id записи.
CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(title, body);
`;

/** Строка таблицы records — как она лежит в базе (имена колонок в snake_case). */
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
 * Выполнить fn атомарно: либо все запросы внутри применятся, либо ни один.
 * Без этого SQLite коммитит каждый запрос отдельно. SAVEPOINT, в отличие от BEGIN, можно вкладывать:
 * снаружи транзакции он открывает новую, внутри — ставит точку отката.
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

/** Вставить или обновить запись — и синхронно индекс. Повторный вызов с теми же данными ничего не меняет. */
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
  // Каждое слово в кавычки: так спецсимволы запроса (дефис, двоеточие) не ломают синтаксис FTS5.
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
    .all(match, limit) as unknown as SearchHit[]; // node:sqlite не знает наших полей — тип строки задаём сами
}

export function get(db: DB, id: number): StoredRecord | undefined {
  return db.prepare("SELECT * FROM records WHERE id = ?").get(id) as unknown as StoredRecord | undefined;
}
