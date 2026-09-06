from __future__ import annotations

import shutil
import sys
import tempfile
import uuid
import zipfile
from pathlib import Path

from .bb_schema import sanitize_filename, write_cfg, write_placeholder_png
from .osu_parser import find_4k_maps, parse_osu


def lane_note(note, offset_seconds: float = 0.0) -> dict:
    """convert an osu note into a bb note"""
    result = {
        "input_type": note.lane,
        "note_modifier": 0,
        "timestamp": round(
            note.time_ms / 1000.0 + offset_seconds,
            6,
        ),
    }

    if note.is_hold:
        # UNCONFIRMED: no real example with hold notes has been seen yet.
        # note_modifier=3 and the "hold_end_timestamp" key are a guess, not
        # verified against the actual game schema. If holds misbehave
        # in-game, this is the first place to check. See convert_osz(),
        # which prints a warning whenever a map with holds is converted.
        result["note_modifier"] = 3
        result["hold_end_timestamp"] = round(
            note.end_ms / 1000.0 + offset_seconds,
            6,
        )

    return result


def _build_chart(osu_path: Path, icon_name: str, rating: int) -> dict:
    """Shared chart-building logic, used both by convert_map() (kept for
    callers/tests that use it directly) and convert_osz(), so the two can't
    drift out of sync with each other."""
    osu_map = parse_osu(osu_path)
    notes = [lane_note(note) for note in osu_map.notes]
    chart = {
        "icon": icon_name,
        "name": osu_map.version,
        "notes": notes,
        "rating": rating,
    }
    return osu_map, chart


def convert_map(
    osu_path: Path,
    output_root: Path,
    icon_name: str,
    rating: int,
) -> dict:
    """convert osu map into a bb chart"""
    osu_map, chart = _build_chart(osu_path, icon_name, rating)
    return {
        "osu_map": osu_map,
        "chart": chart,
    }


def zip_directory(source: Path, output_zip: Path, arcname_prefix: str | None = None) -> None:
    """ZIP bb object.

    arcname_prefix wraps every entry in a named top-level folder inside the
    zip (e.g. "My Mod/act.cfg" instead of just "act.cfg"), matching the
    structure a real game-exported mod ships with.
    """
    output_zip.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(
        output_zip,
        "w",
        compression=zipfile.ZIP_DEFLATED,
    ) as zf:
        for path in sorted(source.rglob("*")):
            if path.is_file():
                rel = path.relative_to(source)
                arcname = f"{arcname_prefix}/{rel}" if arcname_prefix else rel
                zf.write(path, arcname)


def _safe_extract(zf: zipfile.ZipFile, dest: Path) -> None:
    """Guard against zip-slip: a crafted .osz could contain member paths like
    '../../etc/passwd' or an absolute path, which zipfile.extractall() does
    not reliably block on every Python version. Validate every member stays
    inside dest before extracting anything."""
    dest = dest.resolve()
    for member in zf.namelist():
        target = (dest / member).resolve()
        if not str(target).startswith(str(dest)):
            raise ValueError(
                f"Refusing to extract unsafe path from archive: {member!r}"
            )
    zf.extractall(dest)


