"""SQLite: таблица записей и полнотекстовый индекс FTS5 рядом с ней.

Пока самый простой вариант: индекс по title и body, ранжирование bm25 по умолчанию.
Веса полей, свежесть и карточки — на следующих этапах.
"""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path

from .records import Record

DEFAULT_DB = Path(os.environ.get("BRAIN_DB", Path.home() / ".brain" / "brain.db"))

SCHEMA = """
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
"""


def connect(path: Path = DEFAULT_DB) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def upsert(conn: sqlite3.Connection, r: Record) -> None:
    """Вставить или обновить запись — и синхронно индекс. Повторный вызов с теми же данными ничего не меняет."""
    row = conn.execute(
        """INSERT INTO records (source, external_id, title, body, project, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (source, external_id) DO UPDATE SET
               title = excluded.title, body = excluded.body,
               project = excluded.project, updated_at = excluded.updated_at
           RETURNING id""",
        (r.source, r.external_id, r.title, r.body, r.project, r.updated_at),
    ).fetchone()
    conn.execute("DELETE FROM records_fts WHERE rowid = ?", (row["id"],))
    conn.execute("INSERT INTO records_fts (rowid, title, body) VALUES (?, ?, ?)", (row["id"], r.title, r.body))


def search(conn: sqlite3.Connection, query: str, limit: int = 5) -> list[sqlite3.Row]:
    # Каждое слово в кавычки: так спецсимволы запроса (дефис, двоеточие) не ломают синтаксис FTS5.
    match = " OR ".join('"' + w.replace('"', '""') + '"' for w in query.split())
    if not match:
        return []
    return conn.execute(
        """SELECT r.id, r.source, r.title, r.project, r.updated_at,
                  snippet(records_fts, 1, '[', ']', '…', 16) AS snippet
           FROM records_fts JOIN records r ON r.id = records_fts.rowid
           WHERE records_fts MATCH ?
           ORDER BY bm25(records_fts)
           LIMIT ?""",
        (match, limit),
    ).fetchall()


def get(conn: sqlite3.Connection, record_id: int) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM records WHERE id = ?", (record_id,)).fetchone()
