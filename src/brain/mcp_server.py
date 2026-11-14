"""MCP-сервер: даёт Claude два инструмента — искать в базе и читать запись целиком.

Протокол (JSON-RPC по stdin/stdout) целиком берёт на себя официальный SDK:
мы только описываем функции, а схему параметров он строит из аннотаций типов.
"""
from __future__ import annotations

from mcp.server.mcpserver import MCPServer
from mcp_types import ToolAnnotations

from . import db

READ_ONLY = ToolAnnotations(read_only_hint=True)
CHUNK = 20_000

server = MCPServer("brain", instructions="Память прошлых разговоров пользователя с Claude Code.")


@server.tool(annotations=READ_ONLY)
def search(query: str, limit: int = 5) -> list[dict]:
    """Поиск по прошлым разговорам пользователя с Claude Code.
    Возвращает id, заголовок, проект, дату и фрагмент с совпадением. Целиком — через get_record."""
    with db.connect() as conn:
        return [dict(row) for row in db.search(conn, query, limit)]


@server.tool(annotations=READ_ONLY)
def get_record(id: int, offset: int = 0) -> dict:
    """Запись целиком по id из search. Длинный текст отдаётся кусками: для продолжения передай next_offset."""
    with db.connect() as conn:
        row = db.get(conn, id)
    if row is None:
        return {"error": f"нет записи {id}"}
    body = row["body"]
    end = offset + CHUNK
    return {
        "id": row["id"], "title": row["title"], "project": row["project"], "updated_at": row["updated_at"],
        "body": body[offset:end],
        "next_offset": end if end < len(body) else None,
    }


def run() -> None:
    server.run("stdio")
