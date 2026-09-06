from __future__ import annotations

from pathlib import Path

from .bb_schema import load_cfg_data
from .model import BBChart, BBLevel, Note


def find_act_cfg(mod_root: Path) -> Path:
    """act.cfg lives directly at the mod's root, per the confirmed real
    template. Fall back to a search if handed a folder that isn't quite the
    root (e.g. the parent of an extracted zip)."""
    direct = mod_root / "act.cfg"
    if direct.exists():
        return direct
    found = sorted(mod_root.rglob("act.cfg"))
    if not found:
        raise ValueError(f"No act.cfg found under {mod_root} — is this a Beat Banger mod?")
    return found[0]


def find_levels(mod_root: Path) -> list[Path]:
    """A level is any folder containing config/notes.cfg. A mod can contain
    more than one (multiple acts/levels bundled together); each becomes its
    own .osz on the way back out, since each may be a different song."""
    return sorted({p.parent.parent for p in mod_root.rglob("config/notes.cfg")})


def _resolve_asset(level_dir: Path, subfolder: str, filename: str | None) -> Path | None:
    """song_path / background path are bare filenames (confirmed convention:
    the engine resolves them by asset-type subfolder). Mirror that here,
    with a case-insensitive fallback since we're reading files that may have
    been produced by something other than this same tool."""
    if not filename:
        return None
    direct = level_dir / subfolder / filename
    if direct.exists():
        return direct
    target_lower = filename.lower()
    search_dir = level_dir / subfolder
    if search_dir.exists():
        for p in search_dir.rglob("*"):
            if p.is_file() and p.name.lower() == target_lower:
                return p
    return None


def _note_from_dict(d: dict) -> Note:
    lane = int(d.get("input_type", 0))
    timestamp = float(d.get("timestamp", 0.0))
    time_ms = timestamp * 1000.0

    end_ms = None
    # NOTE: note_modifier==3 + "hold_end_timestamp" is this project's own
    # convention for holds (see osu_to_bb.py), not a confirmed real Beat
    # Banger format. Reading it back is safe for round-tripping our own
    # output; a real hand-charted mod with holds may use a different shape,
    # in which case this just falls back to reading the note as a tap
    # rather than crashing.
    if d.get("note_modifier") == 3 and "hold_end_timestamp" in d:
        try:
            end_ms = float(d["hold_end_timestamp"]) * 1000.0
        except (TypeError, ValueError):
            end_ms = None

    return Note(lane=lane, time_ms=time_ms, end_ms=end_ms)


def parse_bb_level(level_dir: Path, act_data: dict) -> BBLevel:
    config = level_dir / "config"
    for required in ("asset.cfg", "settings.cfg", "meta.cfg", "mod.cfg", "keyframes.cfg", "notes.cfg"):
        if not (config / required).exists():
            raise ValueError(f"{level_dir}: missing config/{required}")

    asset = load_cfg_data(config / "asset.cfg")
    settings = load_cfg_data(config / "settings.cfg")
    mod_cfg = load_cfg_data(config / "mod.cfg")
    keyframes = load_cfg_data(config / "keyframes.cfg")
    notes_cfg = load_cfg_data(config / "notes.cfg")

    modifiers = keyframes.get("modifiers") or []
    if not modifiers or "bpm" not in modifiers[0]:
        raise ValueError(f"{level_dir}: no BPM found in keyframes.cfg 'modifiers'")
    bpm = float(modifiers[0]["bpm"])

    song_path = asset.get("song_path")
    audio_path = _resolve_asset(level_dir, "audio", song_path)
    if audio_path is None:
        raise ValueError(f"{level_dir}: song_path '{song_path}' not found under audio/")

    background_path = None
    bg_entries = keyframes.get("background") or []
    if bg_entries and bg_entries[0].get("path"):
        background_path = _resolve_asset(level_dir, "images", bg_entries[0]["path"])

    charts_raw = notes_cfg.get("charts") or []
    if not charts_raw:
        raise ValueError(f"{level_dir}: notes.cfg has no charts")

    charts = [
        BBChart(
            name=c.get("name", "Normal"),
            rating=int(c.get("rating", 0)),
            icon=c.get("icon", "icon0.png"),
            notes=[_note_from_dict(n) for n in c.get("notes", [])],
        )
        for c in charts_raw
    ]

    return BBLevel(
        level_dir=level_dir,
        act_name=act_data.get("act_name", level_dir.name),
        author=act_data.get("author", "Unknown"),
        description=act_data.get("act_description", ""),
        song_creator=mod_cfg.get("song_creator", "Unknown Artist"),
        song_title=mod_cfg.get("song_title", level_dir.name),
        bpm=bpm,
        song_offset=float(settings.get("song_offset", 0.0)),
        audio_path=audio_path,
        background_path=background_path,
        charts=charts,
    )


def parse_bb_mod(mod_root: Path) -> list[BBLevel]:
    act_data = load_cfg_data(find_act_cfg(mod_root))
    levels = find_levels(mod_root)
    if not levels:
        raise ValueError(f"No level (config/notes.cfg) found under {mod_root}")
    return [parse_bb_level(level_dir, act_data) for level_dir in levels]
