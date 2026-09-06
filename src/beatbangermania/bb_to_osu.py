from __future__ import annotations

import shutil
import tempfile
import zipfile
from pathlib import Path

from .bb_parser import parse_bb_mod
from .bb_schema import sanitize_filename
from .osu_writer import build_osu_text


def _safe_extract(zf: zipfile.ZipFile, dest: Path) -> None:
    dest = dest.resolve()
    for member in zf.namelist():
        target = (dest / member).resolve()
        if not str(target).startswith(str(dest)):
            raise ValueError(f"Refusing to extract unsafe path from archive: {member!r}")
    zf.extractall(dest)


def convert_bb_to_osz(
    mod_path: str | Path,
    output_dir: str | Path,
) -> list[Path]:
    """Convert a Beat Banger mod (folder or zip) back to one .osz per level
    found inside it. Returns the list of .osz paths written."""
    mod_path = Path(mod_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    if not mod_path.exists():
        raise FileNotFoundError(f"Mod path not found: {mod_path}")

    with tempfile.TemporaryDirectory(prefix="bb2osu-") as td:
        work = Path(td)

        if mod_path.is_dir():
            mod_root = mod_path
        else:
            try:
                with zipfile.ZipFile(mod_path, "r") as zf:
                    extract_dir = work / "mod"
                    _safe_extract(zf, extract_dir)
            except zipfile.BadZipFile as e:
                raise ValueError(f"'{mod_path.name}' is not a valid zip file: {e}") from e

            # a real mod zip wraps everything in one named folder; find it
            # rather than assuming a fixed depth.
            candidates = [p for p in extract_dir.rglob("act.cfg")]
            if not candidates:
                raise ValueError(f"No act.cfg found inside '{mod_path.name}'")
            mod_root = candidates[0].parent

        levels = parse_bb_mod(mod_root)

        outputs = []
        for level in levels:
            osz_work = work / f"osz_{level.level_dir.name}"
            osz_work.mkdir(parents=True, exist_ok=True)

            audio_dst = osz_work / level.audio_path.name
            shutil.copy2(level.audio_path, audio_dst)

            background_name = None
            if level.background_path is not None:
                background_name = level.background_path.name
                shutil.copy2(level.background_path, osz_work / background_name)

            for chart in level.charts:
                osu_text = build_osu_text(
                    title=level.song_title,
                    artist=level.song_creator,
                    creator=level.author,
                    version=chart.name,
                    audio_filename=audio_dst.name,
                    background_filename=background_name,
                    bpm=level.bpm,
                    offset_ms=0.0,  # bb notes.cfg timestamps are already absolute; see osu_to_bb.py
                    notes=chart.notes,
                )
                osu_filename = sanitize_filename(
                    f"{level.song_creator} - {level.song_title} [{chart.name}]",
                    fallback=f"{level.level_dir.name}_{chart.name}",
                ) + ".osu"
                (osz_work / osu_filename).write_text(osu_text, encoding="utf-8")

            osz_name = sanitize_filename(
                f"{level.song_creator} - {level.song_title}",
                fallback=level.level_dir.name,
            ) + ".osz"
            osz_path = output_dir / osz_name

            with zipfile.ZipFile(osz_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
                for path in sorted(osz_work.rglob("*")):
                    if path.is_file():
                        zf.write(path, path.relative_to(osz_work))

            outputs.append(osz_path)

        return outputs
