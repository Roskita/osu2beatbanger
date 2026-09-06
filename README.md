# static webpage version :3 


No build step needed — just serve the folder statically, e.g.:

```
python3 -m http.server 8000
```

then open `http://localhost:8000`.

## Host it on GitHub Pages

1. Push this folder to a repo (or a `docs/` folder / `gh-pages` branch).
2. In the repo settings, enable **Pages** and point it at that
   folder/branch.
3. It'll be live at `https://<you>.github.io/<repo>/` — same idea as the
   [mania-converter](https://theleername.github.io/mania-converter/) site
   this was modeled after.

## Known limits (carried over from the original tool)

- Only 4-key osu!mania charts are supported.
- Charts with a mid-song BPM change are rejected (the target format has no
  equivalent field).
- Hold-note encoding on the Beat Banger side (`note_modifier: 3` +
  `hold_end_timestamp`) is a best-effort guess, not confirmed against a real
  in-game example.
- Icons, splash art, and waveform thumbnails are generated as flat-color
  placeholders since osu! charts have no equivalent assets.
