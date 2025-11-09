import getUuidByString from "uuid-by-string";
import { displayError, displayMessage } from "../../backend/ui/notify"; // keep your notify re-exports here
import { playVideo } from "../video";
import { InformationsManager } from "../informationManager/informationsManager";

// ✅ New backend wrappers (cluster-transparent)
import { getTitleFiles, deleteVideo } from "../../backend/media/title";
import { getBaseUrl } from "../../backend/core/endpoints";

// Polymer component imports
import '@polymer/paper-icon-button/paper-icon-button.js';
import '@polymer/iron-icon/iron-icon.js';
import '@polymer/paper-button/paper-button.js';
import '@polymer/paper-ripple/paper-ripple.js';

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

  _closeButton = null;
  _videoPreviewElement = null;
  _thumbnailImageElement = null;
  _descriptionParagraph = null;
  _ratingSpan = null;
  _videoInfoButton = null;
  _cardContainer = null;

  onclose = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    // initial DOM is created in connectedCallback
  }

  connectedCallback() {
    this._renderInitialStructure();
    this._getDomReferences();
    this._bindEventListeners();
    this._loadVideoPreviewSource();
  }

  _renderInitialStructure() {
    this.shadowRoot.innerHTML = `
      <style>
        .video-card {
          width: 200px;
          container-type: inline-size;
          container-name: videocard;

          background-color: var(--surface-color);
          color: var(--primary-text-color);
          position: relative;
          height: calc(100% - 2px);
          border-radius: 8px;
          border: 1px solid var(--palette-divider);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          justify-content: center;
          user-select: none;
          box-shadow: var(--shadow-elevation-2dp);
          transition: box-shadow 0.3s ease-in-out;
        }
        .video-card:hover { box-shadow: var(--shadow-elevation-6dp); }

        .video-card video, .video-card img {
          width: 100%;
          max-height: 180px;
          object-fit: cover;
          border-top-left-radius: 8px;
          border-top-right-radius: 8px;
          display: block;
        }
        .video-card video:hover, .video-card img:hover { cursor: pointer; }

        .video-card p {
          font-size: 1.1rem;
          margin: 5px 10px;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
        }

        .rating-star {
          --iron-icon-fill-color: rgb(245, 197, 24);
          padding: 10px;
          height: 20px;
          width: 20px;
        }

        .title-rating-div {
          display: flex;
          flex-grow: 1;
          align-items: center;
          color: var(--secondary-text-color);
          font-size: 1rem;
        }

        #close-btn {
          z-index: 100;
          position: absolute;
          top: 0px;
          left: 0px;
          background-color: rgba(0, 0, 0, 0.6);
          --paper-icon-button-ink-color: white;
          --iron-icon-fill-color: white;
          border-bottom-right-radius: 8px;
          border-top-left-radius: 8px;
          padding: 4px;
          width: 30px;
          height: 30px;
          --iron-icon-width: 24px;
          --iron-icon-height: 24px;
          transition: opacity 0.2s ease;
          opacity: 0;
        }
        .video-card:hover #close-btn { opacity: 1; }

        .bottom-actions {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 5px 10px;
        }
        .bottom-actions paper-icon-button { color: var(--primary-color); }

        @container videocard (max-width: 225px) {
          .title-rating-div { font-size: .85rem; }
          .video-card p { font-size: .95rem; }
          .video-card img, .video-card video { max-height: 110px; }
          #close-btn {
            padding: 3px; width: 25px; height: 25px;
            --iron-icon-width: 20px; --iron-icon-height: 20px;
          }
        }
        @container videocard (max-width: 150px) {
          .title-rating-div { font-size: .75rem; }
          .video-card p { font-size: .85rem; }
          .video-card img, .video-card video { max-height: 60px; }
          #close-btn {
            padding: 2px; width: 20px; height: 20px;
            --iron-icon-width: 16px; --iron-icon-height: 16px;
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
    if (this._closeButton) this._closeButton.addEventListener('click', this._handleCloseClick.bind(this));
    if (this._videoInfoButton) this._videoInfoButton.addEventListener('click', this._handleVideoInfoClick.bind(this));

    if (this._cardContainer) {
      this._cardContainer.addEventListener('mouseenter', this._handleCardMouseEnter.bind(this));
      this._cardContainer.addEventListener('mouseleave', this._handleCardMouseLeave.bind(this));
    }

    if (this._videoPreviewElement) this._videoPreviewElement.addEventListener('click', this._handlePlayVideoClick.bind(this));
    if (this._thumbnailImageElement) this._thumbnailImageElement.addEventListener('click', this._handlePlayVideoClick.bind(this));
  }

  setVideo(video) {
    if (this._video !== video) {
      this._video = video;
      this._populateCard();
      this._updateEditableState();
      this._loadVideoPreviewSource();
    }
  }

  _populateCard() {
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

    try {
      // Cluster-transparent: no indexPath or globule needed
      const filePaths = await getTitleFiles(videoId); // expects an array of file paths
      if (Array.isArray(filePaths) && filePaths.length > 0) {
        const mainVideoPath = filePaths[0];
        const previewUrl = this._buildPreviewUrl(mainVideoPath); // derive preview clip URL
        this._videoPreviewElement.src = previewUrl;
        this._videoPreviewElement.style.display = "block";

        this._videoPreviewElement.onclick = () => {
          playVideo(mainVideoPath, null, null, this._video); // no globule
        };
      } else {
        console.warn(`No file found for video ${videoId}. Attempting to delete stale entry.`);
        await this._deleteStaleVideoEntry(videoId);
      }
    } catch (err) {
      console.error(`Failed to load video preview for ${videoId}: ${err?.message || err}`);
      await this._deleteStaleVideoEntry(videoId);
    }
  }

  /**
   * Convert an original video path to its preview clip URL.
   * Example:
   *   /path/to/movie.mp4  -> /path/to/.hidden/movie/preview.mp4
   */
  _buildPreviewUrl(videoPath) {
    let previewPath = videoPath;
    if (previewPath.toLowerCase().endsWith(".mp4")) {
      previewPath = previewPath.substring(0, previewPath.lastIndexOf("."));
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

  async _deleteStaleVideoEntry(videoId) {
    try {
      await deleteVideo(videoId); // cluster-transparent deletion
      displayMessage(`Stale video entry "${videoId}" was deleted.`, 3000);
    } catch (err) {
      displayError(`Failed to delete stale video entry ${videoId}: ${err?.message || err}`, 3000);
    }
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
      const filePaths = await getTitleFiles(this._video.getId());
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
    if (this._videoPreviewElement && this._videoPreviewElement.src) {
      this._videoPreviewElement.style.display = "block";
      this._videoPreviewElement.play().catch(() => {});
    }
  }

  _handleCardMouseLeave() {
    if (this._videoPreviewElement) {
      this._videoPreviewElement.pause();
    }
  }
}

customElements.define('globular-search-video-card', SearchVideoCard);
