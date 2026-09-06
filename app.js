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

  function parseBackgroundEvents(text) {
    let imageFilename = null;
    const videoEvents = [];
    for (const line of section(text, "Events")) {
      const parts = line.split(",");
      if (parts.length < 3) continue;
      const eventType = parts[0].trim();
      if (eventType === "0" || eventType === "Background") {
        const filename = parts[2].trim().replace(/^"|"$/g, "");
        if (filename && !imageFilename) imageFilename = filename;
      } else if (eventType === "1" || eventType === "Video") {
        const filename = parts[2].trim().replace(/^"|"$/g, "");
        const startMs = parseFloat(parts[1]);
        if (filename) videoEvents.push({ filename, startMs: Number.isNaN(startMs) ? 0 : startMs });
      }
    }
    return { imageFilename, videoEvents };
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

    const backgroundEvents = parseBackgroundEvents(text);

    const osuMap = {
      title: metadata.Title || nameHint,
      artist: metadata.Artist || "Unknown Artist",
      creator: metadata.Creator || "Unknown Creator",
      version: metadata.Version || nameHint,
      audioFilename: general.AudioFilename || null,
      backgroundFilename: backgroundEvents.imageFilename,
      videoEvents: backgroundEvents.videoEvents,
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

  // Beat Banger's cfg files are written by Godot/GDScript, which serializes typed
  // values (Vector2, Color, Rect2, Transform2D, ...) as constructor-call syntax like
  // `Vector2(-2, 3)` rather than plain JSON. Turn any such `Identifier(...)` into a
  // JSON array `[...]` so the rest of the value can be parsed as ordinary JSON.
  // Handles nesting (e.g. a Transform2D wrapping Vector2s) and leaves quoted string
  // contents untouched.
  function convertGodotConstructorsToJson(text) {
    let result = "";
    const n = text.length;

    function readString(start) {
      let j = start + 1;
      while (j < n) {
        if (text[j] === "\\") { j += 2; continue; }
        if (text[j] === '"') { j++; break; }
        j++;
      }
      return text.slice(start, j);
    }

    function findMatchingParen(openIdx) {
      let depth = 0;
      let j = openIdx;
      while (j < n) {
        const ch = text[j];
        if (ch === '"') { j += readString(j).length; continue; }
        if (ch === "(") depth++;
        else if (ch === ")") {
          depth--;
          if (depth === 0) return j;
        }
        j++;
      }
      return -1;
    }

    let i = 0;
    while (i < n) {
      const ch = text[i];
      if (ch === '"') {
        const s = readString(i);
        result += s;
        i += s.length;
        continue;
      }
      const idMatch = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i));
      if (idMatch) {
        const name = idMatch[0];
        const nextChar = text[i + name.length];
        if (nextChar === "(") {
          const openIdx = i + name.length;
          const closeIdx = findMatchingParen(openIdx);
          if (closeIdx !== -1) {
            const inner = text.slice(openIdx + 1, closeIdx);
            result += "[" + convertGodotConstructorsToJson(inner) + "]";
            i = closeIdx + 1;
            continue;
          }
        } else if (name === "True" || name === "False" || name === "None") {
          // Some cfg values use Python-style bare keywords instead of JSON's
          // lowercase true/false/null.
          result += name === "True" ? "true" : name === "False" ? "false" : "null";
          i += name.length;
          continue;
        }
      }
      result += ch;
      i++;
    }
    return result;
  }

  function loadCfgData(text, sourceLabel) {
    sourceLabel = sourceLabel || "cfg file";
    const marker = "data=";
    const idx = text.indexOf(marker);
    if (idx < 0) throw new Error(`${sourceLabel}: does not contain a [main] data= value`);

    let start = idx + marker.length;
    while (start < text.length && /\s/.test(text[start])) start++;

    const openChar = text[start];
    const closeChar = openChar === "{" ? "}" : openChar === "[" ? "]" : null;
    if (!closeChar) {
      throw new Error(`${sourceLabel}: data= value is not a JSON object or array`);
    }

    let depth = 0;
    let inString = false;
    let escapeNext = false;
    let end = -1;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escapeNext) escapeNext = false;
        else if (ch === "\\") escapeNext = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === openChar) depth++;
      else if (ch === closeChar) {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end < 0) {
      throw new Error(`${sourceLabel}: data= value has unbalanced braces/brackets`);
    }

    const raw = convertGodotConstructorsToJson(text.slice(start, end + 1));
    try {
      return JSON.parse(raw);
    } catch (e) {
      // Surface *where* in the (already-normalized) value parsing broke, since the
      // bare browser JSON.parse error alone doesn't say which cfg file it came from.
      const posMatch = /column (\d+)/.exec(e.message);
      let snippet = "";
      if (posMatch) {
        const col = parseInt(posMatch[1], 10);
        const lineMatch = /line (\d+)/.exec(e.message);
        const lineNo = lineMatch ? parseInt(lineMatch[1], 10) : null;
        if (lineNo) {
          const lines = raw.split("\n");
          const line = lines[lineNo - 1] || "";
          const around = line.slice(Math.max(0, col - 30), col + 10);
          snippet = ` — near: ...${around}...`;
        }
      }
      throw new Error(`${sourceLabel}: couldn't parse cfg data as JSON (${e.message})${snippet}`);
    }
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

  function dimImageBytes(bytes, dimPercent, mode) {
    mode = mode === "strip" ? "strip" : "full";
    return new Promise((resolve, reject) => {
      let url;
      try {
        const blob = new Blob([bytes]);
        url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          try {
            const canvas = document.createElement("canvas");
            canvas.width = img.naturalWidth || 1;
            canvas.height = img.naturalHeight || 1;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0);
            const alpha = Math.min(1, Math.max(0, dimPercent / 100));
            if (alpha > 0) {
              ctx.fillStyle = `rgba(0,0,0,${alpha})`;
              if (mode === "strip") {
                const stripWidth = Math.min(400, canvas.width);
                const x = Math.max(0, (canvas.width - stripWidth) / 2);
                ctx.fillRect(x, 0, stripWidth, canvas.height);
              } else {
                ctx.fillRect(0, 0, canvas.width, canvas.height);
              }
            }
            canvas.toBlob((outBlob) => {
              URL.revokeObjectURL(url);
              if (!outBlob) return reject(new Error("canvas.toBlob failed while dimming background"));
              outBlob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf))).catch(reject);
            }, "image/png");
          } catch (e) {
            URL.revokeObjectURL(url);
            reject(e);
          }
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error("Failed to load background image for dimming"));
        };
        img.src = url;
      } catch (e) {
        if (url) URL.revokeObjectURL(url);
        reject(e);
      }
    });
  }

  // mirror a map upon conversion
  function mirrorLane(lane) {
    return 3 - Math.max(0, Math.min(3, lane));
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

  async function findVideoEntry(zip, declaredFilename) {
    if (declaredFilename) {
      const entry = await findEntryByBasename(zip, declaredFilename, { recursive: true });
      if (entry) return entry;
    }
    const candidates = Object.values(zip.files).filter(
      (f) => !f.dir && /\.(avi|flv|mp4|m4v|mov|wmv|mpg|mpeg|ogv|webm|mkv)$/i.test(f.name)
    );
    if (!candidates.length) return null;
    candidates.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return candidates[0];
  }

  // Beat Banger's video player expects Ogg Theora (.ogv); anything else was copied
  // over as-is and may not play back correctly.
  const BB_VIDEO_EXT_RE = /\.ogv$/i;

  async function convertOszToBB(file, JSZip, onWarning, options) {
    options = options || {};
    const includeBackground = options.includeBackground !== false;
    const dimPercent = Math.min(100, Math.max(0, options.dimPercent || 0));
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
      throw new Error("No 4K maps found, only 4K is valid in Beat Banger");
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

    const warn = typeof onWarning === "function" ? onWarning : () => {};

    let videoEntry = null;
    let videoStartMs = 0;
    const videoEvents = first.videoEvents || [];
    if (videoEvents.length) {
      videoEntry = await findVideoEntry(inputZip, videoEvents[0].filename);
      videoStartMs = videoEvents[0].startMs;
      if (!videoEntry) {
        warn(
          `This beatmap references a video background ("${videoEvents[0].filename}") ` +
            "that couldn't be found in the mapset, so it wasn't included."
        );
      } else if (!BB_VIDEO_EXT_RE.test(videoEntry.name)) {
        warn(
          `This beatmap's video (${basename(videoEntry.name)}) isn't Ogg Theora (.ogv), ` +
            "which is what Beat Banger's video player expects so it may not work"
        );
      }
    }

    if (options.mirrorNotes) {
      for (const m of parsedMaps) {
        for (const n of m.notes) n.lane = mirrorLane(n.lane);
      }
    }

    const out = new JSZip();
    const root = out.folder(modName);
    const level = root.folder("default");
    const audioDir = level.folder("audio");
    const configDir = level.folder("config");
    const imagesDir = level.folder("images");
    const videoDir = level.folder("video");

    // sorts diff by note count, imperfect but good enough lol
    function noteCount(osuMap) {
      return osuMap.notes.length;
    }
    const orderedMaps = parsedMaps.slice().sort((a, b) => noteCount(a) - noteCount(b));
    
    const charts = [];
    let anyHolds = false;
    for (let i = 0; i < orderedMaps.length; i++) {
      const osuMap = orderedMaps[i];
      charts.push({
        icon: `icon${i}.png`,
        name: osuMap.version,
        notes: osuMap.notes.map(laneNote),
        rating: i,
      });
      anyHolds = anyHolds || osuMap.notes.some((n) => n.isHold);
      imagesDir.file(`icon${i}.png`, await makePlaceholderPng(32));
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

    let backgroundName = null;
    // A PNG re-encode (via canvas, undimmed) of the resolved background, reused below
    // as the mod's splash/thumbnail art instead of the generic placeholder logos.
    let backgroundArtBytes = null;
    if (includeBackground) {
      const backgroundEntry = await findBackgroundEntry(inputZip, first.backgroundFilename);
      if (backgroundEntry) {
        const rawBgBytes = await backgroundEntry.async("uint8array");
        backgroundArtBytes = await dimImageBytes(rawBgBytes, 0, "full");
        let bgBytes = rawBgBytes;
        if (dimPercent > 0) {
          bgBytes = await dimImageBytes(rawBgBytes, dimPercent, options.dimMode);
          backgroundName = "BG.png";
        } else {
          backgroundName = "BG" + extOf(backgroundEntry.name);
        }
        imagesDir.file(backgroundName, bgBytes);
      }
    }

    let videoFilename = null;
    if (videoEntry) {
      videoFilename = basename(videoEntry.name);
      videoDir.file(videoFilename, await videoEntry.async("uint8array"));
    }

    configDir.file(
      "keyframes.cfg",
      cfgData({
        background: backgroundName ? [{ path: backgroundName, timestamp: 0.0 }] : [],
        camera: [],
        effects: [],
        loops: [],
        modifiers: [{ bpm: round(bpm, 6), timestamp: 0.0 }],
        shutter: [],
        sound_loop: [],
        sound_oneshot: [],
        video: videoFilename
          ? [{ path: videoFilename, timestamp: round(videoStartMs / 1000.0, 6) }]
          : [],
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
        description: `Converted from osu!mania`,
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
        act_description: `Converted from osu!mania`,
        act_id: actId,
        act_index: 0,
        act_name: modName,
        author: first.creator,
      })
    );

    async function loadImage(path) {
      const response = await fetch(path);

      if (!response.ok) {
          throw new Error(`Could not load ${path}`);
      }

      return new Uint8Array(await response.arrayBuffer());
    }

    const osuLogo = await loadImage("assets/osu.png");
    const mania = await loadImage("assets/mania.png");

    // Use the beatmap's actual background art for splash/thumbnail images when we have
    // one; only fall back to the generic placeholder logos when there's no background
    // (or the person unchecked "include background image").
    root.file("thumb.png", backgroundArtBytes || mania);
    level.file("splash.png", backgroundArtBytes || osuLogo);
    level.file("thumb.png", backgroundArtBytes || osuLogo);
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

  function buildOsuText({
    title,
    artist,
    creator,
    version,
    audioFilename,
    backgroundFilename,
    videoFilename,
    videoStartMs,
    bpm,
    offsetMs,
    notes,
  }) {
    if (bpm <= 0) throw new Error(`Cannot write a .osu file with non-positive bpm=${bpm}`);
    const beatLength = 60000.0 / bpm;
    const sortedNotes = notes.slice().sort((a, b) => a.timeMs - b.timeMs || a.lane - b.lane);
    const hitObjects = sortedNotes.map(hitObjectLine).join("\n");
    const eventLines = [];
    if (backgroundFilename) eventLines.push(`0,0,"${backgroundFilename}",0,0`);
    if (videoFilename) eventLines.push(`Video,${Math.round(videoStartMs || 0)},"${videoFilename}"`);
    const events = eventLines.join("\n");

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

  async function convertBBToOsz(file, JSZip, options) {
    options = options || {};
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
    const actData = loadCfgData(await actEntry.async("string"), actEntry.name);

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
        loadCfgData(
          await zip.files[`${levelDir}/config/${name}`].async("string"),
          `${levelDir}/config/${name}`
        );

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

      const levelWarnings = [];

      let backgroundEntry = null;
      const bgEntries = keyframes.background || [];
      if (bgEntries.length && bgEntries[0].path) {
        backgroundEntry = await resolveAsset(zip, levelDir, "images", bgEntries[0].path);
      }

      let videoEntry = null;
      let videoStartMs = 0;
      const videoEntries = keyframes.video || [];
      if (videoEntries.length && videoEntries[0].path) {
        videoEntry = await resolveAsset(zip, levelDir, "video", videoEntries[0].path);
        videoStartMs = (parseFloat(videoEntries[0].timestamp) || 0) * 1000;
        if (!videoEntry) {
          levelWarnings.push(
            `Video background '${videoEntries[0].path}' referenced in keyframes.cfg was not ` +
              "found under video/ and was not included."
          );
        } 
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

      if (options.mirrorNotes) {
        for (const chart of charts) {
          for (const n of chart.notes) n.lane = mirrorLane(n.lane);
        }
      }

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

      let videoFilename = null;
      if (videoEntry) {
        videoFilename = basename(videoEntry.name);
        osz.file(videoFilename, await videoEntry.async("uint8array"));
      }

      for (const chart of charts) {
        const osuText = buildOsuText({
          title: songTitle,
          artist: songCreator,
          creator: author,
          version: chart.name,
          audioFilename: audioName,
          backgroundFilename: backgroundName,
          videoFilename,
          videoStartMs,
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
      outputs.push({
        filename: oszName,
        blob,
        chartCount: charts.length,
        warning: levelWarnings.length ? levelWarnings.join(" ") : null,
      });
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