from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


@dataclass
class TimingPoint:
    time_ms: float
    beat_length_ms: float
    inherited: bool = False


@dataclass
class Note:
    lane: int
    time_ms: float
    end_ms: Optional[float] = None

    @property
    def is_hold(self) -> bool:
        return self.end_ms is not None and self.end_ms > self.time_ms


@dataclass
class OsuMap:
    path: str
    title: str
    artist: str
    creator: str
    version: str
    audio_filename: Optional[str]
    background_filename: Optional[str] = None
    mode: int = 0
    columns: int = 4
    timing_points: list[TimingPoint] = field(default_factory=list)
    notes: list[Note] = field(default_factory=list)

    @property
    def bpm(self) -> Optional[float]:
        points = [p for p in self.timing_points if not p.inherited and p.beat_length_ms > 0]
        if not points:
            return None
        return 60000.0 / points[0].beat_length_ms

    @property
    def offset_ms(self) -> float:
        """Time of the first uninherited timing point — where the beat grid
        (and BPM) actually starts. Needed to write a correct .osu
        [TimingPoints] line when going bb -> osu."""
        points = [p for p in self.timing_points if not p.inherited and p.beat_length_ms > 0]
        return points[0].time_ms if points else 0.0


@dataclass
class BBChart:
    """One difficulty's worth of notes, as read from a notes.cfg 'charts'
    entry (icon/rating carried through so a round trip -> bb doesn't lose
    them, even though osu!mania itself has no equivalent field)."""
    name: str
    rating: int
    icon: str
    notes: list[Note] = field(default_factory=list)


@dataclass
class BBLevel:
    """Everything needed to reconstruct one or more .osu difficulties from
    an already-converted (or hand-made) Beat Banger mod folder."""
    level_dir: Path
    act_name: str
    author: str
    description: str
    song_creator: str
    song_title: str
    bpm: float
    song_offset: float
    audio_path: Path
    background_path: Optional[Path]
    charts: list[BBChart] = field(default_factory=list)
