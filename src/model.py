from dataclasses import dataclass, field
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
    version: str
    audio_filename: Optional[str]
    mode: int
    columns: int
    timing_points: list[TimingPoint] = field(default_factory=list)
    notes: list[Note] = field(default_factory=list)

    @property
    def bpm(self) -> Optional[float]:
        points = [p for p in self.timing_points if not p.inherited and p.beat_length_ms > 0]
        if not points:
            return None
        return 60000.0 / points[0].beat_length_ms
