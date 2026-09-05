from __future__ import annotations

import shutil
import tempfile
import zipfile
from pathlib import Path

from .bb_schema import write_cfg
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
        result["note_modifier"] = 3
        result["hold_end_timestamp"] = round(
            note.end_ms / 1000.0 + offset_seconds,
            6,
        )

    return result


def convert_map(
    osu_path: Path,
    output_root: Path,
    icon_name: str,
    rating: int,
) -> dict:
    """convert osu map into a bb chart"""
    osu_map = parse_osu(osu_path)

    notes = [lane_note(note) for note in osu_map.notes]

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


def zip_directory(source: Path, output_zip: Path) -> None:
    """ZIP bb object"""
    output_zip.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(
        output_zip,
        "w",
        compression=zipfile.ZIP_DEFLATED,
    ) as zf:
        for path in sorted(source.rglob("*")):
            if path.is_file():
                zf.write(
                    path,
                    path.relative_to(source),
                )


def _write_placeholder_file(path: Path) -> None:
    """bb expects a file"""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.touch()


def _copy_first_image(
    osz_dir: Path,
    images_dir: Path,
) -> str | None:
    """bg img"""
    candidates: list[Path] = []

    for pattern in (
        "*.jpg",
        "*.jpeg",
        "*.png",
        "*.webp",
    ):
        candidates.extend(osz_dir.glob(pattern))

    if not candidates:
        return None

    source = sorted(candidates)[0]
    destination = images_dir / f"BG{source.suffix.lower()}"

    images_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)

    return destination.name


def _find_audio(osz_dir: Path, filename: str | None) -> Path | None:
    if filename:
        referenced = osz_dir / filename
        if referenced.exists():
            return referenced

    candidates: list[Path] = []

    for pattern in (
        "*.mp3",
        "*.ogg",
        "*.wav",
    ):
        candidates.extend(osz_dir.glob(pattern))

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

        with zipfile.ZipFile(osz_path, "r") as zf:
            zf.extractall(osz_dir)

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

        mod_name = first.title or osz_path.stem
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

        for index, map_path in enumerate(maps):
            parsed = parse_osu(map_path)

            chart = {
                "icon": f"icon{index}.png",
                "name": parsed.version,
                "notes": [
                    lane_note(note)
                    for note in parsed.notes
                ],
                "rating": index,
            }

            charts.append(chart)

            _write_placeholder_file(
                images_dir / f"icon{index}.png"
            )

        write_cfg(
            config_dir / "notes.cfg",
            {
                "charts": charts,
            },
        )

        audio_src = _find_audio(
            osz_dir,
            first.audio_filename,
        )

        if audio_src is None:
            raise ValueError(
                "Could not find an audio file in the osu! mapset."
            )

        audio_filename = audio_src.name
        audio_dst = audio_dir / audio_filename

        shutil.copy2(
            audio_src,
            audio_dst,
        )

        write_cfg(
            config_dir / "asset.cfg",
            {
                "horny_mode_sound": "",
                "song_path": audio_filename,
            },
        )


        bpm = first.bpm or 120.0

        write_cfg(
            config_dir / "keyframes.cfg",
            {
                "background": [],
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


        # metadata
        write_cfg(
            config_dir / "meta.cfg",
            {
                "character": "Default",
                "color": [0.5, 0.5, 0.5],
                "level_id": "osu2beatbanger",
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

        write_cfg(
            config_dir / "settings.cfg",
            {
                "post_song_delay": 5.0,
                "song_offset": 0.0,
            },
        )


        background_name = _copy_first_image(
            osz_dir,
            images_dir,
        )

        if background_name:
            write_cfg(
                config_dir / "keyframes.cfg",
                {
                    "background": [
                        {
                            "path": background_name,
                            "timestamp": 0.0,
                        }
                    ],
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
                "act_id": "osu2beatbanger",
                "act_index": 0,
                "act_name": mod_name,
                "author": first.artist,
            },
        )


        _write_placeholder_file(
            mod_root / "thumb.png"
        )

        _write_placeholder_file(
            level / "splash.png"
        )

        _write_placeholder_file(
            level / "thumb.png"
        )

        _write_placeholder_file(
            level / "waveform.png"
        )


        zip_directory(
            mod_root,
            output_zip,
        )

    return output_zip