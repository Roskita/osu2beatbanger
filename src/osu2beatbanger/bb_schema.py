from __future__ import annotations

import json
import re
import struct
import zlib
from pathlib import Path
from typing import Any

_ILLEGAL_PATH_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def sanitize_filename(name: str, fallback: str = "Converted Map") -> str:
    cleaned = _ILLEGAL_PATH_CHARS.sub("_", name).strip().strip(".")
    return cleaned or fallback


def write_placeholder_png(path: Path, size: int = 64, color: tuple[int, int, int] = (40, 40, 40)) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)

    width = height = size
    pixel = bytes(color)
    row = bytes([0]) + pixel * width  # one filter-type byte, then RGB per pixel
    raw = row * height
    compressed = zlib.compress(raw, 9)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", compressed)
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)


def cfg_data(data: dict[str, Any]) -> str:
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
