// src/components/informations/informationsManager.js
import getUuidByString from "uuid-by-string";

import { AudioInfo } from "./audioInfo.js";
import { VideoInfo } from "./videoInfo.js";
import { TitleInfo } from "./titleInfo.js";
import { BlogPostInfo } from "./blogPostInfo.js";
import { FileInfo } from "./fileInfo.js";

import { Backend } from "@globular/backend";

import "@polymer/paper-icon-button/paper-icon-button.js";
import "@polymer/iron-icon/iron-icon.js";

/**
 * <globular-informations-manager>
 * Hosts one info widget at a time (audio/video/title/blog/file),
 * shows a header, and auto-closes on delete events.
 */
export class InformationsManager extends HTMLElement {
  // State
  _isShortMode = false;
  _onclose = null;
  _listeners = Object.create(null);

  // DOM refs
  _closeButton = null;
  _titleDiv = null;
  _refreshButton = null;
  _activeInfoComponent = null;

  static get observedAttributes() {
    return ["short", "show-synopsis", "hide-genres", "hide-header", "compact-synopsis"];
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this._isShortMode = this.hasAttribute("short");
    this._renderShell();
    this._cacheDom();
    this._bindDom();
    this._subscribeDeletionEvents();
    this._updateHeaderVisibility();
  }

  disconnectedCallback() {
    // Unsubscribe all event hub listeners
    for (const key of Object.keys(this._listeners)) {
      try {
        Backend.eventHub.unsubscribe(this._listeners[key]);
      } catch {}
      delete this._listeners[key];
    }
  }

  attributeChangedCallback(name, _old, val) {
    if (name === "short" || name === "hide-header") {
      this._isShortMode = this.hasAttribute("short")
        ? (val === "" || val === "true" || val === "1")
        : false;
      this._updateHeaderVisibility();
    } else if (name === "show-synopsis" || name === "hide-genres" || name === "compact-synopsis") {
      this._applyChildPreferences(this._activeInfoComponent);
    }
  }

  set onclose(fn) {
    this._onclose = typeof fn === "function" ? fn : null;
  }
  get onclose() {
    return this._onclose;
  }

  /* -------------------------------------------------------------
   * Render shell & header
   * ----------------------------------------------------------- */
  _renderShell() {
    this.shadowRoot.innerHTML = `
      <style>

        :host {
          display: flex;
          flex-direction: column;
          width: 100%;
          height: 100%;
          min-height: 0;
          overflow: hidden;
          background: var(--surface-color);
          color: var(--primary-text-color);
          scrollbar-width: thin;
          scrollbar-color: var(--scroll-thumb, var(--palette-divider))
                          var(--scroll-track, var(--surface-color));
        }

        /* Chrome/WebKit */
        :host::-webkit-scrollbar {
          width: 10px;
        }
        :host::-webkit-scrollbar-track {
          background: var(--scroll-track, var(--surface-color));
        }
        :host::-webkit-scrollbar-thumb {
          background: var(--scroll-thumb, var(--palette-divider));
          border-radius: 6px;
        }

        #container {
          display: flex;
          flex-direction: column;
          padding: 8px;
          z-index: 100;
          flex: 1 1 auto;
          min-height: 0;
          background: var(--surface-elevated-color, var(--surface-color));
          color: var(--primary-text-color);
          font-size: 1rem; user-select: none;
        }
        #container > slot {
          flex: 1 1 auto;
          min-height: 0;
          display: flex;
        }
        ::slotted(*) {
          flex: 1 1 auto;
          min-height: 0;
          display: flex;
          width: 100%;
          flex-direction: column;
        }
        #header {
          display: flex; align-items: center;
          line-height: 20px; padding-bottom: 10px;
          border-bottom: 2px solid var(--divider-color, var(--palette-divider));
          margin-bottom: 10px;
        }
        #header paper-icon-button {
          min-width: 40px; color: var(--secondary-text-color, var(--primary-text-color));
        }
        #header paper-icon-button:hover { color: var(--primary-color); }

        .title-div {
          display: flex; flex-direction: row; gap: 10px; align-items: center;
          justify-content: space-between;
          flex-grow: 1; color: var(--primary-text-color);
        }
        .title-wrap { display:flex; flex-direction:column; flex:1; min-width:0; }
        .title-main-text { font-size: 1.55rem; font-weight: 700; margin: 0; }
        .title-sub-text { font-size: 1.1rem; color: var(--secondary-text-color); margin-top: 5px; }
      </style>
      <div id="container">
        <div id="header">
          <div class="title-div">
            <div class="title-wrap">
              <!-- filled by _setHeader -->
            </div>
            <paper-icon-button id="title-refresh-button" icon="icons:refresh" title="Refresh title info" style="display:none;"></paper-icon-button>
          </div>
          <paper-icon-button id="close-button" icon="close"></paper-icon-button>
        </div>
        <slot></slot>
      </div>
    `;
  }

