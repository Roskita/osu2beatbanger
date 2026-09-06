from __future__ import annotations

import json
import re
import struct
import zlib
from pathlib import Path
from typing import Any

_ILLEGAL_PATH_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def sanitize_filename(name: str, fallback: str = "Converted Map") -> str:
    """Make a string safe to use as a path component. Song titles routinely
    contain '/', ':', '"', etc. which would otherwise be silently
    interpreted as path separators or rejected by the filesystem."""
    cleaned = _ILLEGAL_PATH_CHARS.sub("_", name).strip().strip(".")
    # A name that was entirely illegal characters (e.g. "///") sanitizes to
    # something like "___" -- non-empty, but no real content survived, so
    # this should fall back the same as a truly empty input would.
    if not cleaned or not cleaned.strip("_"):
        return fallback
    return cleaned


def write_placeholder_png(path: Path, size: int = 64, color: tuple[int, int, int] = (40, 40, 40)) -> None:
    """Write a real, valid, solid-color PNG — not an empty file. Beat Banger
    (and most image loaders) will choke on a 0-byte file where an image is
    expected; a tiny valid PNG is a safe stand-in until real art is added.
    No external imaging library required (pure stdlib zlib/struct).
    """
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

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)  # 8-bit RGB
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", compressed)
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)


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
