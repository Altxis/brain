"""Сквозной тест «нити»: JSONL-сессия → запись → база → поиск."""
import json

from brain import db
from brain.connectors import claude_code


def write_session(root, name="abc123"):
    events = [
        {"type": "user", "cwd": "/w/proj", "timestamp": "2026-11-01T10:00:00Z",
         "message": {"content": "Как выгрузить слова из Migaku?"}},
        {"type": "assistant", "timestamp": "2026-11-01T10:00:05Z",
         "message": {"content": [{"type": "thinking", "thinking": "скрыто"},
                                 {"type": "text", "text": "Через расширение Word Exporter."}]}},
        {"type": "user", "timestamp": "2026-11-01T10:00:06Z",
         "message": {"content": [{"type": "tool_result", "content": "вывод инструмента"}]}},
        {"type": "attachment", "timestamp": "2026-11-01T10:00:07Z"},
    ]
    d = root / "-w-proj"
    d.mkdir(parents=True)
    (d / f"{name}.jsonl").write_text("\n".join(json.dumps(e, ensure_ascii=False) for e in events) + "\n{обрезано")
    sub = d / name / "subagents"
    sub.mkdir(parents=True)
    (sub / "agent-1.jsonl").write_text(json.dumps(events[0]))


def test_parse_keeps_only_dialogue(tmp_path):
    write_session(tmp_path)
    [record] = list(claude_code.fetch(tmp_path))  # подагент не попал
    assert record.external_id == "abc123"
    assert record.title == "Как выгрузить слова из Migaku?"
    assert record.project == "/w/proj"
    assert "Word Exporter" in record.body
    assert "скрыто" not in record.body and "вывод инструмента" not in record.body


def test_sync_is_idempotent_and_searchable(tmp_path):
    write_session(tmp_path / "projects")
    conn = db.connect(tmp_path / "brain.db")
    for _ in range(2):
        for r in claude_code.fetch(tmp_path / "projects"):
            db.upsert(conn, r)
    assert conn.execute("SELECT count(*) FROM records").fetchone()[0] == 1
    assert conn.execute("SELECT count(*) FROM records_fts").fetchone()[0] == 1
    [hit] = db.search(conn, "Exporter")
    assert hit["title"].startswith("Как выгрузить")


def test_session_split_across_project_dirs_is_merged(tmp_path):
    # Сессия началась в /w/a, потом сменилась папка — продолжение лежит в другой папке с тем же id.
    # Новый файл повторяет старую историю (те же uuid) и дописывает продолжение.
    first = {"type": "user", "uuid": "u1", "cwd": "/w/a", "timestamp": "2026-11-01T10:00:00Z",
             "message": {"content": "начало в проекте A"}}
    copy = dict(first, cwd="/w/b")
    nxt = {"type": "user", "uuid": "u2", "cwd": "/w/b", "timestamp": "2026-11-02T10:00:00Z",
           "message": {"content": "продолжение в проекте B"}}
    for folder, events in [("-w-a", [first]), ("-w-b", [copy, nxt])]:
        d = tmp_path / folder
        d.mkdir()
        (d / "same-id.jsonl").write_text("\n".join(json.dumps(e, ensure_ascii=False) for e in events))
    [record] = list(claude_code.fetch(tmp_path))
    assert record.body.count("начало") == 1
    assert record.body.index("начало") < record.body.index("продолжение")
    assert record.project == "/w/a"
    assert record.updated_at.startswith("2026-11-02")
