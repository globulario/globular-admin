// src/widgets/table.js
import { setResizeable } from "./resizeable";
import getUuidByString from "uuid-by-string";
import { formatDateTimeCustom } from "./utility";
import jmespath from "jmespath";
import orderBy from "lodash/orderBy";

/* ---------- helpers: export ---------- */
function exportToJsonFile(data, filename) {
  const jsonDataStr = JSON.stringify(data, null, 4);
  const blob = new Blob([jsonDataStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportToCsvFile(data, filename) {
  const esc = (v) =>
    typeof v === "string" && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v ?? "";
  const headers = Object.keys(data?.[0] ?? {});
  const lines = [
    headers.join(","), // header row
    ...data.map((row) => headers.map((k) => esc(row[k])).join(",")),
  ];
  const csvContent = "data:text/csv;charset=utf-8," + lines.join("\n");
  const link = document.createElement("a");
  link.setAttribute("href", encodeURI(csvContent));
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/* deep clone a <span> (kept from your version) */
function deepCloneSpan(originalSpan) {
  const clonedSpan = document.createElement("span");
  for (const attr of originalSpan.attributes) clonedSpan.setAttribute(attr.name, attr.value);
  for (const childNode of originalSpan.childNodes) {
    if (childNode.nodeType === Node.ELEMENT_NODE) clonedSpan.appendChild(deepCloneSpan(childNode));
    else if (childNode.nodeType === Node.TEXT_NODE)
      clonedSpan.appendChild(document.createTextNode(childNode.nodeValue));
  }
  return clonedSpan;
}

/* ===========================
   TableFilter (theme-aware)
   =========================== */
export class TableFilter extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });

    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; }

        /* sensible defaults derived from theme */
        :host{
          --tbl-divider: var(--divider-color, color-mix(in srgb, var(--on-surface-color) 14%, transparent));
          --tbl-surface: var(--surface-color);
          --tbl-onsurface: var(--on-surface-color);
          --tbl-muted: color-mix(in srgb, var(--on-surface-color) 70%, transparent);
        }

        #container{
          position: relative;
          display: flex;
          flex-direction: column;
        }

        div[contenteditable]{
          margin: 4px 0;
          border: 1px solid var(--tbl-divider);
          padding: 10px;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono","Courier New", monospace;
          white-space: pre-wrap;
          min-height: 50px;
          background: color-mix(in srgb, var(--tbl-onsurface) 6%, var(--tbl-surface));
          color: var(--tbl-onsurface);
          border-radius: 8px;
          transition: border-color .2s ease, box-shadow .2s ease;
        }
        div[contenteditable].focus{
          border-color: var(--primary-color);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary-color) 20%, transparent);
          outline: none;
        }

        #infos{
          width: 1.1rem; height: 1.1rem;
          color: var(--disabled-text-color, color-mix(in srgb, var(--on-surface-color) 40%, transparent));
          align-self: end;
        }
        #infos:hover{ cursor:pointer; color: var(--primary-color); }

        .infos-panel{
          width: 320px;
          padding: 10px;
          margin: 6px 0 0;
          background: var(--tbl-surface);
          color: var(--tbl-onsurface);
          border-radius: 8px;
          box-shadow: 0 0 0 1px var(--tbl-divider);
          position: absolute; right: 0; top: 22px; z-index: 2;
        }

        #properties{
          display: table; width:100%;
          border-collapse: collapse;
        }
        #properties > div { display: table-row; }
        #properties > div > div{
          display: table-cell; padding: 5px;
          border-bottom: 1px solid var(--tbl-divider);
        }
      </style>

      <div id="container">
        <iron-icon id="infos" icon="icons:info-outline"></iron-icon>
        <div contenteditable id="editor"></div>
      </div>
    `;

    this.editor = this.shadowRoot.getElementById("editor");
    this.infos = this.shadowRoot.getElementById("infos");
    this.infos.onclick = () => {
      const panel = this.shadowRoot.querySelector(".infos-panel");
      const isOpen = panel?.style.display === "block";
      this.infos.style.color = isOpen
        ? "var(--disabled-text-color, color-mix(in srgb, var(--on-surface-color) 40%, transparent))"
        : "var(--primary-color)";
      if (panel) panel.style.display = isOpen ? "none" : "block";
    };

    this.setupEditor();
  }

  setupEditor() {
    this.editor.addEventListener("focus", () => this.editor.classList.add("focus"));
    this.editor.addEventListener("blur", () => this.editor.classList.remove("focus"));
    this.editor.oninput = (evt) => {
      evt.stopPropagation();
      this.update();
    };
  }

  setTable(table, sample) {
    if (this.table) return;
    this.table = table;
    const id = this.table.getAttribute("id");
    if (localStorage.getItem(id + "_query")) this.editor.innerText = localStorage.getItem(id + "_query");
    else if (this.table.query) this.editor.innerText = this.table.query;

    // info panel (theme-friendly)
    const infosPane = `
      <paper-card id="${id}_query_editor_infos" class="infos-panel" style="display:none">
        <h3 style="margin:.25rem 0 .5rem">Filtering</h3>
        <p style="margin:.25rem 0">The table filtering is based on <a href="https://jmespath.org/" target="_blank">JMESPath</a>.</p>
        <p style="margin:.25rem 0">Available fields in each row:</p>
        <div id="properties">
          <div>
            <div style="font-weight:600">Property</div>
            <div style="font-weight:600">Type</div>
          </div>
        </div>
      </paper-card>
    `;
    const range = document.createRange();
    const fragment = range.createContextualFragment(infosPane);
    this.shadowRoot.getElementById("container").appendChild(fragment);

    const properties = this.shadowRoot.getElementById("properties");
    for (const key in sample) {
      if (key.startsWith("_")) continue;
      const row = document.createElement("div");
      row.style.display = "table-row";

      const k = document.createElement("div");
      k.textContent = key;
      const t = document.createElement("div");
      let type = typeof sample[key];
      if (type === "object") {
        if (sample[key] instanceof Date) type = "date";
        else if (Array.isArray(sample[key])) type = "array";
        else type = "object";
      }
      t.textContent = type;
      row.appendChild(k);
      row.appendChild(t);
      properties.appendChild(row);
    }
  }

  update() {
    const query = this.editor.innerText;
    if (query === "") {
      const id = this.table.getAttribute("id");
      localStorage.removeItem(id + "_query");
      this.table.setFiltredData(null);
      return;
    }
    try {
      let q = query;
      if (q.indexOf(".{") !== -1) q = q.replace(".{", ".{ _index:_index,");
      const id = this.table.getAttribute("id");
      localStorage.setItem(id + "_query", query);
      const result = jmespath.search(this.table._data, q);
      this.table.setFiltredData(result);
    } catch (e) {
      console.log(e);
      this.table.setFiltredData(null);
    }
  }

  connectedCallback() {}
}
customElements.define("globular-table-filter", TableFilter);

/* ===========================
   TableSorter (theme-aware)
   =========================== */
export class TableSorter extends HTMLElement {
  constructor(table, field) {
    super();
    this.id = "_" + getUuidByString(field);
    this.table = table;
    this.field = field;
    this.sortIndex = -1;
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `
      <style>
        #container{
          display:inline-flex;
          align-items:center;
          gap:.25rem;
          height: 24px;
          color: var(--disabled-text-color, color-mix(in srgb, var(--on-surface-color) 40%, transparent));
        }
        iron-icon{ width:1rem; height:1rem; }
        #container:hover{ color: var(--primary-color); cursor:pointer; }
        #index{ font-size:.65rem; display:none; }
      </style>
      <div id="container">
        <iron-icon icon="icons:swap-vert"></iron-icon>
        <span id="index"></span>
      </div>
    `;
    const container = this.shadowRoot.querySelector("#container");
    const sortBtn = this.shadowRoot.querySelector("iron-icon");
    const indexSpan = this.shadowRoot.querySelector("#index");
    this.sortOrder = "";
    this.sortIndex = -1;

    sortBtn.onclick = () => {
      if (this.sortOrder === "") {
        this.sortOrder = "asc";
        sortBtn.setAttribute("icon", "icons:arrow-upward");
        container.style.color = "var(--primary-color)";
        indexSpan.style.display = "inline";
      } else if (this.sortOrder === "asc") {
        this.sortOrder = "desc";
        sortBtn.setAttribute("icon", "icons:arrow-downward");
        container.style.color = "var(--primary-color)";
        indexSpan.style.display = "inline";
      } else {
        this.sortOrder = "";
        sortBtn.setAttribute("icon", "icons:swap-vert");
        container.style.color =
          "var(--disabled-text-color, color-mix(in srgb, var(--on-surface-color) 40%, transparent))";
        indexSpan.style.display = "none";
        this.sortIndex = -1;
      }
      this.table.sort(this.sortOrder, this.field);
    };
  }

  setIndex(index) {
    const sortBtn = this.shadowRoot.querySelector("iron-icon");
    const indexSpan = this.shadowRoot.querySelector("#index");
    const container = this.shadowRoot.querySelector("#container");

    if (index === -1) {
      this.sortOrder = "";
      sortBtn.setAttribute("icon", "icons:swap-vert");
      container.style.color =
        "var(--disabled-text-color, color-mix(in srgb, var(--on-surface-color) 40%, transparent))";
      this.sortIndex = -1;
      indexSpan.innerHTML = "";
      indexSpan.style.display = "none";
    } else {
      this.sortIndex = index;
      indexSpan.innerHTML = String(index + 1);
      indexSpan.style.display = "inline";
    }
  }
}
customElements.define("globular-table-sorter", TableSorter);

/* ===========================
   Table (theme-aware)
   =========================== */
export class Table extends HTMLElement {
  constructor(data) {
    super();
    this._data = Array.isArray(data) ? data : [];
    this._pendingData = null;   // queued data if setData() called before connected
    this._domReady = false;     // guard to init DOM once
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    if (this._domReady) return;

    this.displayIndex = this.hasAttribute("display-index");
    this.width = this.getAttribute("width") || "100%";
    this.headerBackgroundColor = this.getAttribute("header-background-color") || "var(--surface-color)";
    this.headerTextColor = this.getAttribute("header-text-color") || "var(--on-surface-color)";
    if (this.hasAttribute("query")) this.query = this.getAttribute("query");

    this.shadowRoot.innerHTML = `
      <style>
        :host{
          --tbl-divider: var(--divider-color, color-mix(in srgb, var(--on-surface-color) 14%, transparent));
          --tbl-surface: var(--surface-color);
          --tbl-onsurface: var(--on-surface-color);
          --tbl-hover: color-mix(in srgb, var(--on-surface-color) 8%, transparent);
          --tbl-header-bg: ${this.headerBackgroundColor};
          --tbl-header-fg: ${this.headerTextColor};
        }

        #table-container{
          display:flex;
          width:fit-content;
          overflow:hidden;
          position:relative;
          padding-bottom:1px;
          background: var(--tbl-surface);
          color: var(--tbl-onsurface);
        }

        #fake-scroll{ overflow-y:auto; flex-grow:1; height:100%; }
        #fake-scroll-div{ width:1px; padding-top:1px; }


        /* Firefox */
        #fake-scroll {
          scrollbar-width: thin;
          scrollbar-color: var(--scroll-thumb) var(--scroll-track);
        }

        /* Chromium/WebKit */
        #fake-scroll::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }
        #fake-scroll::-webkit-scrollbar-track {
          background: var(--scroll-track);
        }
        #fake-scroll::-webkit-scrollbar-thumb {
          background-color: var(--scroll-thumb);
          border-radius: 6px;
          border: 2px solid var(--scroll-track);
        }
        #fake-scroll::-webkit-scrollbar-thumb:hover {
          background-color: var(--scroll-thumb-hover);
        }

        table {
          width:${this.width};
          table-layout: fixed;
          border-collapse: collapse;
          background: var(--tbl-surface);
          color: var(--tbl-onsurface);
        }

        th, td{
          padding: 8px;
          max-height: 60px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          border: 1px solid var(--tbl-divider);
        }

        th{
          position:relative;
          overflow:visible;
          padding-left: 24px;
          background: var(--tbl-header-bg);
          color: var(--tbl-header-fg);
        }

        thead{
          position: sticky;
          top: 0;
          z-index: 1;
        }

        tbody tr:hover td{
          background: var(--tbl-hover);
        }

        globular-table-sorter{
          position:absolute;
          left:2px; top:2px; bottom:0;
          width:10px;
          cursor: col-resize;
          z-index:2;
        }

        th::after{
          content:"";
          position:absolute;
          top:0; right:-5px; bottom:0;
          width:10px; cursor: col-resize; z-index:1;
        }

        #menu { z-index:2; }

        #header{
          background: var(--tbl-header-bg);
          color: var(--tbl-header-fg);
          display:flex; align-items:center;
          padding: 8px;
          border-top-left-radius: 8px;
          border-top-right-radius: 8px;
          box-shadow: inset 0 -1px 0 0 var(--tbl-divider);
        }

        #container{
          display:flex; flex-direction:column;
          background: transparent;
          color: var(--tbl-onsurface);
          width:fit-content;
        }

        #title{ flex-grow:1; }

        #filter-btn{
          color: var(--disabled-text-color, color-mix(in srgb, var(--tbl-onsurface) 40%, transparent));
        }
      </style>

      <div id="container">
        <div id="header">
          <globular-dropdown-menu id="menu" icon="icons:more-vert">
            <globular-dropdown-menu-item id="export-json" icon="icons:file-download" text="Export as JSON"></globular-dropdown-menu-item>
            <globular-dropdown-menu-item id="export-csv" icon="icons:file-download" text="Export as CSV"></globular-dropdown-menu-item>
            <globular-dropdown-menu-item id="clear-sorters" icon="icons:sort" text="Clear Sort"></globular-dropdown-menu-item>
          </globular-dropdown-menu>
          <div id="title"><slot name="title"></slot></div>
          <paper-icon-button id="filter-btn" icon="icons:filter-list" title="Set filter"></paper-icon-button>
        </div>

        <iron-collapse id="filter-panel">
          <globular-table-filter></globular-table-filter>
        </iron-collapse>

        <div id="table-container">
          <table>
            <thead><tr id="table-header"></tr></thead>
            <tbody id="table-body"></tbody>
          </table>
          <div id="fake-scroll"><div id="fake-scroll-div"></div></div>
        </div>

        <slot name="fields" style="display:none;"></slot>
      </div>
    `;

    // Refs
    this.table = this.shadowRoot.querySelector("table");
    this.tableContainer = this.shadowRoot.getElementById("table-container");
    this.tableBody = this.shadowRoot.getElementById("table-body");
    this.tableHeader = this.shadowRoot.getElementById("table-header");
    this.fakeScrool = this.shadowRoot.getElementById("fake-scroll");
    this.fakeScroolDiv = this.shadowRoot.getElementById("fake-scroll-div");
    this.filterPanel = this.shadowRoot.getElementById("filter-panel");
    this.filterBtn = this.shadowRoot.getElementById("filter-btn");
    this.filter = this.shadowRoot.querySelector("globular-table-filter");

    /* actions */
    this.shadowRoot.querySelector("#export-json").onclick = () => {
      let filename = this.getTitle() || "data";
      filename = filename.replace(/ /g, "_").toLowerCase() + ".json";
      exportToJsonFile(this.getData(), filename);
    };
    this.shadowRoot.querySelector("#export-csv").onclick = () => {
      let filename = this.getTitle() || "data";
      filename = filename.replace(/ /g, "_").toLowerCase() + ".csv";
      exportToCsvFile(this.getData(), filename);
    };
    this.shadowRoot.querySelector("#clear-sorters").onclick = () => this.clearSorters();
    this.filterBtn.onclick = () => this.filterPanel.toggle();

    if (this.hasAttribute("width")) {
      setResizeable(this.tableContainer, (width, height) => {
        this.width = width + "px";
        this.table.style.width = this.width;
        this.visibleDataCount = Math.floor(height / this.rowHeight) - 1;
        if (this.hasAttribute("id")) {
          const id = this.getAttribute("id");
          localStorage.setItem(id + "_width", this.width);
          localStorage.setItem(id + "_visible_data_count", this.visibleDataCount);
        }
        this.resize();
      });
    }

    this.fakeScrool.onscroll = (evt) => {
      const scrollPosition = evt.target.scrollTop;
      const firstVisibleRowIndex = Math.floor(scrollPosition / this.rowHeight);
      if (firstVisibleRowIndex + this.visibleDataCount > this.getTotalDataCount()) {
        this.loadDataInRange(firstVisibleRowIndex, this.getTotalDataCount() - 1);
      } else {
        this.loadDataInRange(firstVisibleRowIndex, firstVisibleRowIndex + this.visibleDataCount);
      }
    };

    this.tableBody.onmousewheel = (event) => {
      const delta = Math.max(-1, Math.min(1, event.wheelDelta || -event.detail));
      this.fakeScrool.scrollTop += delta * 30;
      event.preventDefault();
    };

    this.visibleDataCount = this.hasAttribute("visible-data-count")
      ? parseInt(this.getAttribute("visible-data-count"))
      : 20;

    // 🔸 Re-render when the <slot name="fields"> content arrives (fixes the missing columns)
    const fieldsSlot = this.shadowRoot.querySelector('slot[name="fields"]');
    if (fieldsSlot) {
      fieldsSlot.addEventListener('slotchange', () => {
        if (!this._domReady) return;
        const data = this._pendingData || this._data;
        if (Array.isArray(data) && data.length > 0) {
          this._applyData(data);
          this._pendingData = null;
        }
      });
    }

    this._domReady = true;

    // Apply any data queued before connection, else apply initial _data if present
    if (this._pendingData) {
      this._applyData(this._pendingData);
      this._pendingData = null;
    } else if (this._data && this._data.length > 0) {
      this._applyData(this._data);
    }
  }

  getTitle() {
    const slot = this.shadowRoot.querySelector('slot[name="title"]');
    const nodes = slot.assignedNodes();
    return nodes.length ? nodes[0].textContent : "";
  }

  resize() {
    if (!this.tableContainer) return;

    if (this.hasAttribute("id")) {
      const id = this.getAttribute("id");
      const width = localStorage.getItem(id + "_width");
      if (width !== null) {
        this.width = width;
        this.table.style.width = this.width;
      }
      const vdc = localStorage.getItem(id + "_visible_data_count");
      if (vdc !== null) this.visibleDataCount = parseInt(vdc);
    }

    const start = this.currentIndex ?? 0;
    const count = Math.min(this.visibleDataCount, this.getTotalDataCount());
    this.loadDataInRange(start, start + count);
    this.fakeScroolDiv.style.height = `${(this.getTotalDataCount() + 1) * this.rowHeight}px`;

    const rows = this.tableBody.querySelectorAll("tr");
    if (rows.length >= this.visibleDataCount) {
      this.tableContainer.style.height = `${(this.visibleDataCount + 1) * this.rowHeight}px`;
    }
  }

  getTotalDataCount() {
    return this.getData().length;
  }

  loadRow(index) {
    const newRow = document.createElement("tr");
    newRow.setAttribute("index", index);
    const data = this.getData()[index];
    if (!data) return;

    const headers = this.tableHeader.querySelectorAll("th");
    for (let i = 0; i < headers.length; i++) {
      const property = headers[i].field;
      const cell = document.createElement("td");

      if (data[property] !== undefined) {
        let value = data[property];
        if (typeof value === "object") {
          if (value instanceof Date) {
            if (headers[i].firstChild.hasAttribute("format")) {
              const format = headers[i].firstChild.getAttribute("format");
              value = formatDateTimeCustom(value, format);
            } else value = value.toLocaleString();
          } else value = JSON.stringify(value);
        }
        if (property === "_index") value = data[property] + 1;
        cell.innerHTML = value;
      } else {
        const fnName = property;
        const fn = window[fnName];
        if (typeof fn === "function") {
          const row = data;
          data[property] = fn(row);
          cell.innerHTML = data[property]?.toString?.() ?? "";
        } else {
          console.error(`${fnName} is not a valid function.`);
          cell.innerHTML = ""; // fallback
        }
      }
      newRow.appendChild(cell);

      cell.addEventListener("click", () => {
        const row = this.getData()[index];
        this.dispatchEvent(new CustomEvent("row-click", { detail: row }));
      });
    }
    this.tableBody.appendChild(newRow);
  }

  initHeader(sampleRow) {
    this.tableHeader.innerHTML = "";
    let id = "";

    if (!this.hasAttribute("id")) {
      for (const property in sampleRow) id += property + " ";
      id = "_" + getUuidByString(id);
      this.setAttribute("id", id);
    } else id = this.getAttribute("id");

    if (this.displayIndex) {
      const cell = document.createElement("th");
      cell.innerHTML = "<span>#</span>";
      cell.field = "_index";
      this.tableHeader.appendChild(cell);
      cell.setAttribute("id", id + "_index");
      const saved = localStorage.getItem(id + "_index_width");
      if (saved) cell.style.width = saved;
      const sorter = new TableSorter(this, "_index");
      cell.appendChild(sorter);
    }

    const fields = [];
    const fieldsSlot = this.shadowRoot.querySelector('slot[name="fields"]');
    const provided = fieldsSlot
      ? Array.from(fieldsSlot.assignedNodes()).filter((n) => n instanceof Element)
      : [];

    if (provided.length === 0) {
      for (const property in sampleRow) {
        const span = document.createElement("span");
        span.setAttribute("field", property);
        span.innerHTML = property;
        fields.push(span);
      }
    } else {
      for (let i = 0; i < provided.length; i++) {
        const field = provided[i].getAttribute("field");
        if (sampleRow[field] !== undefined) {
          fields.push(deepCloneSpan(provided[i]));
        } else if (window[field] && this._data.filter((d) => d._visible === false).length === 0) {
          fields.push(deepCloneSpan(provided[i]));
        }
      }
    }

    for (let i = 0; i < fields.length; i++) {
      const property = fields[i].getAttribute("field");
      const cell = document.createElement("th");
      cell.setAttribute("id", id + "_" + property);
      cell.field = property;
      cell.appendChild(fields[i]);
      this.tableHeader.appendChild(cell);
      const saved = localStorage.getItem(id + "_" + property + "_width");
      if (saved) cell.style.width = saved;
      const sorter = new TableSorter(this, property);
      cell.appendChild(sorter);
    }

    /* resize handles */
    let isResizing = false;
    let startX, startWidth, header;
    const headers = this.tableHeader.querySelectorAll("th");

    if (this.hasAttribute("row-height")) this.rowHeight = parseInt(this.getAttribute("row-height"));
    else this.rowHeight = this.tableHeader.offsetHeight;

    this.tableHeader.style.height = this.rowHeight + "px";

    const handleMouseMove = (event) => {
      if (!isResizing) return;
      const width = startWidth + (event.clientX - startX);
      header.style.width = width + "px";
      if (header.hasAttribute("id")) {
        const id = header.getAttribute("id");
        localStorage.setItem(id + "_width", width + "px");
      }
    };
    const handleMouseUp = () => {
      isResizing = false;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      this.style.cursor = "default";
    };

    headers.forEach((th) => {
      th.onmousedown = (event) => {
        const threshold = 5;
        const distanceFromRight = th.getBoundingClientRect().right - event.clientX;
        if (distanceFromRight <= threshold) {
          header = th;
          startX = event.clientX;
          startWidth = th.clientWidth;
          isResizing = true;
          document.addEventListener("mousemove", handleMouseMove);
          document.addEventListener("mouseup", handleMouseUp);
          this.style.cursor = "col-resize";
        }
      };
    });

    this.resize();
  }

  loadDataInRange(firstVisibleRowIndex, lastVisibleRowIndex) {
    this.currentIndex = firstVisibleRowIndex;

    if (this.tableHeader.querySelectorAll("th").length === 0) {
      const firstRow = this.getData()[0];
      if (firstRow) {
        this.initHeader(firstRow);
        const id = this.getAttribute("id");
        const saved = localStorage.getItem(id + "_visible_data_count");
        if (saved) lastVisibleRowIndex = parseInt(saved);
      } else {
        return; // nothing to render yet
      }
    }

    this.tableBody.innerHTML = "";
    lastVisibleRowIndex = Math.min(lastVisibleRowIndex, this.getData().length);
    for (let i = firstVisibleRowIndex; i <= lastVisibleRowIndex - 1; i++) this.loadRow(i);
  }

  getData() {
    return Array.isArray(this._data) ? this._data.filter((d) => d._visible) : [];
  }

  setFiltredData(result) {
    if (result == null || result.length === 0) {
      this._data.forEach((d) => (d._visible = result == null));
      if (this._data[0]) this.initHeader(this._data[0]);
      const btn = this.shadowRoot.querySelector("#filter-btn");
      if (btn) btn.style.color = "";
    } else {
      this._data.forEach((d) => (d._visible = false));
      result.forEach((d) => {
        this._data[d._index]._visible = true;
      });
      this.initHeader(result[0]);
      const btn = this.shadowRoot.querySelector("#filter-btn");
      if (btn) btn.style.color = "var(--on-primary-color)";
    }

    this.tableBody.innerHTML = "";
    this.currentIndex = 0;
    this.loadDataInRange(this.currentIndex, this.visibleDataCount);
    this.resize();
  }

  /** Public API — safe pre/post connect */
  setData(data) {
    this._data = Array.isArray(data) ? data : [];

    if (!this._domReady) {
      // Queue until connected
      this._pendingData = this._data;
      return;
    }
    this._applyData(this._data);
  }

  /** Internal: full render pass for given data */
  _applyData(data) {
    const rows = Array.isArray(data) ? data : [];
    if (rows.length > 0) this.initHeader(rows[0]);

    rows.forEach((d, index) => {
      d._index = index;
      d._visible = true;

      const headers = this.tableHeader.querySelectorAll("th");
      for (let i = 0; i < headers.length; i++) {
        const property = headers[i].field;
       
        if (window[property]){
          //d[property] = window[property](d)
        };
      }
    });

    if (this.filter && rows[0]) this.filter.setTable(this, rows[0]);

    this.tableBody.innerHTML = "";
    this.currentIndex = 0;
    this.loadDataInRange(this.currentIndex, this.visibleDataCount);
    this.resize();

    if (this.filter) this.filter.update();
    this.dispatchEvent(new CustomEvent("ready", { bubbles: true }));
  }

  clearSorters() {
    const sorters = Array.from(this.tableHeader.querySelectorAll("globular-table-sorter"));
    sorters.forEach((s) => s.setIndex(-1));
    this._data = orderBy(this._data, ["_index"], ["asc"]);
    this.resize();
  }

  sort(order, field) {
    let sorters = Array.from(this.tableHeader.querySelectorAll("globular-table-sorter")).filter(
      (item) => item.sortIndex != -1
    );
    const sorter = this.shadowRoot.querySelector("#_" + getUuidByString(field));

    if (order !== "") {
      const idx = sorters.findIndex((s) => s.id == sorter.id);
      if (idx === -1) sorters.push(sorter);
      sorter.setIndex(sorters.length - 1);
    } else {
      if (sorters.length == 0) {
        this._data = orderBy(this._data, ["_index"], ["asc"]);
        this.resize();
        return;
      }
    }

    sorters.sort((a, b) => a.sortIndex - b.sortIndex);
    sorters.forEach((s, index) => s.setIndex(index));

    this._data = orderBy(
      this._data,
      sorters.map((s) => s.field),
      sorters.map((s) => s.sortOrder)
    );
    this.resize();
  }
}

customElements.define("globular-table", Table);
