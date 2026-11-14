"""Общий формат записи: всё, что знает база, приходит в таком виде из любого источника."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Record:
    source: str          # откуда: "claude_code", позже "migaku", "github"…
    external_id: str     # идентификатор внутри источника; пара (source, external_id) уникальна
    title: str
    body: str            # очищенный текст, по нему идёт поиск
    updated_at: str      # ISO-время последнего изменения
    project: str | None = None
