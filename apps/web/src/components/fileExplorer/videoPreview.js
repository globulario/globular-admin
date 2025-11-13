// src/components/video/videoPreview.js

import { Backend } from "../../backend/backend"; // still used for eventHub
import { displayError } from "../../backend/ui/notify";
import * as files from "../../backend/cms/files"; // getHiddenFiles, getImages

import "@polymer/paper-ripple/paper-ripple.js";

export class VideoPreview extends HTMLElement {
  /** @type {import('../../backend/cms/files').FileVM | any | null} */
  _file = null;
  /** @type {number} */
  _height = 0;

  /** @type {(w:number,h:number)=>void | null} */
  _onresize = null;
  /** @type {()=>void | null} */
  _onpreview = null;
  /** @type {(f:any)=>void | null} */
  _onplay = null;

  /** @type {string} */
  _title = "";
  /** @type {any | null} */
  _fileExplorer = null;

  /** DOM refs */
  /** @type {HTMLElement | null} */
  _container = null;
  /** @type {HTMLImageElement | null} */
  _previewImg = null;

  /** Frames (URLs only) */
  /** @type {string[]} */
  _frameUrls = [];
  /** @type {number} */
  _currentIndex = 0;
  /** @type {number | null} */
  _previewIntervalId = null;

  /** @type {ResizeObserver | null} */
  _resizeObserver = null;

  /** Bound handlers */
  _boundClick = null;
  _boundEnter = null;
  _boundLeave = null;