def _find_background(osz_dir: Path, images_dir: Path, declared_name: str | None) -> str | None:
    """Prefer the background the .osu file actually declares (from
    [Events]). Only fall back to "guess from whatever image exists" if that
    lookup fails — guessing first was the bug: real .osz archives bundle
    skin/UI images (approach circles, hit bursts, key graphics) that
    alphabetically outrank the real background and would get picked
    instead.
    """
    images_dir.mkdir(parents=True, exist_ok=True)

    if declared_name:
        candidate = osz_dir / declared_name
        if not candidate.exists():
            # case-insensitive / nested-folder fallback
            target_lower = declared_name.lower()
            for p in osz_dir.rglob("*"):
                if p.is_file() and (p.name.lower() == target_lower or str(p.relative_to(osz_dir)).lower() == target_lower.replace("\\", "/")):
                    candidate = p
                    break
        if candidate.exists():
            destination = images_dir / f"BG{candidate.suffix.lower()}"
            shutil.copy2(candidate, destination)
            return destination.name
        print(
            f"WARNING: background '{declared_name}' declared in the .osu file "
            f"was not found in the archive; falling back to a heuristic guess.",
            file=sys.stderr,
        )

    candidates: list[Path] = []
    for pattern in ("*.jpg", "*.jpeg", "*.png", "*.webp"):
        candidates.extend(osz_dir.glob(pattern))
    if not candidates:
        return None
    source = sorted(candidates)[0]
    destination = images_dir / f"BG{source.suffix.lower()}"
    shutil.copy2(source, destination)
    return destination.name


def _find_audio(osz_dir: Path, filename: str | None) -> Path | None:
    if filename:
        referenced = osz_dir / filename
        if referenced.exists():
            return referenced
        # case-insensitive / nested-folder fallback — .osz archives are
        # usually flat, but declared filenames sometimes mismatch case
        # against what's actually on disk once extracted.
        target_lower = filename.lower()
        for p in osz_dir.rglob("*"):
            if p.is_file() and p.name.lower() == target_lower:
                return p

    candidates: list[Path] = []
    for pattern in ("*.mp3", "*.ogg", "*.wav"):
        candidates.extend(osz_dir.rglob(pattern))
    if not candidates:
        return None
    return sorted(candidates)[0]


