import { Backend } from "@globular/backend";
import { displayError, displayMessage } from "@globular/backend";
import {
  startVideoWorker,
  stopVideoWorker,
  isVideoProcessingRunning,
  setVideoConversion,
  setVideoStreamConversion,
  setStartVideoConversionHour,
  setMaximumVideoConversionDelay,
  getVideoConversionLogs,
  clearVideoConversionLogs,
  getVideoConversionErrors,
  clearVideoConversionError,
  clearVideoConversionErrors,
  listMediaFiles,
  startProcessVideo,
  startProcessAudio,
  convertVideoToHls,
  convertVideoToMpeg4H264,
  getMediaConversionSettings,
} from "@globular/backend";

class MediaSettings extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._listeners = Object.create(null);
    this._mediaCounts = { video: 0, audio: 0 };
    this._mediaTree = null;
  }

  connectedCallback() {
    this.render();
    this.bindEvents();
    this.refreshAll();
    this.subscribeToLiveConversionLogs();
  }

  disconnectedCallback() {
    // cleanly unsubscribe from any event hub listeners
    Object.keys(this._listeners || {}).forEach((k) => {
      try {
        Backend.eventHub.unsubscribe(this._listeners[k]);
      } catch { }
      delete this._listeners[k];
    });
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          color: var(--on-surface-color);
          font-size: 0.85rem;
        }

        .card {
          background:  var(--surface-elevated-color, var(--surface-color));
          color: var(--on-surface-color);
          border: 1px solid var(--palette-divider);
          border-radius: 8px;
          box-shadow: var(--globular-elevation-1, 0 1px 2px rgba(0,0,0,0.16));
          box-sizing: border-box;
         
        }

        #header-row {

        }

        .card-header {

          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px;
          border-bottom: 1px solid var(--border-subtle-color);
          background-color: var(--surface-color);
          border-top-left-radius: 8px;
          border-top-right-radius: 8px;
        }


        h3 {
          margin: 0;
          font-size: 1rem;
          font-weight: 600;
        }

        .status-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 0.78rem;
          padding: 1px 6px;
          border-radius: 999px;
          background: var(--surface-variant-color, rgba(255,255,255,0.03));
          border: 1px solid var(--palette-divider);
          white-space: nowrap;
          height: 24px;
        }
        .status-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: gray;
        }
        .status-dot.running {
          background: #27ae60;
        }
        .status-dot.stopped {
          background: #c0392b;
        }
        .status-dot.fail {
          background: #c0392b;
        }

        /* top area: automatic + tools */
        .sections {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-bottom: 8px;
        }

        .section {
          border: 1px solid var(--palette-divider);
          border-radius: 6px;
          padding: 6px 8px;
          margin: 6px 10px 6px 10px;
        }

        .section-title {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 4px;
          font-size: 0.8rem;
          font-weight: 600;
          opacity: 0.9;
        }

        .section-body {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .row {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          align-items: center;
        }

        label {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 0.8rem;
        }

        label span {
          opacity: 0.8;
          white-space: nowrap;
        }

        .field-group {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }

        input[type="text"],
        input[type="time"] {
          padding: 5px 8px;
          border-radius: 4px;
          border: 1px solid var(--palette-divider);
          background: var(--surface-color);
          color: var(--on-surface-color);
          font-size: 0.82rem;
          min-width: 180px;
        }

        input:focus {
          outline: 1px solid var(--palette-primary-main);
        }

        input[type="checkbox"] {
          width: 14px;
          height: 14px;
        }

        button {
          border: none;
          border-radius: 6px;
          padding: 5px 8px;
          background: var(--palette-primary-main);
          color: var(--palette-primary-contrast);
          cursor: pointer;
          font-size: 0.78rem;
          transition: transform 0.12s ease, background 0.12s ease, opacity 0.12s ease;
          white-space: nowrap;
        }

        button:hover { transform: translateY(-0.5px); background: var(--palette-primary-dark); }
        button:disabled { opacity: 0.55; cursor: not-allowed; }

        .btn-small {
          padding: 3px 6px;
          font-size: 0.75rem;
        }

        .conversion-details {
          margin-top: 3px;
          padding-left: 5px;
          border-left: 2px solid var(--palette-divider);
        }

        /* logs & errors (full width, stacked) */
        .log-sections {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .logs-toolbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 3px;
          gap: 4px;
        }

        .logs-toolbar span {
          font-size: 0.78rem;
          opacity: 0.8;
        }

        .btn-group {
          display: flex;
          gap: 4px;
        }

        .logs-list, .errors-list {
          max-height: 240px;
          overflow: auto;
          border-radius: 4px;
          border: 1px solid var(--palette-divider);
          padding: 4px 5px;
          font-size: 0.74rem;
        }

        .log-row, .error-row {
          display: grid;
          grid-template-columns: minmax(70px, 100px) minmax(180px, 3fr) minmax(120px, 2fr) minmax(60px, 80px) minmax(120px, 2fr);
          gap: 4px;
          align-items: center;
          padding: 2px 0;
          border-bottom: 1px solid rgba(255,255,255,0.03);
        }

        .log-row:last-child, .error-row:last-child {
          border-bottom: none;
        }

        .log-path, .error-path, .log-msg, .error-msg {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .log-name {
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .tag {
          padding: 1px 5px;
          border-radius: 999px;
          border: 1px solid var(--palette-divider);
          font-size: 0.72rem;
        }
        .tag.ok { border-color: #27ae60aa; color: #27ae60; }
        .tag.err { border-color: #c0392baa; color: #c0392b; }

        .empty {
          padding: 3px;
          font-size: 0.76rem;
          opacity: 0.7;
        }

        .tree {
          padding-left: 10px;
          border-left: 2px solid var(--palette-divider);
          font-family: monospace;
          word-break: break-all;
        }

        .tree-node {
          margin: 2px 0;
        }

        .tree-row {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .tree-label {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          cursor: pointer;
          user-select: none;
        }

        .tree-actions {
          display: none;
          gap: 6px;
          margin-left: 8px;
        }

        .tree-row:hover .tree-actions {
          display: flex;
        }

        .tree-actions button {
          border: 1px solid var(--palette-divider);
          background: var(--surface-variant-color, rgba(255,255,255,0.04));
          color: var(--on-surface-color);
          border-radius: 4px;
          padding: 2px 6px;
          font-size: 0.74rem;
          cursor: pointer;
        }

        .caret {
          font-size: 10px;
          width: 10px;
          display: inline-block;
          text-align: center;
          opacity: 0.7;
        }

        .collapsed > .children {
          display: none;
        }

        .tree-leaf {
          color: var(--palette-text-secondary);
        }
      </style>

      <div class="card">
        <div class="card-header">
          <h3>Media Settings</h3>
          <span class="status-badge">
            <span id="worker-dot" class="status-dot"></span>
            <span id="worker-status">Checking…</span>
          </span>
        </div>

        <!-- Top: automatic + tools -->
        <div class="sections">
          <!-- Automatic conversion -->
          <div class="section">
            <div class="section-title">
              <span>Automatic Conversion</span>
              <div class="row">
                <button id="btn-worker-start" class="btn-small">Start</button>
                <button id="btn-worker-stop" class="btn-small">Stop</button>
              </div>
            </div>
            <div class="section-body">
              <div class="row">
                <label>
                  <input id="auto-convert" type="checkbox" />
                  <span>Auto convert to MP4</span>
                </label>
              </div>

              <div class="conversion-details" id="conversion-details" style="display:none">
                <div class="row">
                  <label>
                    <input id="auto-stream" type="checkbox" />
                    <span>Also convert to HLS</span>
                  </label>
                </div>
                <div class="row">
                  <div class="field-group">
                    <label>
                      <span>Start</span>
                      <input id="start-hour" type="time" value="00:00" />
                    </label>
                    <label>
                      <span>Max duration</span>
                      <input id="max-delay" type="time" value="08:00" />
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Media files scan -->
          <div class="section">
            <div class="section-title">
              <span>Media Files</span>
              <div class="row" style="gap:10px;">
                <button id="btn-scan-media" class="btn-small">Scan</button>
                <span id="media-counts" style="font-size:0.78rem; opacity:0.8;"></span>
              </div>
            </div>
            <div class="section-body">
              <div id="media-tree" class="tree">
                <div class="empty">Click "Scan" to list media files.</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Bottom: logs + errors as full-width rows -->
        <div class="log-sections">
          <!-- Logs -->
          <div class="section">
            <div class="section-title">
              <span>Conversion Logs</span>
              <div class="btn-group">
                <button id="btn-logs-reload" class="btn-small">Reload</button>
                <button id="btn-logs-clear" class="btn-small">Clear</button>
              </div>
            </div>
            <div id="logs-list" class="logs-list">
              <div class="empty">No logs loaded yet.</div>
            </div>
          </div>

          <!-- Errors -->
          <div class="section">
            <div class="section-title">
              <span>Conversion Errors</span>
              <div class="btn-group">
                <button id="btn-errors-reload" class="btn-small">Reload</button>
                <button id="btn-errors-clear" class="btn-small">Clear all</button>
              </div>
            </div>
            <div id="errors-list" class="errors-list">
              <div class="empty">No errors loaded yet.</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  bindEvents() {
    const $ = (id) => this.shadowRoot.getElementById(id);

    // automatic conversion controls
    const autoConvert = $("auto-convert");
    const autoStream = $("auto-stream");
    const startHour = $("start-hour");
    const maxDelay = $("max-delay");
    const btnWorkerStart = $("btn-worker-start");
    const btnWorkerStop = $("btn-worker-stop");

    autoConvert?.addEventListener("change", async () => {
      const enabled = !!autoConvert.checked;
      this.toggleConversionDetails(enabled);
      try {
        await setVideoConversion(enabled);
        displayMessage(
          `Automatic video conversion ${enabled ? "enabled" : "disabled"}.`,
          2500
        );
      } catch (err) {
        autoConvert.checked = !enabled;
        this.toggleConversionDetails(autoConvert.checked);
        displayError(err?.message || err, 4000);
      }
    });

    autoStream?.addEventListener("change", async () => {
      const enabled = !!autoStream.checked;
      try {
        await setVideoStreamConversion(enabled);
        displayMessage(
          `Automatic stream conversion ${enabled ? "enabled" : "disabled"}.`,
          2500
        );
      } catch (err) {
        autoStream.checked = !enabled;
        displayError(err?.message || err, 4000);
      }
    });

    startHour?.addEventListener("change", async () => {
      const v = (startHour.value || "00:00").substring(0, 5);
      startHour.value = v;
      try {
        await setStartVideoConversionHour(v);
        displayMessage("Start conversion hour updated.", 2000);
      } catch (err) {
        displayError(err?.message || err, 4000);
      }
    });

    maxDelay?.addEventListener("change", async () => {
      const v = (maxDelay.value || "08:00").substring(0, 5);
      maxDelay.value = v;
      try {
        await setMaximumVideoConversionDelay(v);
        displayMessage("Maximum conversion duration updated.", 2000);
      } catch (err) {
        displayError(err?.message || err, 4000);
      }
    });

    btnWorkerStart?.addEventListener("click", async () => {
      try {
        await startVideoWorker();
        displayMessage("Video conversion worker started.", 2500);
        this.refreshWorkerStatus();
      } catch (err) {
        displayError(err?.message || err, 4000);
      }
    });

    btnWorkerStop?.addEventListener("click", async () => {
      try {
        await stopVideoWorker();
        displayMessage("Video conversion worker stopped.", 2500);
        this.refreshWorkerStatus();
      } catch (err) {
        displayError(err?.message || err, 4000);
      }
    });

    // media files scan
    $("btn-scan-media").onclick = () => this.scanMediaFiles();

    // logs & errors
    $("btn-logs-reload").onclick = () => this.loadLogs();
    $("btn-logs-clear").onclick = async () => {
      try {
        await clearVideoConversionLogs();
        displayMessage("Conversion logs cleared.", 2500);
        this.loadLogs();
      } catch (err) {
        displayError(err?.message || err, 4000);
      }
    };

    $("btn-errors-reload").onclick = () => this.loadErrors();
    $("btn-errors-clear").onclick = async () => {
      try {
        await clearVideoConversionErrors();
        displayMessage("All conversion errors cleared.", 2500);
        this.loadErrors();
      } catch (err) {
        displayError(err?.message || err, 4000);
      }
    };
  }

  toggleConversionDetails(show) {
    const el = this.shadowRoot.getElementById("conversion-details");
    if (!el) return;
    el.style.display = show ? "block" : "none";
  }

  async loadConversionSettings() {
    const autoConvert = this.shadowRoot.getElementById("auto-convert");
    const autoStream = this.shadowRoot.getElementById("auto-stream");
    const startHour = this.shadowRoot.getElementById("start-hour");
    const maxDelay = this.shadowRoot.getElementById("max-delay");

    try {
      const settings = await getMediaConversionSettings();
      if (autoConvert) autoConvert.checked = !!settings.automaticVideoConversion;
      if (autoStream) autoStream.checked = !!settings.automaticStreamConversion;
      if (startHour) startHour.value = (settings.startVideoConversionHour || "00:00").substring(0, 5);
      if (maxDelay) maxDelay.value = (settings.maximumVideoConversionDelay || "00:00").substring(0, 5);

      this.toggleConversionDetails(autoConvert?.checked);
    } catch {
      // fallback to defaults already in DOM
      this.toggleConversionDetails(autoConvert?.checked);
    }
  }

  async refreshAll() {
    await this.loadConversionSettings();
    await this.refreshWorkerStatus();
    await this.loadLogs();
    await this.loadErrors();
  }

  /**
   * Live updates coming from media service (protojson-encoded VideoConversionLog).
   * Keeps the status badge and logs list in sync without manual reload.
   */
  subscribeToLiveConversionLogs() {
    const key = "conversion_log_event";
    if (!Backend?.eventHub?.subscribe) return;

    Backend.eventHub.subscribe(
      key,
      (uuid) => {
        this._listeners[key] = uuid;
      },
      (evt) => {
        this._handleConversionLogEvent(evt);
      },
      false,
      this
    );

    const errKeys = ["conversion_error_event", "conversion_log_error"];
    errKeys.forEach((errKey) => {
      Backend.eventHub.subscribe(
        errKey,
        (uuid) => {
          this._listeners[errKey] = uuid;
        },
        (_evt) => {
          // on any error event, refresh errors list
          this.loadErrors();
        },
        false,
        this
      );
    });
  }

  _handleConversionLogEvent(evt) {
    if (!evt) return;
    const obj = this._decodeConversionLog(evt);
    if (!obj) return;

    const log = {
      logTime: obj.logTime || 0,
      path: obj.path || "",
      status: (obj.status || "").toLowerCase(),
      msg: obj.msg || "",
    };

    this._updateStatusBadgeFromLog(log);
    this._appendLiveLog(log);
  }

  _decodeConversionLog(evt) {
    let obj = evt;

    // Handle envelope objects that may wrap data
    if (obj && typeof obj === "object") {
      if (obj.data && (obj.data instanceof Uint8Array || obj.data instanceof ArrayBuffer || typeof obj.data === "string")) {
        obj = obj.data;
      } else if (obj.payload) {
        obj = obj.payload;
      }
    }

    // If protobuf instance, use getters
    if (obj?.getLogtime || obj?.getLogTime) {
      return {
        logTime:
          (obj.getLogtime && obj.getLogtime()) ||
          (obj.getLogTime && obj.getLogTime()) ||
          0,
        path: obj.getPath ? obj.getPath() : "",
        status: obj.getStatus ? obj.getStatus() : "",
        msg: obj.getMsg ? obj.getMsg() : "",
      };
    }

    // If Uint8Array / ArrayBuffer -> decode to string
    if (obj instanceof Uint8Array || obj instanceof ArrayBuffer) {
      try {
        obj = new TextDecoder().decode(obj);
      } catch {
        return null;
      }
    }

    // If wrapped object with data field
    if (obj?.data && (obj.data instanceof Uint8Array || obj.data instanceof ArrayBuffer)) {
      try {
        obj = new TextDecoder().decode(obj.data);
      } catch {
        return null;
      }
    }

    // If stringified JSON
    if (typeof obj === "string") {
      try {
        obj = JSON.parse(obj);
      } catch {
        return null;
      }
    }

    if (!obj) return null;

    return {
      logTime: obj.logTime || obj.log_time || obj.LogTime || 0,
      path: obj.path || obj.Path || "",
      status: obj.status || obj.Status || "",
      msg: obj.msg || obj.Msg || "",
    };
  }

  _splitPath(path) {
    const clean = (path || "").replace(/\\/g, "/");
    if (!clean) return { dir: "/", name: "" };
    const lastSep = clean.lastIndexOf("/");
    if (lastSep >= 0) {
      return {
        dir: clean.substring(0, lastSep) || "/",
        name: clean.substring(lastSep + 1) || "",
      };
    }
    return { dir: "/", name: clean };
  }

  _logKey(path, msg) {
    return `${path || ""}::${msg || ""}`;
  }

  _updateStatusBadgeFromLog(log) {
    const dot = this.shadowRoot.getElementById("worker-dot");
    const label = this.shadowRoot.getElementById("worker-status");
    if (!dot || !label) return;

    dot.classList.remove("running", "stopped", "fail");

    if (log.status === "running") {
      dot.classList.add("running");
      label.textContent = `Running: ${log.msg || log.path || ""}`.trim();
    } else if (log.status === "fail") {
      dot.classList.add("fail");
      label.textContent = `Failed: ${log.msg || log.path || ""}`.trim();
    } else if (log.status === "done" || log.status === "success") {
      dot.classList.add("running");
      label.textContent = `Completed: ${log.msg || log.path || ""}`.trim();
    } else {
      dot.classList.add("stopped");
      label.textContent = "Worker idle";
    }
  }

  _appendLiveLog(log) {
    const container = this.shadowRoot.getElementById("logs-list");
    if (!container) return;

    if (container.firstElementChild?.classList?.contains("empty")) {
      container.innerHTML = "";
    }

    const timeStr = this._formatLogTime(log.logTime);
    const { dir, name } = this._splitPath(log.path || "");
    const status = log.status || "";
    const key = this._logKey(log.path || "", log.msg || "");

    // replace any existing row with same (path+msg)
    Array.from(container.querySelectorAll(`.log-row[data-key="${key}"]`)).forEach((r) =>
      r.remove()
    );

    const row = document.createElement("div");
    row.classList.add("log-row");
    row.setAttribute("data-path", log.path || "");
    row.setAttribute("data-key", key);
    row.innerHTML = `
      <div class="log-time">${timeStr}</div>
      <div class="log-path" title="${dir}">${dir}</div>
      <div class="log-name" title="${name}">${name}</div>
      <div><span class="tag ${status === "success" || status === "done" ? "ok" : status === "fail" ? "err" : ""}">${status}</span></div>
      <div class="log-msg" title="${log.msg || ""}">${log.msg || ""}</div>
    `;

    // Prepend latest at top
    if (container.firstChild) {
      container.insertBefore(row, container.firstChild);
    } else {
      container.appendChild(row);
    }
  }

  async refreshWorkerStatus() {
    const dot = this.shadowRoot.getElementById("worker-dot");
    const label = this.shadowRoot.getElementById("worker-status");
    const btnStart = this.shadowRoot.getElementById("btn-worker-start");
    const btnStop = this.shadowRoot.getElementById("btn-worker-stop");

    try {
      const running = await isVideoProcessingRunning();
      if (dot) {
        dot.classList.remove("running", "stopped");
        dot.classList.add(running ? "running" : "stopped");
      }
      if (label) {
        label.textContent = running ? "Worker running" : "Worker stopped";
      }
      if (btnStart && btnStop) {
        btnStart.disabled = running;
        btnStop.disabled = !running;
      }
    } catch (err) {
      if (label) {
        label.textContent = "Unable to read status";
      }
      displayError(err?.message || err, 4000);
    }
  }

  async runPathAction(inputEl, fn, successMsg) {
    const path = typeof inputEl === "string" ? inputEl.trim() : inputEl?.value?.trim();
    if (!path) {
      displayError("Please provide a path.", 3000);
      return;
    }
    try {
      await fn(path);
      displayMessage(successMsg, 3000);
    } catch (err) {
      displayError(err?.message || err, 4000);
    }
  }

  _runPathAction(path, fn, msg) {
    return this.runPathAction(path, fn, msg);
  }

  _formatLogTime(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return "";
    const ms = n > 1_000_000_000_000 ? n : n * 1000; // seconds → ms
    const d = new Date(ms);
    return isNaN(d.getTime()) ? "" : d.toLocaleString();
  }

  async loadLogs() {
    const container = this.shadowRoot.getElementById("logs-list");
    if (!container) return;

    container.innerHTML = `<div class="empty">Loading logs…</div>`;
    try {
      const logs = await getVideoConversionLogs();
      if (!logs || logs.length === 0) {
        container.innerHTML = `<div class="empty">No conversion logs.</div>`;
        return;
      }

      // Keep only the latest status per (path + action)
      const latestByKey = new Map();
      logs.forEach((log) => {
        const timeRaw =
          (log.getLogtime && log.getLogtime()) ||
          (log.getLogTime && log.getLogTime()) ||
          "";
        const logTime = Number(timeRaw) || 0;
        const path = log.getPath ? log.getPath() : "";
        const status = log.getStatus ? log.getStatus() : "";
        const msg = log.getMsg ? log.getMsg() : "";
        const key = this._logKey(path, msg);
        const existing = latestByKey.get(key);
        if (!existing || logTime >= existing.logTime) {
          latestByKey.set(key, { logTime, path, status, msg });
        }
      });

      const entries = Array.from(latestByKey.values()).sort(
        (a, b) => (b.logTime || 0) - (a.logTime || 0)
      );

      container.innerHTML = "";
      entries.forEach(({ logTime, path, status, msg }) => {
        const time = this._formatLogTime(logTime);
        const { dir, name } = this._splitPath(path);

        const row = document.createElement("div");
        row.classList.add("log-row");
        row.setAttribute("data-key", this._logKey(path, msg));
        row.innerHTML = `
          <div class="log-time">${time}</div>
          <div class="log-path" title="${dir}">${dir}</div>
          <div class="log-name" title="${name}">${name}</div>
          <div><span class="tag ${status === "success" || status === "done" ? "ok" : "err"}">${status}</span></div>
          <div class="log-msg" title="${msg}">${msg}</div>
        `;
        container.appendChild(row);
      });
    } catch (err) {
      container.innerHTML = `<div class="empty">Failed to load logs.</div>`;
      displayError(err?.message || err, 4000);
    }
  }

  async loadErrors() {
    const container = this.shadowRoot.getElementById("errors-list");
    if (!container) return;

    container.innerHTML = `<div class="empty">Loading errors…</div>`;
    try {
      const errors = await getVideoConversionErrors();
      if (!errors || errors.length === 0) {
        container.innerHTML = `<div class="empty">No conversion errors.</div>`;
        return;
      }

      container.innerHTML = "";
      errors.forEach((errObj) => {
        const path = errObj.getPath ? errObj.getPath() : "";
        const msg = errObj.getError ? errObj.getError() : "";

        const row = document.createElement("div");
        row.classList.add("error-row");
        row.innerHTML = `
          <div></div>
          <div class="error-path" title="${path}">${path}</div>
          <div></div>
          <div class="error-msg" title="${msg}">${msg}</div>
          <div><button class="btn-error-delete btn-small">Del</button></div>
        `;
        const btn = row.querySelector(".btn-error-delete");
        btn?.addEventListener("click", async () => {
          try {
            await clearVideoConversionError(path);
            displayMessage("Error removed, you can retry conversion for that file.", 2500);
            this.loadErrors();
          } catch (err) {
            displayError(err?.message || err, 4000);
          }
        });

        container.appendChild(row);
      });
    } catch (err) {
      container.innerHTML = `<div class="empty">Failed to load errors.</div>`;
      displayError(err?.message || err, 4000);
    }
  }

  // -------- Media files scan helpers --------
  _resetMediaScanState() {
    this._mediaCounts = { video: 0, audio: 0 };
    this._mediaTree = { name: "/", children: Object.create(null), isFile: false };
  }

  async scanMediaFiles() {
    const treeDiv = this.shadowRoot.getElementById("media-tree");
    const countDiv = this.shadowRoot.getElementById("media-counts");
    if (!treeDiv) return;

    this._resetMediaScanState();
    if (countDiv) countDiv.textContent = "Scanning…";
    treeDiv.innerHTML = `<div class="empty">Scanning media files…</div>`;

    try {
      await listMediaFiles(
        (mf) => {
          const path = mf?.getPath ? mf.getPath() : mf.path || "";
          const mediaType = mf?.getMediaType ? mf.getMediaType() : mf.media_type || "";
          if (!path) return;
          this._insertMediaPath(path, mediaType);
          this._mediaCounts[mediaType] = (this._mediaCounts[mediaType] || 0) + 1;
          this._renderMediaCounts();
        },
        () => {
          this._renderMediaTree();
          this._renderMediaCounts();
        }
      );
      // stream resolved -> render final tree
      this._renderMediaTree();
    } catch (err) {
      treeDiv.innerHTML = `<div class="empty">Scan failed: ${err?.message || err}</div>`;
      if (countDiv) countDiv.textContent = "";
    }
  }

  _insertMediaPath(path, mediaType) {
    if (!this._mediaTree) this._resetMediaScanState();
    const parts = path.split("/").filter(Boolean);
    let node = this._mediaTree;
    parts.forEach((p, idx) => {
      if (!node.children[p]) {
        node.children[p] = { name: p, children: Object.create(null), isFile: false };
      }
      node = node.children[p];
      if (idx === parts.length - 1) {
        node.isFile = true;
        node.mediaType = mediaType;
      }
    });
  }

  _renderMediaCounts() {
    const countDiv = this.shadowRoot.getElementById("media-counts");
    if (!countDiv) return;
    const video = this._mediaCounts.video || 0;
    const audio = this._mediaCounts.audio || 0;
    countDiv.textContent = `Video: ${video} | Audio: ${audio}`;
  }

  _isMp4(path) {
    return path.toLowerCase().endsWith(".mp4");
  }

  _createActionButton(label, handler) {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      handler();
    });
    return btn;
  }

  _renderMediaTree() {
    const treeDiv = this.shadowRoot.getElementById("media-tree");
    if (!treeDiv) return;
    if (!this._mediaTree || Object.keys(this._mediaTree.children || {}).length === 0) {
      treeDiv.innerHTML = `<div class="empty">No media files found.</div>`;
      return;
    }
    treeDiv.innerHTML = "";
    const rootFrag = document.createDocumentFragment();
    Object.values(this._mediaTree.children).forEach((child) =>
      rootFrag.appendChild(this._renderTreeNode(child, ""))
    );
    treeDiv.appendChild(rootFrag);
  }

  _renderTreeNode(node, prefix) {
    const div = document.createElement("div");
    div.className = "tree-node";
    const fullPathRaw = prefix ? `${prefix}/${node.name}` : `/${node.name}`;
    const fullPath = fullPathRaw.replace(/\/+/g, "/");
    const isLeaf = node.isFile;
    const childKeys = Object.keys(node.children || {});

    const row = document.createElement("div");
    row.className = "tree-row";

    const label = document.createElement("span");
    label.className = `tree-label ${isLeaf ? "tree-leaf" : ""}`;
    label.title = fullPath;

    const caret = document.createElement("span");
    caret.className = "caret";
    caret.textContent = childKeys.length > 0 ? "›" : "";

    const nameSpan = document.createElement("span");
    nameSpan.textContent = `${node.name}${isLeaf ? "" : "/"}`;
    if (isLeaf && node.mediaType) {
      const typeSpan = document.createElement("span");
      typeSpan.style.opacity = "0.7";
      typeSpan.textContent = ` (${node.mediaType})`;
      nameSpan.appendChild(typeSpan);
    }

    label.appendChild(caret);
    label.appendChild(nameSpan);
    row.appendChild(label);

    // Actions (hover)
    const actions = document.createElement("div");
    actions.className = "tree-actions";
    if (!isLeaf) {
      actions.appendChild(this._createActionButton("Process video", () =>
        this._runPathAction(fullPath, startProcessVideo, "Requested video processing")
      ));
      actions.appendChild(this._createActionButton("Process audio", () =>
        this._runPathAction(fullPath, startProcessAudio, "Requested audio processing")
      ));
    } else if (node.mediaType === "video") {
      if (this._isMp4(fullPath)) {
        actions.appendChild(this._createActionButton("Convert to HLS", () =>
          this._runPathAction(fullPath, convertVideoToHls, "Started HLS conversion")
        ));
      } else {
        actions.appendChild(this._createActionButton("Convert to MP4", () =>
          this._runPathAction(fullPath, convertVideoToMpeg4H264, "Started MP4 conversion")
        ));
      }
    }
    if (actions.children.length > 0) {
      row.appendChild(actions);
    }

    div.appendChild(row);

    if (childKeys.length > 0) {
      const childContainer = document.createElement("div");
      childContainer.className = "children";
      childContainer.style.paddingLeft = "12px";
      childKeys.forEach((k) => {
        const child = node.children[k];
        childContainer.appendChild(this._renderTreeNode(child, fullPath));
      });
      div.appendChild(childContainer);

      // collapsed by default
      div.classList.add("collapsed");
      caret.textContent = "›";

      const toggle = () => {
        const collapsed = div.classList.toggle("collapsed");
        caret.textContent = collapsed ? "›" : "⌄";
      };
      label.addEventListener("click", () => toggle());
      caret.addEventListener("click", (e) => {
        e.stopPropagation();
        toggle();
      });
    }

    return div;
  }
}

customElements.define("globular-media-settings", MediaSettings);
