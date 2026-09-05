# osu2beatbanger

Convert 4K osu!mania `.osz` beatmaps into Beat Banger Release-format mods.

This repository is intentionally built around a **known-good Beat Banger mod template**. The converter copies the template and changes only the song/chart-specific data instead of inventing the package structure.

## Status

Early repository scaffold.

Implemented:

- `.osz` extraction
- osu!mania `.osu` parsing
- 4K lane mapping
- tap-note conversion
- osu!mania hold detection
- BPM/timing-point parsing
- Beat Banger `notes.cfg` serialization
- template-based output
- ZIP packaging with the nested structure expected by the supplied template

Not yet finalized:

- exact Beat Banger hold-note serialization for every game version
- multiple timing sections/keyframe conversion
- automatic chart difficulty/rating heuristics
- waveform/editor-cache generation
- automatic background/audio transcoding

## Usage

```bash
python -m osu2beatbanger "song.osz" --template "My Mod.zip" -o "output.zip"
```

Or after installing the project:

```bash
osu2beatbanger "song.osz" --template "My Mod.zip" -o "output.zip"
```

The template should be a working Beat Banger mod ZIP with the structure:

```text
My Mod/
├── act.cfg
├── thumb.png
└── default/
    ├── audio/
    ├── config/
    │   ├── asset.cfg
    │   ├── keyframes.cfg
    │   ├── meta.cfg
    │   ├── mod.cfg
    │   ├── notes.cfg
    │   └── settings.cfg
    ├── images/
    ├── thumb.png
    └── ...
```

The repository contains a text-only copy of the important config schema under
`templates/beat-banger/`.

## Design

```text
OSZ
 │
 ├─ discover 4K .osu
 ├─ parse metadata/audio/background
 ├─ parse timing points
 ├─ parse HitObjects
 ├─ normalize notes
 ├─ serialize using Beat Banger template schema
 └─ copy/package template
```

The parser deliberately keeps osu! parsing separate from Beat Banger serialization so the target schema can be adjusted without rewriting the osu! parser.

## License

Add the license you want for this project before publishing it. Do not redistribute copyrighted song/chart assets unless you have permission.