def convert_osz(
    osz_path: str | Path,
    output_zip: str | Path,
) -> Path:
    osz_path = Path(osz_path)
    output_zip = Path(output_zip)

    if not osz_path.exists():
        raise FileNotFoundError(
            f"osz file not found: {osz_path}"
        )

    with tempfile.TemporaryDirectory(prefix="osu2bb-") as td:
        work = Path(td)
        osz_dir = work / "osz"

        try:
            with zipfile.ZipFile(osz_path, "r") as zf:
                _safe_extract(zf, osz_dir)
        except zipfile.BadZipFile as e:
            raise ValueError(f"'{osz_path.name}' is not a valid .osz/.zip file: {e}") from e

        maps = find_4k_maps(osz_dir)

        if not maps:
            raise ValueError(
                "No osu!mania 4K (.osu) maps were found."
            )

        first = parse_osu(maps[0])

        # bb map directory tree
        #   mod/
        #       act.cfg
        #       thumb.png
        #       default/
        #           audio/
        #           config/
        #           images/

        mod_name = sanitize_filename(first.title or osz_path.stem)
        mod_root = work / mod_name
        level = mod_root / "default"

        audio_dir = level / "audio"
        config_dir = level / "config"
        images_dir = level / "images"
        video_dir = level / "video"

        audio_dir.mkdir(parents=True, exist_ok=True)
        config_dir.mkdir(parents=True, exist_ok=True)
        images_dir.mkdir(parents=True, exist_ok=True)
        video_dir.mkdir(parents=True, exist_ok=True)

        charts = []
        any_holds = False

        for index, map_path in enumerate(maps):
            parsed, chart = _build_chart(map_path, f"icon{index}.png", index)
            charts.append(chart)
            any_holds = any_holds or any(n.is_hold for n in parsed.notes)
            write_placeholder_png(images_dir / f"icon{index}.png", size=32)

        if any_holds:
            print(
                "WARNING: this map contains hold notes. Their on-disk format "
                "(note_modifier=3 + hold_end_timestamp) is NOT confirmed "
                "against a real Beat Banger example — verify holds actually "
                "work in-game before trusting this output.",
                file=sys.stderr,
            )

        write_cfg(
            config_dir / "notes.cfg",
            {"charts": charts},
        )

        audio_src = _find_audio(osz_dir, first.audio_filename)
        if audio_src is None:
            raise ValueError(
                "Could not find an audio file in the osu! mapset."
            )

        audio_filename = audio_src.name
        shutil.copy2(audio_src, audio_dir / audio_filename)

        write_cfg(
            config_dir / "asset.cfg",
            {
                "horny_mode_sound": "",
                "song_path": audio_filename,
            },
        )

        bpm = first.bpm
        if bpm is None:
            raise ValueError(
                f"{maps[0].name}: no valid uninherited timing point found — "
                f"cannot determine BPM. Refusing to fall back to a fake "
                f"default, since a wrong BPM would silently desync every "
                f"note in the chart."
            )

        distinct_bpms = {
            round(60000.0 / tp.beat_length_ms, 2)
            for tp in first.timing_points
            if not tp.inherited and tp.beat_length_ms > 0
        }
        if len(distinct_bpms) > 1:
            raise ValueError(
                f"{maps[0].name}: map has {len(distinct_bpms)} different BPM "
                f"values {sorted(distinct_bpms)} across its uninherited "
                f"timing points. This converter does not support BPM "
                f"changes — the target format has no equivalent, and using "
                f"only the first BPM would silently desync notes over the "
                f"length of the map."
            )

        background_name = _find_background(osz_dir, images_dir, first.background_filename)

        write_cfg(
            config_dir / "keyframes.cfg",
            {
                "background": (
                    [{"path": background_name, "timestamp": 0.0}] if background_name else []
                ),
                "effects": [],
                "loops": [],
                "modifiers": [
                    {
                        "bpm": round(bpm, 6),
                        "timestamp": 0.0,
                    }
                ],
                "shutter": [],
                "sound_loop": [],
                "sound_oneshot": [],
                "voice_bank": [],
            },
        )

        act_id = uuid.uuid4().hex
        level_id = uuid.uuid4().hex

        # metadata
        write_cfg(
            config_dir / "meta.cfg",
            {
                "character": "Default",
                "color": [0.5, 0.5, 0.5],
                "level_id": level_id,
                "level_index": 0,
                "level_name": mod_name,
            },
        )

        write_cfg(
            config_dir / "mod.cfg",
            {
                "description": (
                    f"Converted from osu!mania: {mod_name}"
                ),
                "preview_timestamp": 0.0,
                "song_creator": first.artist,
                "song_title": first.title,
            },
        )

        # NOTE: song_offset is left at 0.0 deliberately, not by omission.
        # notes.cfg timestamps are the raw absolute .osu hit-object times
        # (see lane_note() above), so note-hit accuracy does not depend on
        # this field. It may only affect BPM-driven visual/animation sync,
        # if the game has any — that's unconfirmed, so this isn't "fixed"
        # to a nonzero value without evidence it should be.
        write_cfg(
            config_dir / "settings.cfg",
            {
                "post_song_delay": 5.0,
                "song_offset": 0.0,
            },
        )

        write_cfg(
            level / "editor_cache.cfg",
            {
                "audio_path": audio_filename,
            },
        )

        write_cfg(
            mod_root / "act.cfg",
            {
                "act_description": (
                    f"Converted osu!mania map: {mod_name}"
                ),
                "act_id": act_id,
                "act_index": 0,
                "act_name": mod_name,
                "author": first.creator,
            },
        )

        # Real, valid, non-empty placeholder images — a 0-byte file where an
        # image is expected is a plausible reason a level fails to load.
        write_placeholder_png(mod_root / "thumb.png", size=128)
        write_placeholder_png(level / "splash.png", size=256)
        write_placeholder_png(level / "thumb.png", size=128)
        write_placeholder_png(level / "waveform.png", size=64)

        # Wrap the zip's contents in a folder named after the mod, matching
        # the structure a real game-exported mod ships with.
        zip_directory(mod_root, output_zip, arcname_prefix=mod_name)

    return output_zip
