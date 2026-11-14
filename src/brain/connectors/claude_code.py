"""Коннектор Claude Code: сессии из ~/.claude/projects/<папка>/<session>.jsonl.

Каждая строка JSONL — событие. Нам нужны только реплики человека и текст ответов:
служебные события (attachment, system, …), вывод инструментов и рассуждения модели отбрасываем.
Подагенты лежат в подпапке <session>/subagents/ — это побочные ветки, их не берём.
"""
from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path

from ..records import Record

SOURCE = "claude_code"
DEFAULT_ROOT = Path.home() / ".claude" / "projects"


def session_files(root: Path = DEFAULT_ROOT) -> Iterator[Path]:
    # glob("*/*.jsonl") — ровно один уровень вложенности, поэтому subagents/ сюда не попадают.
    yield from sorted(root.glob("*/*.jsonl"))


def _text(content) -> str:
    """Текст сообщения: строка или список блоков, из которых берём только блоки type=text."""
    if isinstance(content, str):
        return content
    return "\n".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text")


def _events(path: Path) -> Iterator[dict]:
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            yield json.loads(line)
        except json.JSONDecodeError:
            continue  # файл могут дописывать прямо сейчас — последняя строка бывает обрезана


def parse(paths: list[Path]) -> Record | None:
    """Одна сессия может лежать в нескольких файлах: если в разговоре сменилась рабочая папка,
    Claude Code продолжает ту же сессию (тот же id) в папке нового проекта — и копирует туда
    всю прежнюю историю. Поэтому склеиваем файлы от старого к новому и выкидываем повторы по uuid
    события: остаётся первая копия, с исходной рабочей папкой."""
    seen: set[str] = set()
    events: list[dict] = []
    for p in sorted(paths, key=lambda p: p.stat().st_mtime):
        for e in _events(p):
            uid = e.get("uuid")
            if uid and uid in seen:
                continue
            seen.add(uid)
            events.append(e)
    events.sort(key=lambda e: e.get("timestamp", ""))
    turns: list[str] = []
    first_user = ""
    project = None
    last_ts = ""
    for event in events:
        kind = event.get("type")
        if kind not in ("user", "assistant") or event.get("isSidechain") or event.get("isMeta"):
            continue
        text = _text(event.get("message", {}).get("content", "")).strip()
        if not text:
            continue  # например, сообщение user, в котором только tool_result
        if kind == "user" and not first_user:
            first_user = text
        project = project or event.get("cwd")
        last_ts = event.get("timestamp", last_ts)
        turns.append(f"{'Я' if kind == 'user' else 'Claude'}: {text}")
    if not turns:
        return None
    return Record(
        source=SOURCE,
        external_id=paths[0].stem,  # имя файла — это id сессии
        title=first_user.splitlines()[0][:100],
        body="\n\n".join(turns),
        updated_at=last_ts,
        project=project,
    )


def fetch(root: Path = DEFAULT_ROOT) -> Iterator[Record]:
    sessions: dict[str, list[Path]] = {}
    for path in session_files(root):
        sessions.setdefault(path.stem, []).append(path)
    for paths in sessions.values():
        record = parse(paths)
        if record:
            yield record