  /** State */
  _timelineLoadStarted = false;
  _destroyed = false;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });

    this._boundClick = (e) => this._handleContainerClick(e);
    this._boundEnter = (e) => this._handleMouseEnter(e);
    this._boundLeave = (e) => this._handleMouseLeave(e);
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        #container {
          height: ${this._height}px;
          width: ${this._height}px;
          position: relative;
          overflow: hidden;
          display: flex;
          justify-content: center;
          align-items: center;
          user-select: none;
          -webkit-user-drag: none;
        }
        #container:hover { cursor: pointer; }
        img {
          display: block;
          width: auto;
          max-height: 100%;
          object-fit: contain;
          position: absolute;
          transition: opacity 0.2s ease-in-out;
          opacity: 1;
          pointer-events: none;
        }
        slot { position: relative; z-index: 1; }
      </style>
      <div id="container" draggable="false" aria-label="Video preview">
        <slot></slot>
        <img id="preview" alt="">
        <paper-ripple></paper-ripple>
      </div>
    `;

    this._container = this.shadowRoot.querySelector("#container");
    this._previewImg = this.shadowRoot.querySelector("#preview");

    if (this._container) {
      this._container.addEventListener("click", this._boundClick);
      this._container.addEventListener("mouseenter", this._boundEnter);
      this._container.addEventListener("mouseleave", this._boundLeave);
    }

    this._resizeObserver = new ResizeObserver(() => this._updateWidthAndNotify());
    if (this._container) this._resizeObserver.observe(this._container);

    this._destroyed = false;

    // If we already know some frames (setFile called before connect), show first one
    this._syncPreviewImage();
  }

  disconnectedCallback() {
    this.stopPreview();

    if (this._container) {
      this._container.removeEventListener("click", this._boundClick);
      this._container.removeEventListener("mouseenter", this._boundEnter);
      this._container.removeEventListener("mouseleave", this._boundLeave);
    }

    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }

    this._destroyed = true;
    this._previewImg = null;
    this._container = null;
    this._timelineLoadStarted = false;
    this._frameUrls = [];
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  hasPreviewImages() {
    return this._frameUrls.length > 0;
  }

  /** Accepts a FileVM or legacy proto-like object */
  setFile(file, height = 128) {
    if (this._file === file) return;

    this._file = file;
    this._title = this._getPath();
    this._frameUrls = [];
    this._currentIndex = 0;
    this._timelineLoadStarted = false;

    this.setHeight(height);
    this.stopPreview();

    // First, use primary thumbnail (if any)
    this._loadInitialThumbnail();

    // Then fire-and-forget timeline loading
    this._ensureTimelineLoaded().catch(() => {
      // errors are handled inside
    });
  }

  setHeight(height) {
    this._height = height;
    if (this._container) {
      this._container.style.height = `${height}px`;
      this._container.style.width = `${height}px`;
      this._updateWidthAndNotify();
    }
  }

  setOnResize(cb)   { this._onresize  = cb; }
  setOnPreview(cb)  { this._onpreview = cb; }
  setOnPlay(cb)     { this._onplay    = cb; }
  setFileExplorer(fx) { this._fileExplorer = fx; }

  hasTimeline() {
    return this._frameUrls.length > 1;
  }

  startPreview() {
    if (this._previewIntervalId !== null) return;

    this._currentIndex = 0;
    this._syncPreviewImage();
    this._onpreview && this._onpreview();

    const tick = () => {
      if (document.visibilityState === "hidden") return;
      if (this._frameUrls.length === 0) return;

      this._currentIndex = (this._currentIndex + 1) % this._frameUrls.length;
      this._syncPreviewImage();
    };

    this._previewIntervalId = window.setInterval(tick, 350);
  }

  stopPreview() {
    if (this._previewIntervalId !== null) {
      clearInterval(this._previewIntervalId);
      this._previewIntervalId = null;
    }
    // Reset to first frame if available
    this._currentIndex = 0;
    this._syncPreviewImage();
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  _getPath() {
    if (!this._file) return "";
    return typeof this._file.getPath === "function"
      ? this._file.getPath()
      : (this._file.path || "");
  }

  _getPrimaryThumbnail() {
    if (!this._file) return "";
    if (typeof this._file.getThumbnail === "function") return this._file.getThumbnail();
    if (Array.isArray(this._file.thumbnail) && this._file.thumbnail.length > 0) {
      return this._file.thumbnail[0];
    }
    return "";
  }

  _loadInitialThumbnail() {
    const thumb = this._getPrimaryThumbnail();
    if (!thumb) return;

    // Insert thumbnail as first frame URL
    if (!this._frameUrls.includes(thumb)) {
      this._frameUrls.unshift(thumb);
    }

    // If DOM is ready, apply immediately
    this._syncPreviewImage();
  }

  _syncPreviewImage() {
    if (!this._previewImg) return;
    const url = this._frameUrls[this._currentIndex] || this._frameUrls[0];

    if (!url) return;

    this._previewImg.alt = `Thumbnail for ${this._title}`;
    if (this._previewImg.src !== url) {
      this._previewImg.src = url;
    }

    this._updateWidthAndNotify();
  }

  _updateWidthAndNotify() {
    if (!this._previewImg) return;

    const h = this._height || (this._container ? this._container.clientHeight : 0);
    const basisH = this._previewImg.naturalHeight || this._previewImg.offsetHeight || 1;
    const basisW = this._previewImg.naturalWidth || this._previewImg.offsetWidth || 0;
    const ratio  = h / basisH;
    this.width   = Math.round(basisW * ratio);

    if (this._onresize) {
      this._onresize(this.width, this._height);
    }
  }

  async _handleMouseEnter(evt) {
    evt.stopPropagation();

    if (this._frameUrls.length > 1) {
      this.startPreview();
      return;
    }

    const hasTimeline = await this._ensureTimelineLoaded().catch(() => false);
    if (hasTimeline || this._frameUrls.length > 1 || this._frameUrls.length === 1) {
      this.startPreview();
    }
  }

  _handleMouseLeave(evt) {
    evt.stopPropagation();
    this.stopPreview();
  }

  _handleContainerClick(evt) {
    evt.stopPropagation();
    this._playVideo();
  }

  async _ensureTimelineLoaded() {
    if (this._timelineLoadStarted) {
      return this._frameUrls.length > 1;
    }
    this._timelineLoadStarted = true;

    const path = this._getPath();
    if (!path) {
      this._emitTimelineLoaded(false);
      return false;
    }

    try {
      // .hidden/<basename>/__preview__
      const dir = await files.getHiddenFiles(path, "__preview__");
      const list = (dir && dir.files) || [];
      if (list.length === 0) {
        this._emitTimelineLoaded(false);
        return false;
      }

      const imgs = await files.getImages(list); // returns HTMLImageElement[]
      if (this._destroyed || !imgs || imgs.length === 0) {
        this._emitTimelineLoaded(false);
        return false;
      }

      const urls = imgs
        .filter(img => img instanceof HTMLImageElement)
        .map(img => img.src)
        .filter(Boolean);

      if (urls.length === 0) {
        this._emitTimelineLoaded(false);
        return false;
      }

      // Ensure primary thumbnail stays first (if any)
      const thumb = this._getPrimaryThumbnail();
      if (thumb && !this._frameUrls.includes(thumb)) {
        this._frameUrls.unshift(thumb);
      }

      // Append timeline frames without duplicates
      for (const u of urls) {
        if (!this._frameUrls.includes(u)) {
          this._frameUrls.push(u);
        }
      }

      const hasTimeline = this._frameUrls.length > 1;
      this._emitTimelineLoaded(hasTimeline);

      // If we are already in the DOM, update displayed image
      this._syncPreviewImage();

      return hasTimeline;
    } catch (err) {
      console.error("Error loading preview images:", err);
      displayError("Failed to load video previews.", 3000);
      this._emitTimelineLoaded(false);
      return false;
    }
  }

  _emitTimelineLoaded(hasTimeline) {
    this.dispatchEvent(new CustomEvent("timeline-loaded", {
      bubbles: true,
      composed: true,
      detail: { hasTimeline },
    }));
  }

  _playVideo() {
    this.stopPreview();

    if (this._fileExplorer && this._file) {
      Backend.eventHub.publish(
        "__play_video__",
        { file: this._file, file_explorer_id: this._fileExplorer.id },
        true
      );
    } else {
      console.warn("Cannot play video: File explorer or file not set.");
    }

    this._onplay && this._onplay(this._file);
  }
}

customElements.define("globular-video-preview", VideoPreview);
