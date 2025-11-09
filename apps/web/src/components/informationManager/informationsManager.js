// src/components/informations/informationsManager.js
import getUuidByString from "uuid-by-string";

import { AudioInfo } from "./audioInfo.js";
import { VideoInfo } from "./videoInfo.js";
import { TitleInfo } from "./titleInfo.js";
import { BlogPostInfo } from "./blogPostInfo.js";
import { FileInfo } from "./fileInfo.js";

import { Backend } from "../../backend/backend";

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

  static get observedAttributes() {
    return ["short"];
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
    if (name === "short") {
      this._isShortMode = this.hasAttribute("short")
        ? (val === "" || val === "true" || val === "1")
        : false;
      this._updateHeaderVisibility();
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
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: var(--surface-color); }
        ::-webkit-scrollbar-thumb { background: var(--palette-divider); }

        #container {
          display: flex; flex-direction: column;
          padding: 8px; z-index: 100;
          background: var(--surface-color);
          color: var(--on-surface-color);
          font-size: 1rem; user-select: none;
          max-height: calc(100vh - 100px);
          overflow-y: auto; overflow-x: hidden;
        }
        #header {
          display: flex; align-items: center;
          line-height: 20px; padding-bottom: 10px;
          border-bottom: 2px solid var(--palette-divider);
          margin-bottom: 10px;
        }
        #header paper-icon-button {
          min-width: 40px; color: var(--primary-text-color);
        }
        #header paper-icon-button:hover { color: var(--primary-color); }

        .title-div {
          display: flex; flex-direction: row; gap: 10px; align-items: center;
          flex-grow: 1; color: var(--primary-text-color);
        }
        .title-wrap { display:flex; flex-direction:column; }
        .title-main-text { font-size: 1.55rem; font-weight: 700; margin: 0; }
        .title-sub-text { font-size: 1.1rem; color: var(--secondary-text-color); margin-top: 5px; }
      </style>
      <div id="container">
        <div id="header">
          <div class="title-div">
            <!-- filled by _setHeader -->
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
  }

  _bindDom() {
    if (this._closeButton) {
      this._closeButton.addEventListener("click", () => this._closeSelf());
    }
  }

  _updateHeaderVisibility() {
    if (this._closeButton) {
      this._closeButton.style.display = this._isShortMode ? "none" : "";
    }
  }

  _setHeader(mainTitle, subTitle = "", icon = "") {
    const iconHtml = icon
      ? `<iron-icon icon="${icon}" style="margin-right:4px;"></iron-icon>`
      : "";
    this._titleDiv.innerHTML = `
      ${iconHtml}
      <div class="title-wrap">
        <span class="title-main-text">${mainTitle || "Info"}</span>
        ${subTitle ? `<span class="title-sub-text">${subTitle}</span>` : ""}
      </div>
    `;
  }

  _clearContent() {
    // Clear slotted children (host DOM) and header text
    this.innerHTML = "";
    if (this._titleDiv) this._titleDiv.innerHTML = "";
  }

  _closeSelf() {
    if (this.parentNode) this.parentNode.removeChild(this);
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
  _appendInfo(component, data, dataId) {
    // Track by deterministic id for delete-event matching
    if (dataId) component.id = `_${getUuidByString(dataId)}`;

    // Pass "short" mode as attribute (most of your info widgets observe 'short')
    if (this._isShortMode) component.setAttribute("short", "true");
    else component.removeAttribute("short");

    // Some of your widgets expect a `.globule` on the data; preserve if present
    if (data && data.globule) component.globule = data.globule;

    // Bind a generic ondelete hook if child exposes it
    component.ondelete = () => this._closeSelf();

    this.appendChild(component);
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
    this._setHeader(title, sub, "editor:insert-drive-file");

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
    this._titleDiv.innerHTML = `
      <iron-icon icon="icons:info" style="margin-right: 10px;"></iron-icon>
      <div class="title-wrap">
        <span class="title-main-text">${name}</span>
        <span class="title-sub-text" style="color: var(--palette-text-secondary);">Properties</span>
      </div>
    `;

    const cmp = new FileInfo();
    cmp.file = file;
    const id = file.getPath ? file.getPath() : name; // path is unique; use as id for delete match
    this._appendInfo(cmp, file, id);
  }

  /* Optional: allow hiding header programmatically */
  hideHeader() {
    const hdr = this.shadowRoot.querySelector("#header");
    if (hdr) hdr.style.display = "none";
  }
}

customElements.define("globular-informations-manager", InformationsManager);
