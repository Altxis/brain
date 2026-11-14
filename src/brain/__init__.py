"""brain — личная память для Claude: собрать → сохранить → найти → отдать агенту."""
from __future__ import annotations

import argparse

from . import db
from .connectors import claude_code


def cmd_sync(args) -> None:
    with db.connect() as conn:
        n = 0
        for record in claude_code.fetch():
            db.upsert(conn, record)
            n += 1
    print(f"claude_code: {n} сессий в базе")


def cmd_search(args) -> None:
    with db.connect() as conn:
        rows = db.search(conn, args.query, args.limit)
    for r in rows:
        print(f"#{r['id']}  {r['updated_at'][:10]}  {r['title']}\n    {r['snippet']}\n")
    if not rows:
        print("ничего не нашлось")


def cmd_show(args) -> None:
    with db.connect() as conn:
        row = db.get(conn, args.id)
    print(row["body"] if row else f"нет записи {args.id}")


def cmd_mcp(args) -> None:
    from .mcp_server import run  # SDK грузим только когда нужен сервер
    run()


def main() -> None:
    p = argparse.ArgumentParser(prog="brain")
    sub = p.add_subparsers(required=True)
    sub.add_parser("sync", help="забрать сессии в базу").set_defaults(func=cmd_sync)
    s = sub.add_parser("search", help="поиск")
    s.add_argument("query")
    s.add_argument("-n", "--limit", type=int, default=5)
    s.set_defaults(func=cmd_search)
    s = sub.add_parser("show", help="запись целиком")
    s.add_argument("id", type=int)
    s.set_defaults(func=cmd_show)
    sub.add_parser("mcp", help="MCP-сервер для Claude (stdio)").set_defaults(func=cmd_mcp)
    args = p.parse_args()
    args.func(args)
