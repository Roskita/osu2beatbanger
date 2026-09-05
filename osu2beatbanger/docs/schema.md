# Beat Banger schema notes

The repository was started from the user's known-good `My Mod.zip` template.

Important fields observed in that template:

- `act.cfg` uses `[main]` + `data={...}`
- level configs live under `default/config/`
- `notes.cfg` contains `charts`
- each chart contains:
  - `icon`
  - `name`
  - `notes`
  - `rating`
- each basic note contains:
  - `input_type`
  - `note_modifier`
  - `timestamp`
- `keyframes.cfg` contains BPM modifiers
- `asset.cfg` points to the level's audio
- `settings.cfg` contains `song_offset` and `post_song_delay`

Do not assume that a field discovered in an unrelated Beat Banger version is valid for this template. Keep target serialization isolated in `bb_schema.py` and `converter.py`.

The current hold serialization in the scaffold is deliberately marked as provisional and should be validated against a known-good current Beat Banger hold chart before publishing a stable release.