  _cacheDom() {
    this._closeButton = this.shadowRoot.querySelector("#close-button");
    this._titleDiv = this.shadowRoot.querySelector(".title-div");
    this._refreshButton = this.shadowRoot.querySelector("#title-refresh-button");
  }

  _bindDom() {
    if (this._closeButton) {
      this._closeButton.addEventListener("click", () => this._closeSelf());
    }
    if (this._refreshButton) {
      this._refreshButton.addEventListener("click", () => this._handleTitleRefresh());
    }
  }

  _updateHeaderVisibility() {
    const hideHeader = this.hasAttribute("hide-header");
    if (this._closeButton) {
      this._closeButton.style.display = this._isShortMode ? "none" : "";
      if (hideHeader) {
        this._closeButton.style.display = "none";
      }
    }
    if (this._refreshButton) {
      this._updateRefreshButtonVisibility(this._activeInfoComponent);
    }
    const header = this.shadowRoot.querySelector("#header");
    if (header) {
      header.style.display = hideHeader ? "none" : "";
    }
  }

  _handleTitleRefresh() {
    const cmp = this._activeInfoComponent;
    if (!cmp || typeof cmp.refreshServerInfo !== "function") return;
    if (this._refreshButton) this._refreshButton.disabled = true;

    const refreshPromise = cmp.refreshServerInfo();
    if (refreshPromise && typeof refreshPromise.then === "function") {
      refreshPromise
        .catch((err) => {
          console.error("Title refresh failed:", err);
        })
        .finally(() => {
          if (this._refreshButton) this._refreshButton.disabled = false;
        });
    } else if (this._refreshButton) {
      this._refreshButton.disabled = false;
    }
  }

  _updateRefreshButtonVisibility(component) {
    if (!this._refreshButton) return;
    const isTitleInfo =
      component && component.tagName && component.tagName.toLowerCase() === "globular-title-info";
    this._refreshButton.style.display =
      isTitleInfo && !this._isShortMode ? "" : "none";
    if (!isTitleInfo && this._refreshButton.disabled) {
      this._refreshButton.disabled = false;
    }
  }

  _setHeader(mainTitle, subTitle = "", icon = "") {
    const wrapper = this._titleDiv?.querySelector(".title-wrap");
    if (!wrapper) return;
    const iconHtml = icon
      ? `<iron-icon icon="${icon}" style="margin-right:4px;"></iron-icon>`
      : "";
    wrapper.innerHTML = `
      ${iconHtml}
      <span class="title-main-text">${mainTitle || "Info"}</span>
      ${subTitle ? `<span class="title-sub-text">${subTitle}</span>` : ""}
    `;
  }

  _clearContent() {
    // Clear slotted children (host DOM) and header text
    this.innerHTML = "";
    const wrapper = this._titleDiv?.querySelector(".title-wrap");
    if (wrapper) wrapper.innerHTML = "";
    this._activeInfoComponent = null;
    this._updateRefreshButtonVisibility(null);
  }

  _closeSelf() {
    if (this._onclose) this._onclose();
  }

  /* -------------------------------------------------------------
   * Event subscriptions (delete events)
   * ----------------------------------------------------------- */
  _subscribeDeletionEvents() {
    // Centralized event hub (matches how other updated components use Backend.eventHub)
    const topics = [
      // Keep names in sync with your server-side publish conventions.
      // Adjust if your hub uses different topic strings.
      "delete_audio_event",
      "delete_video_event",
      "delete_title_event",
      "delete_blog_post_event",
      "delete_file_event",
    ];

    for (const topic of topics) {
      if (this._listeners[topic]) continue;
      // subscribe(topic, onSubId, onMessage, retain, ctx)
      const subId = Backend.eventHub.subscribe(
        topic,
        (uuid) => {
          this._listeners[topic] = uuid;
        },
        (msg) => {
          // msg can be string id or an object with different id field shapes
          const id =
            (typeof msg === "string" && msg) ||
            (msg && (msg.id || msg.uuid || msg.postId || msg.titleId || msg.filePath)) ||
            null;
          if (!id) return;

          // If the displayed child matches that id, close this panel.
          const child = this.querySelector(`#_${getUuidByString(id)}`);
          if (child) this._closeSelf();
        },
        false,
        this
      );
      // In case the hub returns the id directly
      if (typeof subId === "string") this._listeners[topic] = subId;
    }
  }

  /* -------------------------------------------------------------
   * Child plumbing
   * ----------------------------------------------------------- */
  _applyChildPreferences(component) {
    if (!component) return;
    const map = [
      ["show-synopsis", "show-synopsis"],
      ["hide-genres", "hide-genres"],
      ["compact-synopsis", "compact-synopsis"],
    ];
    map.forEach(([attr, forward]) => {
      if (this.hasAttribute(attr)) {
        component.setAttribute(forward, "true");
      } else {
        component.removeAttribute(forward);
      }
    });
  }

