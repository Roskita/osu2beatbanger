from __future__ import annotations

import re
from pathlib import Path

from .model import Note, OsuMap, TimingPoint


def _section(text: str, name: str) -> list[str]:
    marker = f"[{name}]"
    start = text.find(marker)
    if start < 0:
        return []
    start = text.find("\n", start)
    if start < 0:
        return []
    end = text.find("\n[", start + 1)
    if end < 0:
        end = len(text)
    return [
        line.strip()
        for line in text[start:end].splitlines()
        if line.strip() and not line.lstrip().startswith("//")
    ]


def _kv(lines: list[str]) -> dict[str, str]:
    result = {}
    for line in lines:
        if ":" in line:
            k, v = line.split(":", 1)
            result[k.strip()] = v.strip()
    return result


def parse_osu(path: str | Path) -> OsuMap:
    path = Path(path)
    text = path.read_text(encoding="utf-8-sig", errors="replace")

    general = _kv(_section(text, "General"))
    metadata = _kv(_section(text, "Metadata"))
    difficulty = _kv(_section(text, "Difficulty"))

    mode = int(general.get("Mode", "0"))
    columns = int(difficulty.get("CircleSize", "4"))

    if mode != 3:
        raise ValueError(f"{path.name}: not an osu!mania map (Mode: {mode})")
    if columns != 4:
        raise ValueError(
            f"{path.name}: expected 4K mania, found CircleSize={columns}"
        )

    timing_points = []
    for line in _section(text, "TimingPoints"):
        parts = [x.strip() for x in line.split(",")]
        if len(parts) < 2:
            continue
        try:
            time_ms = float(parts[0])
            beat_length = float(parts[1])
            # Uninherited timing points have positive beat length.
            inherited = beat_length < 0
            timing_points.append(
                TimingPoint(time_ms, abs(beat_length), inherited)
            )
        except ValueError:
            continue

    notes = []
    for line in _section(text, "HitObjects"):
        parts = line.split(",")
        if len(parts) < 5:
            continue

        try:
            x = int(parts[0])
            time_ms = float(parts[2])
            object_type = int(parts[3])
        except ValueError:
            continue

        lane = min(3, max(0, int(x / (512 / 4))))

        # Mania hold: type bit 7 (128) is set. The end time is before the
        # first colon in the fifth/parameter field.
        end_ms = None
        if object_type & 128:
            if len(parts) >= 6:
                tail = parts[5]
            else:
                tail = parts[4]
            end_token = tail.split(":", 1)[0]
            try:
                end_ms = float(end_token)
            except ValueError:
                end_ms = None

        notes.append(Note(lane=lane, time_ms=time_ms, end_ms=end_ms))

    notes.sort(key=lambda n: (n.time_ms, n.lane))

    return OsuMap(
        path=str(path),
        title=metadata.get("Title", path.stem),
        artist=metadata.get("Artist", "Unknown Artist"),
        version=metadata.get("Version", path.stem),
        audio_filename=general.get("AudioFilename"),
        mode=mode,
        columns=columns,
        timing_points=timing_points,
        notes=notes,
    )


def find_4k_maps(extracted_dir: str | Path) -> list[Path]:
    extracted_dir = Path(extracted_dir)
    result = []
    for path in extracted_dir.rglob("*.osu"):
        try:
            text = path.read_text(encoding="utf-8-sig", errors="replace")
        except OSError:
            continue
        general = _kv(_section(text, "General"))
        difficulty = _kv(_section(text, "Difficulty"))
        if general.get("Mode") == "3" and difficulty.get("CircleSize") == "4":
            result.append(path)
    return sorted(result)
