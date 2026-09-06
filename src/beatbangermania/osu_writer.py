from __future__ import annotations

from .model import Note


def lane_to_x(lane: int) -> int:
    """Inverse of osu_parser.py's column formula (column = floor(x*4/512)).
    Center-of-column x values: 64, 192, 320, 448 for lanes 0-3."""
    lane = max(0, min(3, lane))
    return int(512 * (lane + 0.5) / 4)


def _hitobject_line(note: Note) -> str:
    x = lane_to_x(note.lane)
    y = 192
    time = int(round(note.time_ms))
    if note.is_hold:
        end = int(round(note.end_ms))
        # mania hold: type bit 128 set; extras field is "endTime:hitSample"
        return f"{x},{y},{time},128,0,{end}:0:0:0:0:"
    return f"{x},{y},{time},1,0,0:0:0:0:"


def _escape_metadata(value: str) -> str:
    # osu!'s key:value metadata lines aren't quote-delimited, so a raw
    # newline would corrupt the file; anything else is fine as-is.
    return str(value).replace("\r", " ").replace("\n", " ")


def build_osu_text(
    *,
    title: str,
    artist: str,
    creator: str,
    version: str,
    audio_filename: str,
    background_filename: str | None,
    bpm: float,
    offset_ms: float,
    notes: list[Note],
) -> str:
    if bpm <= 0:
        raise ValueError(f"Cannot write a .osu file with non-positive bpm={bpm}")

    beat_length = 60000.0 / bpm
    sorted_notes = sorted(notes, key=lambda n: (n.time_ms, n.lane))
    hit_objects = "\n".join(_hitobject_line(n) for n in sorted_notes)
    events = f'0,0,"{background_filename}",0,0' if background_filename else ""

    title = _escape_metadata(title)
    artist = _escape_metadata(artist)
    creator = _escape_metadata(creator)
    version = _escape_metadata(version)

    return f"""osu file format v14

[General]
AudioFilename: {audio_filename}
AudioLeadIn: 0
PreviewTime: -1
Countdown: 0
SampleSet: Normal
StackLeniency: 0.7
Mode: 3
LetterboxInBreaks: 0
SpecialStyle: 0
WidescreenStoryboard: 0

[Editor]
DistanceSpacing: 1
BeatDivisor: 4
GridSize: 4
TimelineZoom: 1

[Metadata]
Title:{title}
TitleUnicode:{title}
Artist:{artist}
ArtistUnicode:{artist}
Creator:{creator}
Version:{version}
Source:
Tags:beatbangermania converted
BeatmapID:0
BeatmapSetID:-1

[Difficulty]
HPDrainRate:8
CircleSize:4
OverallDifficulty:8
ApproachRate:5
SliderMultiplier:1.4
SliderTickRate:1

[Events]
{events}

[TimingPoints]
{offset_ms},{beat_length},4,2,1,60,1,0

[HitObjects]
{hit_objects} 
"""
