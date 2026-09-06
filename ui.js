(function () {
  "use strict";

  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const statusArea = document.getElementById("statusArea");
  const resultsArea = document.getElementById("resultsArea");

  function setStatus(message, kind) {
    if (!message) {
      statusArea.hidden = true;
      statusArea.textContent = "";
      statusArea.className = "status-area";
      return;
    }
    statusArea.hidden = false;
    statusArea.textContent = message;
    statusArea.className = "status-area" + (kind ? " is-" + kind : "");
  }

  function clearResults() {
    resultsArea.hidden = true;
    resultsArea.innerHTML = "";
  }

  function addResultCard({ filename, blob, meta }) {
    resultsArea.hidden = false;
    const url = URL.createObjectURL(blob);
    const card = document.createElement("div");
    card.className = "result-card";
    card.innerHTML = `
      <div>
        <div class="rc-name">${escapeHtml(filename)}</div>
        ${meta ? `<div class="rc-meta">${escapeHtml(meta)}</div>` : ""}
      </div>
      <a class="btn btn-primary" download="${escapeHtml(filename)}" href="${url}">Download</a>
    `;
    resultsArea.appendChild(card);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  async function handleFile(file) {
    clearResults();
    setStatus(`Reading ${file.name}…`, "working");

    let kind;
    try {
      kind = await BBMania.detectKind(file, JSZip);
    } catch (e) {
      setStatus(`Couldn't read that file as a zip: ${e.message}`, "error");
      return;
    }

    if (kind === "unknown") {
      setStatus(
        "Couldn't tell what this is — expected either an osu!mania .osz " +
          "(containing a .osu file) or a Beat Banger mod .zip (containing act.cfg).",
        "error"
      );
      return;
    }

    try {
      if (kind === "osu") {
        setStatus("Converting osu!mania map to a Beat Banger mod…", "working");
        let warning = null;
        const result = await BBMania.convertOszToBB(file, JSZip, (w) => { warning = w; });
        setStatus(
          `Converted "${result.modName}" — ${result.chartCount} chart${result.chartCount === 1 ? "" : "s"}.`,
          warning ? "warning" : null
        );
        if (warning) statusArea.textContent += " " + warning;
        addResultCard({
          filename: result.filename,
          blob: result.blob,
          meta: "Beat Banger mod — unzip into your mods folder",
        });
      } else {
        setStatus("Converting Beat Banger mod to osu!mania map(s)…", "working");
        const results = await BBMania.convertBBToOsz(file, JSZip);
        setStatus(`Converted ${results.length} level${results.length === 1 ? "" : "s"}.`);
        for (const r of results) {
          addResultCard({
            filename: r.filename,
            blob: r.blob,
            meta: `${r.chartCount} difficult${r.chartCount === 1 ? "y" : "ies"} — import as .osz in osu!`,
          });
        }
      }
    } catch (e) {
      setStatus(`Conversion failed: ${e.message}`, "error");
    }
  }

  // --- wiring ---
  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) handleFile(fileInput.files[0]);
  });

  ["dragenter", "dragover"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
    })
  );
  dropzone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  // --- decorative lane-strip animation (4 lanes, staggered falling notes) ---
  (function buildLaneStrip() {
    const el = document.getElementById("laneStrip");
    if (!el) return;
    const colors = ["#FF6FB0", "#FF6FB0", "#C6FF4D", "#C6FF4D"];
    for (let lane = 0; lane < 4; lane++) {
      const laneEl = document.createElement("div");
      laneEl.className = "lane";
      const noteCount = 2;
      for (let i = 0; i < noteCount; i++) {
        const note = document.createElement("div");
        note.className = "note";
        note.style.background = colors[lane];
        note.style.animationDelay = `${lane * 0.35 + i * 1.2}s`;
        laneEl.appendChild(note);
      }
      el.appendChild(laneEl);
    }
  })();
})();
