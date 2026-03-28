import getUuidByString from "uuid-by-string";
import { displayError, displayMessage } from "@globular/sdk"; // keep your notify re-exports here
import { playVideo } from "../video";
import { InformationsManager } from "../informationManager/informationsManager";

// ✅ New backend wrappers (cluster-transparent)
import { getTitleFiles } from "@globular/sdk";
import { getBaseUrl } from "@globular/sdk";

// Polymer component imports

/**
 * Displays a global Title/Video/Audio Info box.
 * @param {Object} video - The video object to display.
 */
export function showGlobalVideoInfo(video) {
  const dialogId = `video-info-box-dialog-${getUuidByString(video.getId())}`;
  let videoInfoBoxDialog = document.getElementById(dialogId);

  if (!videoInfoBoxDialog) {
    const html = `
      <style>
        #${dialogId} {
          background: var(--surface-color);
          border: 1px solid var(--palette-divider);
          box-shadow: var(--shadow-elevation-8dp);
          z-index: 1001;
          position: fixed;
          top: 75px;
          left: 50%;
          transform: translate(-50%, 0);
          border-radius: 8px;
          overflow: hidden;
        }
      </style>
      <paper-card id="${dialogId}">
        <globular-informations-manager id="video-info-box"></globular-informations-manager>
      </paper-card>
    `;
    document.body.appendChild(document.createRange().createContextualFragment(html));
    videoInfoBoxDialog = document.getElementById(dialogId);
    const informationsManager = videoInfoBoxDialog.querySelector('globular-informations-manager');
    informationsManager.onclose = () => {
      if (videoInfoBoxDialog.parentNode) {
        videoInfoBoxDialog.parentNode.removeChild(videoInfoBoxDialog);
      }
    };
  }

  const informationsManager = videoInfoBoxDialog.querySelector('globular-informations-manager');
  informationsManager.setVideosInformation([video]);
}

/**
 * Video search result card with preview & playback.
 */
export class SearchVideoCard extends HTMLElement {
  _video = null;
  _editable = false;
  _domInitialized = false;
  _indexPath = "/search/videos";

  _closeButton = null;
  _videoPreviewElement = null;
  _thumbnailImageElement = null;
  _descriptionParagraph = null;
  _ratingSpan = null;
  _videoInfoButton = null;
  _cardContainer = null;
  _listenersBound = false;

