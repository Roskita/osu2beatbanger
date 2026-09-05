from __future__ import annotations

import shutil
import tempfile
import zipfile
from pathlib import Path

from .bb_schema import write_cfg
from .osu_parser import find_4k_maps, parse_osu


def lane_note(note, offset_seconds: float = 0.0) -> dict:
    result = {
        "input_type": note.lane,
        "note_modifier": 0,
        "timestamp": round(note.time_ms / 1000.0 + offset_seconds, 6),
    }
    if note.is_hold:
        # Placeholder target representation. This is intentionally isolated
        # here so the hold schema can be changed after testing against a
        # known-good Beat Banger hold chart.
        result["note_modifier"] = 3
        result["hold_end_timestamp"] = round(
            note.end_ms / 1000.0 + offset_seconds, 6
        )
    return result


def convert_map(osu_path: Path, output_root: Path, icon_name: str,
                rating: int) -> dict:
    osu_map = parse_osu(osu_path)

    notes = [lane_note(n) for n in osu_map.notes]

    chart = {
        "icon": icon_name,
        "name": osu_map.version,
        "notes": notes,
        "rating": rating,
    }

    return {
        "osu_map": osu_map,
        "chart": chart,
    }


def copy_template(template_zip: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(template_zip, "r") as zf:
        zf.extractall(destination)


def zip_directory(source: Path, output_zip: Path) -> None:
    output_zip.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output_zip, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(source.rglob("*")):
            if path.is_file():
                zf.write(path, path.relative_to(source))


def convert_osz(osz_path: str | Path, template_zip: str | Path,
                output_zip: str | Path) -> Path:
    osz_path = Path(osz_path)
    template_zip = Path(template_zip)
    output_zip = Path(output_zip)

    with tempfile.TemporaryDirectory(prefix="osu2bb-") as td:
        work = Path(td)
        osz_dir = work / "osz"
        template_dir = work / "mod"

        with zipfile.ZipFile(osz_path, "r") as zf:
            zf.extractall(osz_dir)

        maps = find_4k_maps(osz_dir)
        if not maps:
            raise ValueError("No osu!mania 4K (.osu) maps were found.")

        copy_template(template_zip, template_dir)

        # Discover the actual mod/level root from the template instead of
        # assuming a hard-coded package name.
        mod_dirs = [p for p in template_dir.iterdir() if p.is_dir()]
        if len(mod_dirs) != 1:
            raise ValueError("Template must contain exactly one top-level mod folder.")
        mod_root = mod_dirs[0]

        level_dirs = [p for p in mod_root.iterdir() if p.is_dir() and (p / "config").is_dir()]
        if len(level_dirs) != 1:
            raise ValueError("Template must contain exactly one level folder with config/.")
        level = level_dirs[0]
        config = level / "config"

        # Use the first map as the song metadata source.
        first = parse_osu(maps[0])

        # Build all charts into the template's existing notes.cfg schema.
        charts = []
        for index, map_path in enumerate(maps):
            parsed = parse_osu(map_path)
            rating = index
            notes = [lane_note(n) for n in parsed.notes]
            charts.append({
                "icon": f"icon{index}.png",
                "name": parsed.version,
                "notes": notes,
                "rating": rating,
            })

        write_cfg(config / "notes.cfg", {"charts": charts})

        # Preserve the template's fields while replacing song-specific data.
        asset = {
            "horny_mode_sound": "",
            "song_path": "audio/audio.mp3",
        }
        write_cfg(config / "asset.cfg", asset)

        bpm = first.bpm or 120.0
        write_cfg(config / "keyframes.cfg", {
            "background": [],
            "effects": [],
            "loops": [],
            "modifiers": [{"bpm": round(bpm, 6), "timestamp": 0.0}],
            "shutter": [],
            "sound_loop": [],
            "sound_oneshot": [],
            "voice_bank": [],
        })

        meta = {
            "character": "Default",
            "color": [0.5, 0.5, 0.5],
            "level_id": "osu2beatbanger",
            "level_index": 0,
            "level_name": first.title,
        }
        write_cfg(config / "meta.cfg", meta)

        write_cfg(config / "mod.cfg", {
            "description": f"Converted from osu!mania: {first.title}",
            "preview_timestamp": 0.0,
            "song_creator": first.artist,
            "song_title": first.title,
        })

        # Keep the template's song offset unless the caller later adds an
        # explicit timing calibration option.
        if (config / "settings.cfg").exists():
            settings = {
                "post_song_delay": 5.0,
                "song_offset": 0.0,
            }
            write_cfg(config / "settings.cfg", settings)

        # Copy audio. If the osu file points at an audio file, use it.
        audio_src = osz_dir / (first.audio_filename or "")
        if not audio_src.exists():
            candidates = list(osz_dir.glob("*.mp3")) + list(osz_dir.glob("*.ogg"))
            if candidates:
                audio_src = candidates[0]

        if audio_src.exists():
            audio_dst = level / "audio" / "audio" + audio_src.suffix.lower()
            audio_dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(audio_src, audio_dst)
            # asset.cfg must match the actual copied extension.
            write_cfg(config / "asset.cfg", {
                "horny_mode_sound": "",
                "song_path": audio_dst.relative_to(level).as_posix(),
            })

        # Background: copy the first common image into images/BG.ext.
        images = []
        for ext in ("*.jpg", "*.jpeg", "*.png", "*.webp"):
            images.extend(osz_dir.glob(ext))
        if images:
            bg_src = images[0]
            bg_dst = level / "images" / ("BG" + bg_src.suffix.lower())
            bg_dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(bg_src, bg_dst)

        # Update top-level act metadata but keep the template's act schema.
        act_path = mod_root / "act.cfg"
        write_cfg(mod_root / "act.cfg", {
            "act_description": f"Converted osu!mania map: {first.title}",
            "act_id": "osu2beatbanger",
            "act_index": 0,
            "act_name": first.title,
            "author": first.artist,
        })

        zip_directory(template_dir, output_zip)

    return output_zip
