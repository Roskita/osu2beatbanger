(function () {
  "use strict";

  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const statusArea = document.getElementById("statusArea");
  const optionsArea = document.getElementById("optionsArea");
  const resultsArea = document.getElementById("resultsArea");

  let pendingFile = null;
  let pendingKind = null;

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

  function clearOptions() {
    optionsArea.hidden = true;
    optionsArea.innerHTML = "";
    pendingFile = null;
    pendingKind = null;
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
    clearOptions();
    setStatus(`Reading ${file.name}…`, "working");

    let kind;
    try {
      kind = await BBMania.detectKind(file, JSZip);
    } catch (e) {
      setStatus(`Couldn't read as zip: ${e.message}`, "error");
      return;
    }

    if (kind === "unknown") {
      setStatus(
        "Expected either an osu!mania .osz " +
          "or a Beat Banger mod .zip (containing act.cfg).",
        "error"
      );
      return;
    }

    setStatus(
      kind === "osu"
        ? `Detected an osu!mania beatmap (.osz).`
        : `Detected a Beat Banger mod (.zip).`
    );
    showOptions(file, kind);
  }

  function showOptions(file, kind) {
    pendingFile = file;
    pendingKind = kind;

    optionsArea.hidden = false;
    optionsArea.innerHTML = "";

    const fileInfo = document.createElement("div");
    fileInfo.className = "options-file";
    fileInfo.innerHTML = `File: <strong>${escapeHtml(file.name)}</strong>`;
    optionsArea.appendChild(fileInfo);

    let bgToggle = null;
    let dimSlider = null;
    let dimRow = null;
    let dimModeRow = null;

    // mirroring
    const mirrorRow = document.createElement("div");
    mirrorRow.className = "option-row";
    mirrorRow.innerHTML = `
      <label class="checkbox-row">
        <input type="checkbox" id="mirrorToggle">
        Mirror notes
      </label>
    `;
    optionsArea.appendChild(mirrorRow);
    const mirrorToggle = mirrorRow.querySelector("#mirrorToggle");

    if (kind === "osu") {
      const bgRow = document.createElement("div");
      bgRow.className = "option-row";
      bgRow.innerHTML = `
        <label class="checkbox-row">
          <input type="checkbox" id="bgToggle">
          Include background image
        </label>
      `;
      optionsArea.appendChild(bgRow);
      bgToggle = bgRow.querySelector("#bgToggle");

      dimModeRow = document.createElement("div");
      dimModeRow.className = "option-row dim-mode-row";
      dimModeRow.hidden = true;
      dimModeRow.innerHTML = `
        <label class="radio-row">
          <input type="radio" name="dimMode" value="full" checked>
          Dim entire background
        </label>
        <label class="radio-row">
          <input type="radio" name="dimMode" value="strip">
          Dim center strip 
        </label>
      `;
      optionsArea.appendChild(dimModeRow);

      dimRow = document.createElement("div");
      dimRow.className = "slider-row";
      dimRow.hidden = true;
      dimRow.innerHTML = `
        <label for="dimSlider">Dim amount <span id="dimValue">0%</span></label>
        <input type="range" id="dimSlider" min="0" max="100" value="0" step="1">
      `;
      optionsArea.appendChild(dimRow);
      dimSlider = dimRow.querySelector("#dimSlider");
      const dimValueLabel = dimRow.querySelector("#dimValue");

      bgToggle.addEventListener("change", () => {
        dimModeRow.hidden = !bgToggle.checked;
        dimRow.hidden = !bgToggle.checked;
      });
      dimSlider.addEventListener("input", () => {
        dimValueLabel.textContent = `${dimSlider.value}%`;
      });
    }

    const actionsRow = document.createElement("div");
    actionsRow.className = "options-actions";
    actionsRow.innerHTML = `
      <button class="btn btn-ghost" id="cancelBtn" type="button">Cancel</button>
      <button class="btn btn-primary" id="convertBtn" type="button">Convert</button>
    `;
    optionsArea.appendChild(actionsRow);

    actionsRow.querySelector("#cancelBtn").addEventListener("click", () => {
      clearOptions();
      setStatus(null);
    });

    actionsRow.querySelector("#convertBtn").addEventListener("click", () => {
      const options = {};
      if (kind === "osu") {
        options.includeBackground = !!bgToggle.checked;
        options.dimPercent = bgToggle.checked ? parseInt(dimSlider.value, 10) : 0;
        const modeInput = bgToggle.checked
          ? optionsArea.querySelector('input[name="dimMode"]:checked')
          : null;
        options.dimMode = modeInput ? modeInput.value : "full";
      }
      runConversion(pendingFile, pendingKind, options);
    });
  }

  async function runConversion(file, kind, options) {
    clearResults();
    clearOptions();

    try {
      if (kind === "osu") {
        setStatus("Converting osu!mania map to Beat Banger mod…", "working");
        let warning = null;
        const result = await BBMania.convertOszToBB(file, JSZip, (w) => { warning = w; }, options);
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
        setStatus("Converting Beat Banger mod to osu!mania map", "working");
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

  // uploading
  dropzone.addEventListener("click", () => fileInput.click());
  
  fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) handleFile(fileInput.files[0]);
  });

  dropzone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

})();