  onclose = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    // initial DOM is created in connectedCallback
  }

  connectedCallback() {
    this._ensureDomReady();
    this._populateCard();
    this._loadVideoPreviewSource();
  }

  _renderInitialStructure() {
    if (this._domInitialized) return;
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          --card-radius: 10px;
        }

        .video-card {
          width: 200px;
          container-type: inline-size;
          container-name: videocard;

          background-color: var(--surface-color);
          color: var(--primary-text-color);
          position: relative;
          height: calc(100% - 2px);
          border-radius: var(--card-radius);
          border: 1px solid color-mix(in srgb, var(--palette-divider, #444) 60%, transparent);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          user-select: none;
          box-shadow: 0 1px 3px rgba(0,0,0,.25);
          transition: box-shadow 0.25s ease, transform 0.25s ease;
        }
        .video-card:hover {
          box-shadow: 0 4px 16px rgba(0,0,0,.4);
          transform: translateY(-2px);
        }

        .video-card video, .video-card img {
          width: 100%;
          aspect-ratio: 16 / 9;
          object-fit: contain;
          border-radius: var(--card-radius) var(--card-radius) 0 0;
          display: block;
          background: #000;
          cursor: pointer;
        }

        .video-card p {
          font-size: .85rem;
          font-weight: 500;
          line-height: 1.3;
          margin: 8px 10px 4px;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
          color: var(--primary-text-color);
        }

        .rating-star {
          --iron-icon-fill-color: rgb(245, 197, 24);
          padding: 0;
          height: 16px;
          width: 16px;
          margin-right: 4px;
        }

        .title-rating-div {
          display: flex;
          flex-grow: 1;
          align-items: center;
          color: var(--secondary-text-color);
          font-size: .78rem;
          gap: 2px;
        }

        #close-btn {
          z-index: 100;
          position: absolute;
          top: 0;
          left: 0;
          background-color: rgba(0, 0, 0, 0.55);
          --paper-icon-button-ink-color: white;
          --iron-icon-fill-color: white;
          border-bottom-right-radius: var(--card-radius);
          border-top-left-radius: var(--card-radius);
          padding: 4px;
          width: 28px;
          height: 28px;
          --iron-icon-width: 20px;
          --iron-icon-height: 20px;
          transition: opacity 0.2s ease;
          opacity: 0;
        }
        .video-card:hover #close-btn { opacity: 1; }

        .bottom-actions {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 4px 10px 6px;
          margin-top: auto;
        }
        .bottom-actions paper-icon-button {
          color: var(--video-card-action-color, var(--accent-color));
          --iron-icon-fill-color: var(--video-card-action-color, var(--accent-color));
          padding: 4px;
          width: 28px;
          height: 28px;
        }

        @container videocard (max-width: 225px) {
          .title-rating-div { font-size: .72rem; }
          .video-card p { font-size: .8rem; }
          .rating-star { height: 14px; width: 14px; }
          #close-btn {
            padding: 3px; width: 24px; height: 24px;
            --iron-icon-width: 18px; --iron-icon-height: 18px;
          }
        }
        @container videocard (max-width: 150px) {
          .title-rating-div { font-size: .65rem; }
          .video-card p { font-size: .72rem; margin: 4px 6px 2px; }
          .rating-star { height: 12px; width: 12px; }
          .bottom-actions { padding: 2px 6px 4px; }
          #close-btn {
            padding: 2px; width: 20px; height: 20px;
            --iron-icon-width: 14px; --iron-icon-height: 14px;
          }
        }
      </style>
      <div class="video-card">
        <paper-icon-button icon="icons:close" id="close-btn" title="Remove video card"></paper-icon-button>
        <img id="thumbnail-image" alt="Video Thumbnail">
        <video autoplay muted loop id="preview-video" style="display: none;"></video>
        <p id="description"></p>
        <div class="bottom-actions">
          <div class="title-rating-div">
            <iron-icon class="rating-star" icon="icons:star"></iron-icon>
            <div><span id="rating-span"></span>/10</div>
          </div>
          <paper-icon-button id="video-info-button" icon="icons:arrow-drop-down-circle" title="View Full Info"></paper-icon-button>
        </div>
      </div>
    `;
    this._domInitialized = true;
  }

  _getDomReferences() {
    this._videoPreviewElement = this.shadowRoot.querySelector("#preview-video");
    this._thumbnailImageElement = this.shadowRoot.querySelector("#thumbnail-image");
    this._descriptionParagraph = this.shadowRoot.querySelector("#description");
    this._ratingSpan = this.shadowRoot.querySelector("#rating-span");
    this._videoInfoButton = this.shadowRoot.querySelector("#video-info-button");
    this._closeButton = this.shadowRoot.querySelector("#close-btn");
    this._cardContainer = this.shadowRoot.querySelector(".video-card");
  }

  _bindEventListeners() {
    if (this._listenersBound) return;
    if (this._closeButton) this._closeButton.addEventListener('click', this._handleCloseClick.bind(this));
    if (this._videoInfoButton) this._videoInfoButton.addEventListener('click', this._handleVideoInfoClick.bind(this));

    if (this._cardContainer) {
      this._cardContainer.addEventListener('mouseenter', this._handleCardMouseEnter.bind(this));
      this._cardContainer.addEventListener('mouseleave', this._handleCardMouseLeave.bind(this));
    }

    if (this._videoPreviewElement) this._videoPreviewElement.addEventListener('click', this._handlePlayVideoClick.bind(this));
    if (this._thumbnailImageElement) this._thumbnailImageElement.addEventListener('click', this._handlePlayVideoClick.bind(this));
    this._listenersBound = true;
  }

  _ensureDomReady() {
    if (!this._domInitialized) {
      this._renderInitialStructure();
    }
    if (!this._thumbnailImageElement) {
      this._getDomReferences();
    }
    if (!this._listenersBound) {
      this._bindEventListeners();
    }
  }

  setVideo(video) {
    this._ensureDomReady();
    if (this._video !== video) {
      this._video = video;
      this._populateCard();
      this._updateEditableState();
      this._loadVideoPreviewSource();
    }
  }

  setIndexPath(indexPath) {
    if (typeof indexPath === "string" && indexPath.trim().length > 0 && this._indexPath !== indexPath) {
      this._indexPath = indexPath;
      this._loadVideoPreviewSource();
    }
  }

  _populateCard() {
    this._ensureDomReady();
    if (!this._video) return;

    this._thumbnailImageElement.src = this._video.getPoster()
      ? this._video.getPoster().getContenturl()
      : 'placeholder.png';
    this._thumbnailImageElement.alt = `Thumbnail for ${this._video.getDescription()}`;

    this._descriptionParagraph.textContent = this._video.getDescription();
    this._ratingSpan.textContent = this._video.getRating().toFixed(1);

    this.classList.add("filterable");
    this._video.getGenresList().forEach(g => this.classList.add(getUuidByString(g.toLowerCase())));
    this._video.getTagsList().forEach(tag => this.classList.add(getUuidByString(tag.toLowerCase())));

    if (this._video.getRating() < 3.5) this.classList.add(getUuidByString("low"));
    else if (this._video.getRating() < 7.0) this.classList.add(getUuidByString("medium"));
    else this.classList.add(getUuidByString("high"));
  }

  async _loadVideoPreviewSource() {
    if (!this._video || !this._videoPreviewElement) return;

    const videoId = this._video.getId();
    const indexPath = this._indexPath || "/search/videos";

    try {
      console.log(`Loading preview for video ${videoId} (index ${indexPath})...`);
      const filePaths = await getTitleFiles(videoId, indexPath).catch(err => {
        console.warn(`getTitleFiles failed for ${videoId} (${indexPath}): ${err?.message || err}`);
        return [];
      });

      if (!Array.isArray(filePaths) || filePaths.length === 0) {
        // Nothing associated yet; fall back to poster only.
        this._videoPreviewElement.removeAttribute("src");
        this._videoPreviewElement.style.display = "none";
        return;
      }

      const mainVideoPath = filePaths[0];
      const previewUrl = this._buildPreviewUrl(mainVideoPath); // derive preview clip URL
      this._videoPreviewElement.src = previewUrl;
      this._videoPreviewElement.style.display = "none";

      this._videoPreviewElement.onclick = () => {
        playVideo(mainVideoPath, null, null, this._video); // no globule
      };
    } catch (err) {
      console.error(`Failed to load video preview for ${videoId}: ${err?.message || err}`);
      this._videoPreviewElement.removeAttribute("src");
      this._videoPreviewElement.style.display = "none";
    }
  }

  /**
   * Convert an original video path to its preview clip URL.
   * Example:
   *   /path/to/movie.mp4  -> /path/to/.hidden/movie/preview.mp4
   */
  _buildPreviewUrl(videoPath) {
    let previewPath = videoPath;
    // Strip any known video extension so the .hidden dir name is extension-free.
    const extMatch = previewPath.match(/\.(mp4|mkv|avi|webm|mov|m4v|mpg|mpeg|flv|wmv|m2ts|ts)$/i);
    if (extMatch) {
      previewPath = previewPath.substring(0, previewPath.length - extMatch[0].length);
    }
    previewPath =
      `${previewPath.substring(0, previewPath.lastIndexOf("/") + 1)}.hidden` +
      `${previewPath.substring(previewPath.lastIndexOf("/"))}/preview.mp4`;

    let url = getBaseUrl() || "";
    // Append encoded path segments
    previewPath.split("/").forEach(seg => {
      const c = encodeURIComponent(seg.trim());
      if (c.length > 0) url += `/${c}`;
    });
    return url;
  }

  setEditable(editable) {
    this._editable = editable;
    this._updateEditableState();
  }

  _updateEditableState() {
    if (this._closeButton) {
      this._closeButton.style.display = this._editable && this.onclose ? "block" : "none";
    }
  }

  _handleCloseClick(evt) {
    evt.stopPropagation();
    if (!this._video) {
      console.warn("No video data to remove.");
      return;
    }

    const toast = displayMessage(
      `<style>
        #yes-no-video-delete-box {
          display: flex; flex-direction: column; align-items: center; padding: 15px;
        }
        #yes-no-video-delete-box img {
          max-height: 256px; object-fit: contain; width: 100%; margin-top: 10px; margin-bottom: 15px;
        }
        #yes-no-video-delete-box p { font-size: .85rem; text-align: center; margin-bottom: 10px; }
        #yes-no-video-delete-box .dialog-actions {
          display: flex; justify-content: flex-end; width: 100%; gap: 10px; margin-top: 20px;
        }
      </style>
      <div id="yes-no-video-delete-box">
        <div>You're about to remove video:</div>
        <img src="${this._video.getPoster().getContenturl()}" alt="Video Poster">
        <p>${this._video.getDescription()}</p>
        <div>Is this what you want to do?</div>
        <div class="dialog-actions">
          <paper-button raised id="yes-delete-video">Yes</paper-button>
          <paper-button raised id="no-delete-video">No</paper-button>
        </div>
      </div>
      `, 60 * 1000
    );

    const yesBtn = toast.toastElement.querySelector("#yes-delete-video");
    const noBtn = toast.toastElement.querySelector("#no-delete-video");

    yesBtn.addEventListener('click', () => {
      toast.hideToast();
      if (this.onclose) this.onclose();
      displayMessage(
        `<div style="display: flex; flex-direction: column;">
          <span style="font-size: .85rem;">"${this._video.getDescription()}"</span>
          <span>was removed.</span>
        </div>`,
        3000
      );
    });

    noBtn.addEventListener('click', () => toast.hideToast());
  }

  async _handlePlayVideoClick() {
    if (!this._video) return;

    try {
      const indexPath = this._indexPath || "/search/videos";
      const filePaths = await getTitleFiles(this._video.getId(), indexPath);
      if (Array.isArray(filePaths) && filePaths.length > 0) {
        const mainVideoPath = filePaths[0];
        await playVideo(mainVideoPath, null, null, this._video);
      } else {
        displayMessage(`No main video file found for "${this._video.getDescription()}".`, 3000);
      }
    } catch (err) {
      displayError(`Failed to get main video file: ${err?.message || err}`, 3000);
    }
  }

  _handleVideoInfoClick() {
    if (this._video) showGlobalVideoInfo(this._video);
  }

  _handleCardMouseEnter() {
    if (!this._videoPreviewElement || !this._videoPreviewElement.src) return;
    if (this._thumbnailImageElement) {
      this._thumbnailImageElement.style.display = "none";
    }
    this._videoPreviewElement.style.display = "block";
    this._videoPreviewElement.currentTime = 0;
    this._videoPreviewElement.play().catch(() => {});
  }

  _handleCardMouseLeave() {
    if (this._videoPreviewElement && this._videoPreviewElement.src) {
      this._videoPreviewElement.pause();
      this._videoPreviewElement.currentTime = 0;
      this._videoPreviewElement.style.display = "none";
    }
    if (this._thumbnailImageElement) {
      this._thumbnailImageElement.style.display = "";
    }
  }
}

customElements.define('globular-search-video-card', SearchVideoCard);
