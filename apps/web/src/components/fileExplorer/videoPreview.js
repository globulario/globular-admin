// src/components/video/videoPreview.js

import { Backend } from "../../backend/backend"; // still used for eventHub
import { displayError } from "../../backend/ui/notify";
import * as files from "../../backend/cms/files"; // FileVM helpers, getHiddenFiles, getImages

import '@polymer/paper-ripple/paper-ripple.js';

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

  /** @type {HTMLElement | null} */
  _container = null;
  /** @type {HTMLImageElement | null} */
  _firstImageElement = null;
  /** @type {HTMLImageElement[]} */
  _previewImages = [];
  /** @type {number} */
  _currentPreviewImageIndex = 0;
  /** @type {number | null} */
  _previewIntervalId = null;

  /** @type {ResizeObserver | null} */
  _resizeObserver = null;

  /** Bound handlers for add/removeEventListener symmetry */
  _boundClick = null;
  _boundEnter = null;
  _boundLeave = null;

  /** Hovers/loads */
  _timelineLoadStarted = false; // guard: only attempt once per file
  _destroyed = false;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._boundClick = (e) => this._handleContainerClick(e);
    this._boundEnter = (e) => this._handleContainerMouseEnter(e);
    this._boundLeave = (e) => this._handleContainerMouseLeave(e);
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        #container {
          height: ${this._height}px;
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
          opacity: 0;
          pointer-events: none;
        }
        .preview-active { opacity: 1; }
        .preview-inactive { opacity: 0; }
        slot { position: relative; z-index: 1; }
      </style>
      <div id="container" draggable="false" aria-label="Video preview">
        <slot></slot>
        <paper-ripple></paper-ripple>
      </div>
    `;

    this._container = this.shadowRoot.querySelector("#container");

    if (this._container) {
      this._container.addEventListener("click", this._boundClick);
      this._container.addEventListener("mouseenter", this._boundEnter);
      this._container.addEventListener("mouseleave", this._boundLeave);
    }

    // Keep width in sync if the component or container resizes
    this._resizeObserver = new ResizeObserver(() => this._updateWidthAndNotify());
    if (this._container) this._resizeObserver.observe(this._container);

    this._destroyed = false;
    this._loadInitialThumbnail();
  }

  disconnectedCallback() {
    this.stopPreview();

    // Remove listeners
    if (this._container) {
      this._container.removeEventListener("click", this._boundClick);
      this._container.removeEventListener("mouseenter", this._boundEnter);
      this._container.removeEventListener("mouseleave", this._boundLeave);
    }

    // Disconnect observer
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }

    // Clear image elements to help GC
    if (this._container) {
      this._container.querySelectorAll('img').forEach(img => img.remove());
    }
    this._firstImageElement = null;
    this._previewImages = [];
    this._timelineLoadStarted = false;
    this._destroyed = true;
  }

  /** Accepts a FileVM or legacy proto-like object */
  setFile(file) {
    if (this._file === file) return; // no-op if same
    this._file = file;
    this._title = this._getPath();
    this._previewImages = [];
    this._firstImageElement = null;
    this._timelineLoadStarted = false;
    this.stopPreview();

    if (this._container) {
      this._container.querySelectorAll('img').forEach(img => img.remove());
    }
    this._loadInitialThumbnail();
  }

  setHeight(height) {
    this._height = height;
    if (this._container) {
      this._container.style.height = `${height}px`;
      this._updateWidthAndNotify();
    }
  }

  setOnResize(callback) { this._onresize = callback; }
  setOnPreview(callback) { this._onpreview = callback; }
  setOnPlay(callback) { this._onplay = callback; }
  setFileExplorer(fileExplorer) { this._fileExplorer = fileExplorer; }

  /** Try to read path from either FileVM or legacy shape */
  _getPath() {
    if (!this._file) return "";
    return typeof this._file.getPath === "function" ? this._file.getPath() : (this._file.path || "");
  }

  /** Try to read a primary thumbnail URL */
  _getPrimaryThumbnail() {
    if (!this._file) return "";
    if (typeof this._file.getThumbnail === "function") return this._file.getThumbnail();
    if (Array.isArray(this._file.thumbnail) && this._file.thumbnail.length > 0) return this._file.thumbnail[0];
    return "";
  }

  _loadInitialThumbnail() {
    if (!this._file || !this._container) return;

    const thumb = this._getPrimaryThumbnail();
    if (thumb) {
      const img = document.createElement("img");
      img.decoding = "async";
      img.loading = "lazy";
      img.alt = `Thumbnail for ${this._title}`;
      img.src = thumb;

      img.onload = () => {
        if (this._destroyed) return;
        this._firstImageElement = img;
        this._container.appendChild(img);
        img.classList.add('preview-active');
        this._previewImages[0] = img;
        this._updateWidthAndNotify();
      };
      img.onerror = (e) => {
        console.error("Failed to load initial thumbnail:", e);
        displayError("Failed to load video thumbnail.", 3000);
      };
    }
    // else: no inline thumbnail; will attempt hover previews if present
  }

  _updateWidthAndNotify() {
    // Estimate width using first visible image’s intrinsic ratio
    const refImg = this._firstImageElement || this._previewImages[0];
    if (refImg && (refImg.naturalHeight || refImg.offsetHeight)) {
      const h = this._height || (this._container ? this._container.clientHeight : 0);
      const basisH = refImg.naturalHeight || refImg.offsetHeight || 1;
      const basisW = refImg.naturalWidth || refImg.offsetWidth || 0;
      const ratio = h / basisH;
      this.width = Math.round(basisW * ratio);
    } else {
      this.width = this._container ? this._container.clientWidth : 0;
    }
    this._onresize && this._onresize(this.width, this._height);
  }

  _handleContainerClick(evt) {
    evt.stopPropagation();
    this._playVideo();
  }

  async _handleContainerMouseEnter(evt) {
    evt.stopPropagation();

    // Already have a sequence? just start it
    if (this._previewImages.length > 1) {
      this.startPreview();
      return;
    }

    // Avoid parallel loads and redundant calls
    if (this._timelineLoadStarted) {
      this.startPreview();
      return;
    }
    this._timelineLoadStarted = true;

    const path = this._getPath();
    if (!path) return;

    try {
      // hidden frames under: .hidden/<basename>/__timeline__
      const dir = await files.getHiddenFiles(path, "__timeline__"); // DirVM | null
      const list = dir?.files || [];

      if (list.length === 0) {
        // No extra frames; if we at least have 1 image, animate it (noop) else skip
        if (this._previewImages.length === 1) this.startPreview();
        return;
      }

      // Load images as HTMLImageElements via files facade (auth handled inside)
      const imgs = await files.getImages(list);
      if (this._destroyed) return;

      const validImgs = imgs.filter(img => img instanceof HTMLImageElement);
      // Keep first thumbnail (if present) as frame 0, then add timeline frames
      this._previewImages = [...this._previewImages, ...validImgs];

      if (this._container && this._previewImages.length > 0) {
        this._previewImages.forEach(img => {
          if (!img.parentNode) {
            img.classList.add('preview-inactive');
            img.decoding = "async";
            img.loading = "lazy";
            this._container.appendChild(img);
          }
        });
        this.startPreview();
      }
    } catch (error) {
      console.error("Error loading preview images:", error);
      displayError("Failed to load video previews.", 3000);
    }
  }

  _handleContainerMouseLeave(evt) {
    evt.stopPropagation();
    this.stopPreview();
  }

  /** Public: start cycling frames */
  startPreview() {
    if (this._previewIntervalId !== null) return;

    this._currentPreviewImageIndex = 0;
    this._onpreview && this._onpreview();

    if (this._previewImages.length > 0) {
      this._showImage(this._previewImages[0]);
    }

    // If the tab is hidden, don’t burn CPU; resume when visible
    const tick = () => {
      if (document.visibilityState === "hidden") return;
      if (this._previewImages.length === 0) return;

      this._previewImages.forEach(img => img.classList.remove('preview-active'));
      this._currentPreviewImageIndex =
        (this._currentPreviewImageIndex + 1) % this._previewImages.length;

      const imgToShow = this._previewImages[this._currentPreviewImageIndex];
      if (imgToShow) this._showImage(imgToShow);
    };

    this._previewIntervalId = window.setInterval(tick, 350);
  }

  _showImage(imgToShow) {
    if (!this._container) return;
    this._container.querySelectorAll('img').forEach(img => {
      if (img === imgToShow) img.classList.add('preview-active');
      else img.classList.remove('preview-active');
    });
  }

  /** Public: stop cycling, revert to first frame if possible */
  stopPreview() {
    if (this._previewIntervalId !== null) {
      clearInterval(this._previewIntervalId);
      this._previewIntervalId = null;
    }

    if (this._firstImageElement) {
      this._showImage(this._firstImageElement);
    } else if (this._previewImages.length > 0) {
      this._showImage(this._previewImages[0]);
    } else if (this._container) {
      this._container.querySelectorAll('img').forEach(img => img.classList.remove('preview-active'));
    }
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

customElements.define('globular-video-preview', VideoPreview);
