// <globular-application-info> — lightweight, safe, and reactive
export class ApplicationInfo extends HTMLElement {
  /** @type {null | ReturnType<ApplicationInfo['#normalize']>} */
  _application = null;
  /** @type {ShadowRoot | null} */
  _shadow = null;

  // Cached refs for fast updates
  /** @type {HTMLImageElement | null} */   $icon = null;
  /** @type {HTMLElement | null} */        $id = null;
  /** @type {HTMLElement | null} */        $alias = null;
  /** @type {HTMLElement | null} */        $publisher = null;
  /** @type {HTMLElement | null} */        $description = null;
  /** @type {HTMLElement | null} */        $version = null;
  /** @type {HTMLElement | null} */        $path = null;
  /** @type {HTMLElement | null} */        $empty = null;
  /** @type {HTMLElement | null} */        $container = null;

  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: "open" });
    this._mount();
  }

  connectedCallback() {
    // Initial render if application was set before connectedCallback
    this._render();
  }

  /** Accepts either your getter-based model or a plain object */
  set application(app) {
    const normalized = this.#normalize(app);
    // Avoid needless work if nothing changed (shallow compare on key fields)
    if (this._application &&
        JSON.stringify(this._application) === JSON.stringify(normalized)) {
      return;
    }
    this._application = normalized;
    this._render();
    this.dispatchEvent(new CustomEvent("application-change", { detail: normalized }));
  }

  get application() {
    return this._application;
  }

  // ---------- internals ----------

  _mount() {
    if (!this._shadow) return;

    this._shadow.innerHTML = `
      <style>
        :host { display: block; }
        #container {
          display: flex;
          color: var(--primary-text-color, inherit);
          padding: 15px;
          gap: 20px;
          align-items: flex-start;
        }
        #empty {
          display: none;
          color: var(--secondary-text-color, rgba(0,0,0,.6));
          padding: 10px;
        }
        img {
          height: 80px;
          width: 80px;
          object-fit: contain;
          border-radius: 8px;
          flex-shrink: 0;
          border: 1px solid var(--divider-color, rgba(0,0,0,.12));
          background: var(--surface-variant, transparent);
        }
        .info-table { display: table; border-collapse: separate; border-spacing: 0 6px; }
        .info-row { display: table-row; }
        .info-label {
          display: table-cell; font-weight: 600; padding-right: 14px;
          vertical-align: top; white-space: nowrap; opacity: .9;
        }
        .info-value { display: table-cell; word-break: break-word; }
      </style>

      <div id="empty">No application data available.</div>

      <div id="container" aria-label="Application information">
        <div>
          <img id="icon" alt="Application Icon">
        </div>
        <div class="info-table">
          <div class="info-row"><div class="info-label">Id:</div>
            <div id="id" class="info-value"></div></div>

          <div class="info-row"><div class="info-label">Alias:</div>
            <div id="alias" class="info-value"></div></div>

          <div class="info-row"><div class="info-label">Publisher:</div>
            <div id="publisher" class="info-value"></div></div>

          <div class="info-row"><div class="info-label">Description:</div>
            <div id="description" class="info-value"></div></div>

          <div class="info-row"><div class="info-label">Version:</div>
            <div id="version" class="info-value"></div></div>

          <div class="info-row"><div class="info-label">Path:</div>
            <div id="path" class="info-value"></div></div>
        </div>
      </div>
    `;

    // Cache refs
    this.$icon        = this._shadow.getElementById("icon");
    this.$id          = this._shadow.getElementById("id");
    this.$alias       = this._shadow.getElementById("alias");
    this.$publisher   = this._shadow.getElementById("publisher");
    this.$description = this._shadow.getElementById("description");
    this.$version     = this._shadow.getElementById("version");
    this.$path        = this._shadow.getElementById("path");
    this.$empty       = this._shadow.getElementById("empty");
    this.$container   = this._shadow.getElementById("container");
  }

  _render() {
    if (!this._shadow || !this.$container || !this.$empty) return;

    if (!this._application) {
      this.$container.style.display = "none";
      this.$empty.style.display = "block";
      return;
    }

    this.$empty.style.display = "none";
    this.$container.style.display = "flex";

    // Assign using textContent to avoid HTML injection
    if (this.$icon) this.$icon.src = this._application.icon || "";
    if (this.$id) this.$id.textContent = this._application.id || "";
    if (this.$alias) this.$alias.textContent = this._application.alias || "";
    if (this.$publisher) this.$publisher.textContent = this._application.publisherId || "";
    if (this.$description) this.$description.textContent = this._application.description || "";
    if (this.$version) this.$version.textContent = this._application.version || "";
    if (this.$path) this.$path.textContent = this._application.path || "";
  }

  /**
   * Normalize different shapes into a flat view model the widget understands.
   * Supports your current getter-based API or a plain object with similar keys.
   */
  #normalize(app) {
    if (!app) return null;

    // Prefer getters if present
    const get = (maybeFn, fallback) => {
      try {
        if (typeof maybeFn === "function") return maybeFn.call(app) ?? fallback;
      } catch (_) { /* ignore */ }
      return fallback;
    };

    const byGetter = {
      id:           get(app.getId, undefined),
      alias:        get(app.getAlias, undefined),
      publisherId:  get(app.getPublisherid, undefined) ?? get(app.getPublisherId, undefined),
      description:  get(app.getDescription, undefined),
      version:      get(app.getVersion, undefined),
      path:         get(app.getPath, undefined),
      icon:         get(app.getIcon, undefined),
    };

    // If getters yielded something, use them with fallback to fields
    const byFields = {
      id:           app.id ?? app.Id,
      alias:        app.alias ?? app.Alias,
      publisherId:  app.publisherId ?? app.publisherID ?? app.PublisherId ?? app.PublisherID,
      description:  app.description ?? app.Description,
      version:      app.version ?? app.Version,
      path:         app.path ?? app.Path,
      icon:         app.icon ?? app.Icon,
    };

    const merged = { ...byFields, ...Object.fromEntries(
      Object.entries(byGetter).filter(([, v]) => v !== undefined)
    )};

    // Coerce to strings (avoid null/undefined in the UI)
    for (const k of Object.keys(merged)) {
      if (merged[k] == null) merged[k] = "";
      else merged[k] = String(merged[k]);
    }

    return /** @type {{
      id:string, alias:string, publisherId:string, description:string,
      version:string, path:string, icon:string
    }} */ (merged);
  }
}

if (!customElements.get("globular-application-info")) {
  customElements.define("globular-application-info", ApplicationInfo);
}