  _appendInfo(component, data, dataId) {
    // Track by deterministic id for delete-event matching
    if (dataId) component.id = `_${getUuidByString(dataId)}`;

    // Pass "short" mode as attribute (most of your info widgets observe 'short')
    if (this._isShortMode) component.setAttribute("short", "true");
    else component.removeAttribute("short");

    this._applyChildPreferences(component);

    // Some of your widgets expect a `.globule` on the data; preserve if present
    if (data && data.globule) component.globule = data.globule;

    // Bind a generic ondelete hook if child exposes it
    component.ondelete = () => this._closeSelf();

    this.appendChild(component);
    this._activeInfoComponent = component;
    this._updateRefreshButtonVisibility(component);

    if (component && component.tagName && component.tagName.toLowerCase() === "globular-title-info") {
      component.addEventListener("title-refreshed", (evt) => {
        const refreshedTitle = evt?.detail?.title;
        if (refreshedTitle) {
          const main = (refreshedTitle.getName && refreshedTitle.getName()) || "Title";
          const sub = refreshedTitle.getYear ? String(refreshedTitle.getYear()) : "";
          this._setHeader(main, sub, "av:movie");
        }
      });
    }
  }

  /* -------------------------------------------------------------
   * Public “set*Information” entry points
   * ----------------------------------------------------------- */

  /** @param {Array<title.Audio>} audios */
  setAudiosInformation(audios) {
    this._clearContent();
    if (!audios || audios.length === 0) return;

    const audio = audios[0];
    const title = (audio.getTitle && audio.getTitle()) || "Audio";
    const sub = (audio.getArtist && audio.getArtist()) || "";
    this._setHeader(title, sub, "av:audiotrack");

    const cmp = new AudioInfo();
    // Setter expected by your AudioInfo
    cmp.audio = audio;
    this._appendInfo(cmp, audio, audio.getId ? audio.getId() : title);
  }

  /** @param {Array<title.Video>} videos */
  setVideosInformation(videos) {
    this._clearContent();
    if (!videos || videos.length === 0) return;

    const video = videos[0];
    const title = (video.getTitle && video.getTitle()) || "Video";
    // Publisher field in proto is "PublisherID"; generated getter is usually getPublisherid()
    const publisher =
      (video.getPublisherid &&
        video.getPublisherid() &&
        video.getPublisherid().getName &&
        video.getPublisherid().getName()) ||
      "";

    this._setHeader(title, publisher, "maps:local-movies");

    const cmp = new VideoInfo();
    cmp.video = video;
    this._appendInfo(cmp, video, video.getId ? video.getId() : title);
  }

  /** @param {Object} blogPost (blog.BlogPost) */
  setBlogPostInformation(blogPost) {
    this._clearContent();
    if (!blogPost) return;

    const title = (blogPost.getTitle && blogPost.getTitle()) || "Blog Post";
    const sub = (blogPost.getAuthor && blogPost.getAuthor()) || "";
    this._setHeader(title, sub, "editor:folder");

    const cmp = new BlogPostInfo();
    cmp.blogPost = blogPost;
    this._appendInfo(cmp, blogPost, blogPost.getUuid ? blogPost.getUuid() : title);
  }

  /** @param {Array<title.Title>} titles */
  setTitlesInformation(titles) {
    this._clearContent();
    if (!titles || titles.length === 0) return;

    // Prefer TVSeries if present; else last one (keep prior behavior)
    let t = titles[0];
    if (titles.length > 1) {
      const series = titles.find((x) => x.getType && x.getType() === "TVSeries");
      t = series || titles[titles.length - 1];
    }

    const main = (t.getName && t.getName()) || "Title";
    const sub = t.getYear ? String(t.getYear()) : "";
    this._setHeader(main, sub, "av:movie");

    const cmp = new TitleInfo();
    cmp.title = t;
    this._appendInfo(cmp, t, t.getId ? t.getId() : main);
  }

  /** @param {files.File} file */
  setFileInformation(file) {
    this._clearContent();
    if (!file) return;

    const name = (file.getName && file.getName()) || "File";
    // Custom header for file properties
    const wrapper = this._titleDiv?.querySelector(".title-wrap");
    if (wrapper) {
      wrapper.innerHTML = `
        <iron-icon icon="icons:info" style="margin-right: 10px;"></iron-icon>
        <span class="title-main-text">${name}</span>
        <span class="title-sub-text" style="color: var(--secondary-text-color);">Properties</span>
      `;
    }

    const cmp = new FileInfo();
    cmp.file = file;
    const id = file.getPath ? file.getPath() : name; // path is unique; use as id for delete match
    this.path = id; // expose path for external reference
    this._appendInfo(cmp, file, id);
  }

  /* Optional: allow hiding header programmatically */
  hideHeader() {
    const hdr = this.shadowRoot.querySelector("#header");
    if (hdr) hdr.style.display = "none";
  }
}

customElements.define("globular-informations-manager", InformationsManager);
