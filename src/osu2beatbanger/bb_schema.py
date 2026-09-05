from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def cfg_data(data: dict[str, Any]) -> str:
    # Beat Banger ConfigFile-compatible shape used by the supplied template.
    return "[main]\n\ndata=" + json.dumps(data, indent=2, ensure_ascii=False) + "\n"


def write_cfg(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(cfg_data(data), encoding="utf-8")


def load_cfg_data(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    marker = "data="
    idx = text.find(marker)
    if idx < 0:
        raise ValueError(f"{path} does not contain a [main] data= value")
    raw = text[idx + len(marker):].strip()
    return json.loads(raw)


def serialize_notes_chart(name: str, rating: int, notes: list[dict[str, Any]],
                          icon: str = "icon0.png") -> dict[str, Any]:
    return {
        "icon": icon,
        "name": name,
        "notes": notes,
        "rating": rating,
    }
