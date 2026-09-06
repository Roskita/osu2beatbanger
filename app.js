(function (global) {
  "use strict";

  function round(num, decimals) {
    const f = Math.pow(10, decimals);
    return Math.round((num + Number.EPSILON) * f) / f;
  }

  function parseIntSafe(value, fallback) {
    if (value === undefined || value === null) return fallback;
    const asInt = parseInt(value, 10);
    if (!Number.isNaN(asInt) && String(asInt) === String(value).trim()) return asInt;
    const asFloat = parseFloat(value);
    if (!Number.isNaN(asFloat)) return Math.trunc(asFloat);
    return fallback;
  }

  const ILLEGAL_PATH_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;

  function sanitizeFilename(name, fallback) {
    fallback = fallback || "Converted Map";
    let cleaned = String(name == null ? "" : name).replace(ILLEGAL_PATH_CHARS, "_").trim();
    cleaned = cleaned.replace(/^\.+|\.+$/g, "");
    if (!cleaned || cleaned.replace(/_/g, "") === "") return fallback;
    return cleaned;
  }

  function basename(p) {
    const parts = String(p).split("/");
    return parts[parts.length - 1];
  }

  function dirname(p) {
    const parts = String(p).split("/");
    parts.pop();
    return parts.join("/");
  }

  function extOf(name) {
    const m = /\.[^./\\]+$/.exec(name);
    return m ? m[0].toLowerCase() : "";
  }

  function section(text, name) {
    const marker = "[" + name + "]";
    let start = text.indexOf(marker);
    if (start < 0) return [];
    start = text.indexOf("\n", start);
    if (start < 0) return [];
    let end = text.indexOf("\n[", start + 1);
    if (end < 0) end = text.length;
    return text
      .slice(start, end)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length && !l.startsWith("//"));
  }

  function kv(lines) {
    const result = {};
    for (const line of lines) {
      const idx = line.indexOf(":");
      if (idx >= 0) {
        result[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      }
    }
    return result;
  }

  function parseBackgroundFilename(text) {
    for (const line of section(text, "Events")) {
      const parts = line.split(",");
      if (parts.length < 3) continue;
      const eventType = parts[0].trim();
      if (eventType !== "0" && eventType !== "Background") continue;
      const filename = parts[2].trim().replace(/^"|"$/g, "");
      if (filename) return filename;
    }
    return null;
  }

  function stripBom(text) {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }

  function peekModeColumns(text) {
    const general = kv(section(text, "General"));
    const difficulty = kv(section(text, "Difficulty"));
    return {
      mode: parseIntSafe(general.Mode, -1),
      columns: parseIntSafe(difficulty.CircleSize, -1),
    };
  }

  function parseOsu(text, nameHint) {
    text = stripBom(text);
    const general = kv(section(text, "General"));
    const metadata = kv(section(text, "Metadata"));
    const difficulty = kv(section(text, "Difficulty"));

    const mode = parseIntSafe(general.Mode, 0);
    const columns = parseIntSafe(difficulty.CircleSize, 4);

    if (mode !== 3) {
      throw new Error(`${nameHint}: not an osu!mania map (Mode: ${mode})`);
    }
    if (columns !== 4) {
      throw new Error(`${nameHint}: expected 4K mania, found CircleSize=${columns}`);
    }

    const timingPoints = [];
    for (const line of section(text, "TimingPoints")) {
      const parts = line.split(",").map((s) => s.trim());
      if (parts.length < 2) continue;
      const timeMs = parseFloat(parts[0]);
      const beatLength = parseFloat(parts[1]);
      if (Number.isNaN(timeMs) || Number.isNaN(beatLength)) continue;
      timingPoints.push({
        timeMs,
        beatLengthMs: Math.abs(beatLength),
        inherited: beatLength < 0,
      });
    }

    const notes = [];
    for (const line of section(text, "HitObjects")) {
      const parts = line.split(",");
      if (parts.length < 5) continue;
      const x = parseInt(parts[0], 10);
      const timeMs = parseFloat(parts[2]);
      const objectType = parseInt(parts[3], 10);
      if ([x, timeMs, objectType].some((v) => Number.isNaN(v))) continue;

      const lane = Math.min(3, Math.max(0, Math.trunc(x / (512 / 4))));

      let endMs = null;
      if (objectType & 128) {
        const tail = parts.length >= 6 ? parts[5] : parts[4];
        const endToken = tail.split(":")[0];
        const parsed = parseFloat(endToken);
        if (!Number.isNaN(parsed)) endMs = parsed;
      }
      notes.push({ lane, timeMs, endMs, get isHold() { return this.endMs !== null && this.endMs > this.timeMs; } });
    }
    notes.sort((a, b) => a.timeMs - b.timeMs || a.lane - b.lane);

    const osuMap = {
      title: metadata.Title || nameHint,
      artist: metadata.Artist || "Unknown Artist",
      creator: metadata.Creator || "Unknown Creator",
      version: metadata.Version || nameHint,
      audioFilename: general.AudioFilename || null,
      backgroundFilename: parseBackgroundFilename(text),
      mode,
      columns,
      timingPoints,
      notes,
    };

    Object.defineProperty(osuMap, "bpm", {
      get() {
        const pts = this.timingPoints.filter((p) => !p.inherited && p.beatLengthMs > 0);
        return pts.length ? 60000.0 / pts[0].beatLengthMs : null;
      },
    });
    Object.defineProperty(osuMap, "offsetMs", {
      get() {
        const pts = this.timingPoints.filter((p) => !p.inherited && p.beatLengthMs > 0);
        return pts.length ? pts[0].timeMs : 0.0;
      },
    });

    return osuMap;
  }


  // bb_schema.py equivalents
 
  function cfgData(data) {
    return "[main]\n\ndata=" + JSON.stringify(data, null, 2) + "\n";
  }

  function loadCfgData(text) {
    const marker = "data=";
    const idx = text.indexOf(marker);
    if (idx < 0) throw new Error("cfg file does not contain a [main] data= value");
    const raw = text.slice(idx + marker.length).trim();
    return JSON.parse(raw);
  }

  function makePlaceholderPng(size, color) {
    color = color || [40, 40, 40];
    return new Promise((resolve, reject) => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
        ctx.fillRect(0, 0, size, size);
        canvas.toBlob((blob) => {
          if (!blob) return reject(new Error("canvas.toBlob failed"));
          blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf))).catch(reject);
        }, "image/png");
      } catch (e) {
        reject(e);
      }
    });
  }

  // osu_to_bb.py :: convert an osu!mania .osz -> a Beat Banger mod .zip

  function laneNote(note) {
    const result = {
      input_type: note.lane,
      note_modifier: 0,
      timestamp: round(note.timeMs / 1000.0, 6),
    };
    if (note.isHold) {
      result.note_modifier = 3;
      result.hold_end_timestamp = round(note.endMs / 1000.0, 6);
    }
    return result;
  }

  async function findEntryByBasename(zip, filename, { recursive = true } = {}) {
    if (!filename) return null;
    const targetLower = filename.toLowerCase();
    const entries = Object.values(zip.files).filter((f) => !f.dir);
    // direct match first (name equals, case-insensitive, ignoring path)
    for (const f of entries) {
      if (f.name.toLowerCase() === targetLower) return f;
    }
    const pool = recursive ? entries : entries.filter((f) => !f.name.includes("/"));
    for (const f of pool) {
      if (basename(f.name).toLowerCase() === targetLower) return f;
    }
    return null;
  }

  async function findAudioEntry(zip, declaredFilename) {
    let entry = await findEntryByBasename(zip, declaredFilename, { recursive: true });
    if (entry) return entry;
    const candidates = Object.values(zip.files).filter(
      (f) => !f.dir && /\.(mp3|ogg|wav)$/i.test(f.name)
    );
    if (!candidates.length) return null;
    candidates.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return candidates[0];
  }

  async function findBackgroundEntry(zip, declaredFilename) {
    if (declaredFilename) {
      const entry = await findEntryByBasename(zip, declaredFilename, { recursive: true });
      if (entry) return entry;
    }
    const candidates = Object.values(zip.files).filter(
      (f) => !f.dir && !f.name.includes("/") && /\.(jpg|jpeg|png|webp)$/i.test(f.name)
    );
    if (!candidates.length) return null;
    candidates.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return candidates[0];
  }

  async function convertOszToBB(file, JSZip, onWarning) {
    const inputZip = await JSZip.loadAsync(file);

    const osuEntries = Object.values(inputZip.files).filter(
      (f) => !f.dir && /\.osu$/i.test(f.name)
    );
    const maps = [];
    for (const entry of osuEntries) {
      const text = stripBom(await entry.async("string"));
      const { mode, columns } = peekModeColumns(text);
      if (mode === 3 && columns === 4) maps.push(entry);
    }
    if (!maps.length) {
      throw new Error("No osu!mania 4K (.osu) maps were found.");
    }
    maps.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    const parsedMaps = [];
    for (const entry of maps) {
      const text = await entry.async("string");
      parsedMaps.push(parseOsu(text, basename(entry.name).replace(/\.osu$/i, "")));
    }
    const first = parsedMaps[0];
    const inputStem = basename(file.name || "map").replace(/\.[^.]+$/, "");
    const modName = sanitizeFilename(first.title || inputStem);

    const out = new JSZip();
    const root = out.folder(modName);
    const level = root.folder("default");
    const audioDir = level.folder("audio");
    const configDir = level.folder("config");
    const imagesDir = level.folder("images");
    level.folder("video");

    const charts = [];
    let anyHolds = false;
    for (let i = 0; i < parsedMaps.length; i++) {
      const osuMap = parsedMaps[i];
      charts.push({
        icon: `icon${i}.png`,
        name: osuMap.version,
        notes: osuMap.notes.map(laneNote),
        rating: i,
      });
      anyHolds = anyHolds || osuMap.notes.some((n) => n.isHold);
      imagesDir.file(`icon${i}.png`, await makePlaceholderPng(32));
    }
    if (anyHolds && onWarning) {
      onWarning(
        "This map contains hold notes. Their Beat Banger format (note_modifier=3 + " +
          "hold_end_timestamp) is unconfirmed against a real example — verify holds " +
          "actually work in-game before trusting this output."
      );
    }

    configDir.file("notes.cfg", cfgData({ charts }));

    const audioEntry = await findAudioEntry(inputZip, first.audioFilename);
    if (!audioEntry) {
      throw new Error("Could not find an audio file in the osu! mapset.");
    }
    const audioFilename = basename(audioEntry.name);
    audioDir.file(audioFilename, await audioEntry.async("uint8array"));

    configDir.file(
      "asset.cfg",
      cfgData({ horny_mode_sound: "", song_path: audioFilename })
    );

    const bpm = first.bpm;
    if (bpm === null) {
      throw new Error(
        `${basename(maps[0].name)}: no valid uninherited timing point found — ` +
          "cannot determine BPM. A wrong BPM would silently desync every note in the chart."
      );
    }
    const distinctBpms = new Set(
      first.timingPoints
        .filter((tp) => !tp.inherited && tp.beatLengthMs > 0)
        .map((tp) => round(60000.0 / tp.beatLengthMs, 2))
    );
    if (distinctBpms.size > 1) {
      throw new Error(
        `${basename(maps[0].name)}: map has ${distinctBpms.size} different BPM values ` +
          `(${[...distinctBpms].sort((a, b) => a - b).join(", ")}) across its uninherited ` +
          "timing points. This converter does not support BPM changes."
      );
    }

    const backgroundEntry = await findBackgroundEntry(inputZip, first.backgroundFilename);
    let backgroundName = null;
    if (backgroundEntry) {
      backgroundName = "BG" + extOf(backgroundEntry.name);
      imagesDir.file(backgroundName, await backgroundEntry.async("uint8array"));
    }

    configDir.file(
      "keyframes.cfg",
      cfgData({
        background: backgroundName ? [{ path: backgroundName, timestamp: 0.0 }] : [],
        effects: [],
        loops: [],
        modifiers: [{ bpm: round(bpm, 6), timestamp: 0.0 }],
        shutter: [],
        sound_loop: [],
        sound_oneshot: [],
        voice_bank: [],
      })
    );

    const actId = crypto.randomUUID().replace(/-/g, "");
    const levelId = crypto.randomUUID().replace(/-/g, "");

    configDir.file(
      "meta.cfg",
      cfgData({
        character: "Default",
        color: [0.5, 0.5, 0.5],
        level_id: levelId,
        level_index: 0,
        level_name: modName,
      })
    );

    configDir.file(
      "mod.cfg",
      cfgData({
        description: `Converted from osu!mania: ${modName}`,
        preview_timestamp: 0.0,
        song_creator: first.artist,
        song_title: first.title,
      })
    );

    configDir.file(
      "settings.cfg",
      cfgData({ post_song_delay: 5.0, song_offset: 0.0 })
    );

    level.file("editor_cache.cfg", cfgData({ audio_path: audioFilename }));

    root.file(
      "act.cfg",
      cfgData({
        act_description: `Converted osu!mania map: ${modName}`,
        act_id: actId,
        act_index: 0,
        act_name: modName,
        author: first.creator,
      })
    );

    root.file("thumb.png", await makePlaceholderPng(128));
    level.file("splash.png", await makePlaceholderPng(256));
    level.file("thumb.png", await makePlaceholderPng(128));
    level.file("waveform.png", await makePlaceholderPng(64));

    const blob = await out.generateAsync({ type: "blob", compression: "DEFLATE" });
    return { filename: `${modName}.zip`, blob, modName, chartCount: charts.length, anyHolds };
  }

  // bb_parser.py / bb_to_osu.py / osu_writer.py :: BB mod -> .osz

  function noteFromDict(d) {
    const lane = parseInt(d.input_type || 0, 10);
    const timestamp = parseFloat(d.timestamp || 0);
    const timeMs = timestamp * 1000.0;
    let endMs = null;
    if (d.note_modifier === 3 && "hold_end_timestamp" in d) {
      const v = parseFloat(d.hold_end_timestamp);
      if (!Number.isNaN(v)) endMs = v * 1000.0;
    }
    return { lane, timeMs, endMs, get isHold() { return this.endMs !== null && this.endMs > this.timeMs; } };
  }

  function laneToX(lane) {
    lane = Math.max(0, Math.min(3, lane));
    return Math.trunc((512 * (lane + 0.5)) / 4);
  }

  function hitObjectLine(note) {
    const x = laneToX(note.lane);
    const y = 192;
    const time = Math.round(note.timeMs);
    if (note.isHold) {
      const end = Math.round(note.endMs);
      return `${x},${y},${time},128,0,${end}:0:0:0:0:`;
    }
    return `${x},${y},${time},1,0,0:0:0:0:`;
  }

  function escapeMetadata(v) {
    return String(v).replace(/\r/g, " ").replace(/\n/g, " ");
  }

  function buildOsuText({ title, artist, creator, version, audioFilename, backgroundFilename, bpm, offsetMs, notes }) {
    if (bpm <= 0) throw new Error(`Cannot write a .osu file with non-positive bpm=${bpm}`);
    const beatLength = 60000.0 / bpm;
    const sortedNotes = notes.slice().sort((a, b) => a.timeMs - b.timeMs || a.lane - b.lane);
    const hitObjects = sortedNotes.map(hitObjectLine).join("\n");
    const events = backgroundFilename ? `0,0,"${backgroundFilename}",0,0` : "";

    title = escapeMetadata(title);
    artist = escapeMetadata(artist);
    creator = escapeMetadata(creator);
    version = escapeMetadata(version);

    return `osu file format v14

[General]
AudioFilename: ${audioFilename}
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
Title:${title}
TitleUnicode:${title}
Artist:${artist}
ArtistUnicode:${artist}
Creator:${creator}
Version:${version}
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
${events}

[TimingPoints]
${offsetMs},${beatLength},4,2,1,60,1,0

[HitObjects]
${hitObjects} 
`;
  }

  async function resolveAsset(zip, levelDir, subfolder, filename) {
    if (!filename) return null;
    const prefix = `${levelDir}/${subfolder}/`;
    const direct = zip.files[prefix + filename];
    if (direct && !direct.dir) return direct;
    const targetLower = filename.toLowerCase();
    for (const f of Object.values(zip.files)) {
      if (f.dir || !f.name.startsWith(prefix)) continue;
      if (basename(f.name).toLowerCase() === targetLower) return f;
    }
    return null;
  }

  async function convertBBToOsz(file, JSZip) {
    const zip = await JSZip.loadAsync(file);

    const actEntries = Object.values(zip.files).filter(
      (f) => !f.dir && /(^|\/)act\.cfg$/i.test(f.name)
    );
    if (!actEntries.length) {
      throw new Error("No act.cfg found — this doesn't look like a Beat Banger mod.");
    }
    actEntries.sort((a, b) => a.name.split("/").length - b.name.split("/").length);
    const actEntry = actEntries[0];
    const modRoot = dirname(actEntry.name); // may be "" if act.cfg is at zip root
    const actData = loadCfgData(await actEntry.async("string"));

    const notesCfgEntries = Object.values(zip.files).filter(
      (f) =>
        !f.dir &&
        /(^|\/)config\/notes\.cfg$/i.test(f.name) &&
        (modRoot === "" || f.name === modRoot || f.name.startsWith(modRoot + "/"))
    );
    if (!notesCfgEntries.length) {
      throw new Error("No level (config/notes.cfg) found under this mod.");
    }
    const levelDirs = [...new Set(notesCfgEntries.map((f) => dirname(dirname(f.name))))].sort();

    const outputs = [];
    for (const levelDir of levelDirs) {
      const levelName = basename(levelDir) || "level";
      const required = ["asset.cfg", "settings.cfg", "meta.cfg", "mod.cfg", "keyframes.cfg", "notes.cfg"];
      for (const req of required) {
        if (!zip.files[`${levelDir}/config/${req}`]) {
          throw new Error(`${levelDir}: missing config/${req}`);
        }
      }
      const readCfg = async (name) =>
        loadCfgData(await zip.files[`${levelDir}/config/${name}`].async("string"));

      const asset = await readCfg("asset.cfg");
      const settings = await readCfg("settings.cfg");
      const modCfg = await readCfg("mod.cfg");
      const keyframes = await readCfg("keyframes.cfg");
      const notesCfg = await readCfg("notes.cfg");

      const modifiers = keyframes.modifiers || [];
      if (!modifiers.length || !("bpm" in modifiers[0])) {
        throw new Error(`${levelDir}: no BPM found in keyframes.cfg 'modifiers'`);
      }
      const bpm = parseFloat(modifiers[0].bpm);

      const audioEntry = await resolveAsset(zip, levelDir, "audio", asset.song_path);
      if (!audioEntry) {
        throw new Error(`${levelDir}: song_path '${asset.song_path}' not found under audio/`);
      }

      let backgroundEntry = null;
      const bgEntries = keyframes.background || [];
      if (bgEntries.length && bgEntries[0].path) {
        backgroundEntry = await resolveAsset(zip, levelDir, "images", bgEntries[0].path);
      }

      const chartsRaw = notesCfg.charts || [];
      if (!chartsRaw.length) {
        throw new Error(`${levelDir}: notes.cfg has no charts`);
      }
      const charts = chartsRaw.map((c) => ({
        name: c.name || "Normal",
        rating: parseInt(c.rating || 0, 10),
        icon: c.icon || "icon0.png",
        notes: (c.notes || []).map(noteFromDict),
      }));

      const songCreator = modCfg.song_creator || "Unknown Artist";
      const songTitle = modCfg.song_title || levelName;
      const author = actData.author || "Unknown";

      const osz = new JSZip();
      const audioName = basename(audioEntry.name);
      osz.file(audioName, await audioEntry.async("uint8array"));

      let backgroundName = null;
      if (backgroundEntry) {
        backgroundName = basename(backgroundEntry.name);
        osz.file(backgroundName, await backgroundEntry.async("uint8array"));
      }

      for (const chart of charts) {
        const osuText = buildOsuText({
          title: songTitle,
          artist: songCreator,
          creator: author,
          version: chart.name,
          audioFilename: audioName,
          backgroundFilename: backgroundName,
          bpm,
          offsetMs: 0.0, // bb notes.cfg timestamps are already absolute
          notes: chart.notes,
        });
        const osuFilename =
          sanitizeFilename(`${songCreator} - ${songTitle} [${chart.name}]`, `${levelName}_${chart.name}`) +
          ".osu";
        osz.file(osuFilename, osuText);
      }

      const oszName = sanitizeFilename(`${songCreator} - ${songTitle}`, levelName) + ".osz";
      const blob = await osz.generateAsync({ type: "blob", compression: "DEFLATE" });
      outputs.push({ filename: oszName, blob, chartCount: charts.length });
    }

    return outputs;
  }

  // public API
  async function detectKind(file, JSZip) {
    const zip = await JSZip.loadAsync(file);
    const names = Object.keys(zip.files);
    const hasOsu = names.some((n) => !zip.files[n].dir && /\.osu$/i.test(n));
    const hasActCfg = names.some((n) => !zip.files[n].dir && /(^|\/)act\.cfg$/i.test(n));
    if (hasOsu) return "osu";
    if (hasActCfg) return "bb";
    return "unknown";
  }

  global.BBMania = {
    detectKind,
    convertOszToBB,
    convertBBToOsz,
    // exposed for tests
    _internal: { parseOsu, sanitizeFilename, buildOsuText, laneNote, noteFromDict, cfgData, loadCfgData },
  };
})(typeof window !== "undefined" ? window : globalThis);
