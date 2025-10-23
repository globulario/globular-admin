// src/components/video/videoPreview.js

import { Backend } from "../../backend/backend"; // still used for eventHub
import { displayError } from "../../backend/ui/notify";
import * as files from "../../backend/files"; // FileVM helpers, getHiddenFiles, getImages

import '@polymer/paper-ripple/paper-ripple.js';

export class VideoPreview extends HTMLElement {
  /** @type {import('../../backend/files').FileVM | any | null} */
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

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
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
        }
        #container:hover { cursor: pointer; }
        img {
          display: block;
          width: auto;
          max-height: 100%;
          object-fit: contain;
          position: absolute;
          transition: opacity 0.3s ease-in-out;
        }
        .preview-active { opacity: 1; }
        .preview-inactive { opacity: 0; }
        slot { position: relative; z-index: 1; }
      </style>
      <div id="container" draggable="false">
        <slot></slot>
        <paper-ripple></paper-ripple>
      </div>
    `;

    this._container = this.shadowRoot.querySelector("#container");
    this._addEventListeners();
    this._loadInitialThumbnail();
  }

  disconnectedCallback() {
    this.stopPreview();
  }

  /** Accepts a FileVM or legacy proto-like object */
  setFile(file) {
    this._file = file;
    this._title = this._getPath();
    this._previewImages = [];
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
    if (Array.isArray(this._file.thumbnails) && this._file.thumbnails.length > 0) return this._file.thumbnails[0];
    return "";
  }

  _loadInitialThumbnail() {
    if (!this._file || !this._container) return;

    const thumb = this._getPrimaryThumbnail();
    if (thumb) {
      this._firstImageElement = document.createElement("img");
      this._firstImageElement.src = thumb;
      this._firstImageElement.alt = `Thumbnail for ${this._title}`;

      this._firstImageElement.onload = () => {
        this._updateWidthAndNotify();
        this._container.appendChild(this._firstImageElement);
        this._firstImageElement.classList.add('preview-active');
        this._previewImages[0] = this._firstImageElement;
      };
      this._firstImageElement.onerror = (e) => {
        console.error("Failed to load initial thumbnail:", e);
        displayError("Failed to load video thumbnail.", 3000);
      };
    } else {
      // No inline thumbnail; we might still be able to load preview frames on hover
      // so we silently ignore here.
    }
  }

  _updateWidthAndNotify() {
    if (this._firstImageElement && this._firstImageElement.offsetHeight > 0) {
      const ratio = this._height / this._firstImageElement.offsetHeight;
      this.width = this._firstImageElement.offsetWidth * ratio;
    } else {
      this.width = 0;
    }
    this._onresize && this._onresize(this.width, this._height);
  }

  _addEventListeners() {
    if (!this._container) return;
    this._container.addEventListener("click", this._handleContainerClick.bind(this));
    this._container.addEventListener("mouseenter", this._handleContainerMouseEnter.bind(this));
    this._container.addEventListener("mouseleave", this._handleContainerMouseLeave.bind(this));
  }

  _handleContainerClick(evt) {
    evt.stopPropagation();
    this._playVideo();
  }

  async _handleContainerMouseEnter(evt) {
    evt.stopPropagation();

    // If we already have a sequence, just start it
    if (this._previewImages.length > 1) {
      this.startPreview();
      return;
    }

    // Try to load timeline preview frames from hidden folder: .hidden/<basename>/__timeline__
    const path = this._getPath();
    if (!path) return;

    try {
      const dir = await files.getHiddenFiles(path, "__timeline__"); // DirVM | null
      const list = dir?.files || [];

      if (list.length === 0) {
        // No extra frames; if we at least have 1 image, animate it (noop) else skip
        if (this._previewImages.length === 1) this.startPreview();
        return;
      }

      // Load images as HTMLImageElements via files facade (auth handled inside)
      const imgs = await files.getImages(list);
      // Filter to valid elements and append if not yet in DOM
      const validImgs = imgs.filter(img => img instanceof HTMLImageElement);
      this._previewImages = [
        // keep first thumbnail (if present) as frame 0
        ...this._previewImages,
        ...validImgs
      ];

      if (this._previewImages.length > 0) {
        this._previewImages.forEach(img => {
          if (!img.parentNode && this._container) {
            img.classList.add('preview-inactive');
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

    this._previewIntervalId = window.setInterval(() => {
      if (this._previewImages.length === 0) return;

      this._previewImages.forEach(img => img.classList.remove('preview-active'));
      this._currentPreviewImageIndex =
        (this._currentPreviewImageIndex + 1) % this._previewImages.length;

      const imgToShow = this._previewImages[this._currentPreviewImageIndex];
      if (imgToShow) this._showImage(imgToShow);
    }, 450);
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
      // No more .globule; explorer knows how to handle playback in your new arch
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
