from pathlib import Path
import tempfile

from osu2beatbanger.osu_parser import parse_osu


OSU = """osu file format v14

[General]
AudioFilename: song.mp3
Mode: 3

[Metadata]
Title: Test Song
Artist: Test Artist
Version: Hard

[Difficulty]
CircleSize: 4

[TimingPoints]
0,500,4,2,0,100,1,0

[HitObjects]
64,192,1000,1,0,0:0:0:0:
192,192,1500,1,0,0:0:0:0:
320,192,2000,128,0,2500:0:0:0:0:
448,192,2500,1,0,0:0:0:0:
"""


def test_parse_4k():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "test.osu"
        p.write_text(OSU)
        m = parse_osu(p)

        assert m.columns == 4
        assert m.mode == 3
        assert [n.lane for n in m.notes] == [0, 1, 2, 3]
        assert m.notes[2].is_hold
        assert m.notes[2].end_ms == 2500
        assert round(m.bpm, 3) == 120.0
