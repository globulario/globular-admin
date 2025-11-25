// Removed: DeleteVideoRequest import – deletion is delegated to ../../backend/media/title
import { parseDuration } from "../utility";
import { Backend } from "../../backend/backend";
import { displayError, displaySuccess, displayMessage} from "../../backend/ui/notify";
import { VideoInfoEditor } from "./videoInformationsEditor.js";
import getUuidByString from "uuid-by-string";
import { getTitleFilePaths } from "./titleInfo.js";

import "@polymer/paper-button/paper-button.js";
import "@polymer/iron-icon/iron-icon.js";

// ✅ Use centralized backend helpers (keep path consistent with your project)
import { deleteVideo as deleteVideoHelper, invalidateFileCaches } from "../../backend/media/title";

const VIDEO_INFO_GLOBAL_STYLE = `
.title-div { display:flex; }
.title-poster-div { padding-right:20px; }
.title-informations-div { font-size:1em; min-width:350px; max-width:450px; }
.title-poster-div img { max-width:320px; max-height:350px; object-fit:cover; width:auto; height:auto; }
.title-genre-span { border:1px solid var(--palette-divider); padding:1px 5px; margin-right:5px; user-select:none; border-radius:4px; background-color:var(--surface-color-dark, var(--surface-elevated-color)); }
.rating-star { --iron-icon-fill-color: rgb(245 197 24); padding-right:10px; height:30px; width:30px; }
.title-rating-div { display:flex; align-items:center; color:var(--secondary-text-color); font-size:1rem; margin-top:10px; }
#rating-span { font-weight:600; font-size:1.2rem; color:var(--primary-text-color); user-select:none; }
.title-genres-div { padding:5px; display:flex; flex-wrap:wrap; font-size:.9rem; gap:5px; }
.title-credit { flex-grow:1; color:var(--primary-text-color); border-bottom:1px solid var(--palette-divider); width:100%; margin-bottom:10px; padding-bottom:5px; }
.title-credit:last-of-type { border-bottom:none; }
.title-files-div { display:flex; width:100%; flex-wrap:wrap; max-width:400px; gap:10px; padding-left:15px; margin-top:15px; }
.title-files-div paper-progress { width:100%; }
.title-top-credit, .title-credit { margin-top:15px; display:flex; flex-direction:column; }
.title-credit-title { font-weight:500; font-size:1.1rem; color:var(--primary-text-color); margin-bottom:5px; }
.title-credit-lst { display:flex; flex-wrap:wrap; gap:12px; }
.title-credit-lst a { color:var(--palette-action-active); font-size:1rem; text-decoration:none; white-space:nowrap; }
.title-credit-lst a:hover { text-decoration:underline; cursor:pointer; }

@media only screen and (max-width: 600px) {
  .title-div { flex-direction:column; max-height:calc(100vh - 300px); overflow-y:auto; overflow-x:hidden; }
  .title-poster-div { display:flex; justify-content:center; margin-bottom:20px; flex-direction:column; width:100%; padding-right:0; }
  .title-poster-img { max-width:256px; max-height:256px; width:auto; height:auto; }
}
`;

export class VideoInfo extends HTMLElement {
  _video = null;
  _isShortMode = false;
  _titleHeaderDiv = null;
  _ondelete = null;

  _posterImg = null;
  _filesDiv = null;
  _synopsisDiv = null;
  _genresDiv = null;
  _ratingSpan = null;
  _actorsListDiv = null;
  _editButton = null;
  _deleteButton = null;
  _actionDiv = null;
  _actorsTitleDiv = null;

  constructor(titleHeaderDiv, isShort) {
    super();
    this.attachShadow({ mode: "open" });

    this._titleHeaderDiv = titleHeaderDiv;
    this._isShortMode = isShort;

    this._renderInitialStructure();
    this._getDomReferences();
    this._bindEventListeners();
  }

  connectedCallback() {}

  set video(video) {
    if (this._video !== video) {
      this._video = video;
      this._renderVideoContent();
    }
  }

  get video() { return this._video; }

  set ondelete(cb) { this._ondelete = cb; }
  get ondelete() { return this._ondelete; }

  _renderInitialStructure() {
    this.shadowRoot.innerHTML = `
      <style>
        ${VIDEO_INFO_GLOBAL_STYLE}
        .title-div { color:var(--primary-text-color); user-select:none; }
        .action-div { display:flex; justify-content:flex-end; gap:10px; padding-top:15px; border-top:1px solid var(--palette-divider); margin-top:15px; }
        paper-button { background-color:var(--primary-color); color:var(--on-primary-color); padding:8px 16px; border-radius:4px; }
        paper-button:hover { background-color:var(--primary-dark-color); }
        @media only screen and (max-width: 600px) {
          .title-div { flex-direction:column; max-height:calc(100vh - 300px); overflow-y:auto; overflow-x:hidden; }
          .title-poster-img { max-width:256px; max-height:256px; }
        }
      </style>
      <div>
        <div class="title-div">
          <div class="title-poster-div">
            <img class="title-poster-img"></img>
            <div class="title-files-div"></div>
          </div>
          <div class="title-informations-div">
            <p class="title-synopsis-div"></p>
            <div class="title-genres-div"></div>
            <div class="title-rating-div">
              <iron-icon class="rating-star" icon="icons:star"></iron-icon>
              <div style="display:flex;flex-direction:column;">
                <div><span id="rating-span"></span>/10</div>
              </div>
            </div>
            <div class="title-top-credit">
              <div class="title-credit">
                <div id="title-actors-title" class="title-credit-title">Star</div>
                <div id="title-actors-lst" class="title-credit-lst"></div>
              </div>
            </div>
          </div>
        </div>
        <div class="action-div">
          <paper-button id="edit-indexation-btn">Edit</paper-button>
          <paper-button id="delete-indexation-btn">Delete</paper-button>
        </div>
      </div>
    `;
  }

  _getDomReferences() {
    const $ = (q) => this.shadowRoot.querySelector(q);
    this._posterImg = $(".title-poster-img");
    this._filesDiv = $(".title-files-div");
    this._synopsisDiv = $(".title-synopsis-div");
    this._genresDiv = $(".title-genres-div");
    this._ratingSpan = $("#rating-span");
    this._actorsListDiv = $("#title-actors-lst");
    this._editButton = $("#edit-indexation-btn");
    this._deleteButton = $("#delete-indexation-btn");
    this._actionDiv = this.shadowRoot.querySelector(".action-div");
    this._actorsTitleDiv = $("#title-actors-title");
  }

  _bindEventListeners() {
    this._editButton?.addEventListener("click", this._handleEditClick.bind(this));
    this._deleteButton?.addEventListener("click", this._handleDeleteClick.bind(this));
  }

  _renderVideoContent() {
    if (!this._video) return;

    // Poster
    const posterUrl = this._video.getPoster ? (this._video.getPoster()?.getContenturl() || "placeholder.png") : "placeholder.png";
    this._posterImg.src = posterUrl;
    this._posterImg.alt = `Poster for ${this._video.getDescription?.() || "Video"}`;
    this._posterImg.style.display = this._isShortMode ? "none" : "";

    // Synopsis
    this._synopsisDiv.textContent = this._video.getDescription?.() || "";
    this._synopsisDiv.style.display = this._isShortMode ? "none" : "";

    // Rating
    const score = typeof this._video.getRating === "function" ? this._video.getRating() : 0;
    this._ratingSpan.textContent = Number.isFinite(score) ? score.toFixed(1) : "0.0";

    // Genres
    if (this._genresDiv) {
      this._genresDiv.innerHTML = "";
      const genres = typeof this._video.getGenresList === "function" ? this._video.getGenresList() : [];
      genres.forEach((g) => {
        const span = document.createElement("span");
        span.classList.add("title-genre-span");
        span.textContent = g;
        this._genresDiv.appendChild(span);
      });
    }

    // Casting
    const casting = typeof this._video.getCastingList === "function" ? this._video.getCastingList() : [];
    this._displayPersonsList(this._actorsListDiv, casting, this._actorsTitleDiv);
    if (casting.length === 0 && this._actorsTitleDiv?.parentNode) {
      this._actorsTitleDiv.parentNode.style.display = "none";
    } else if (this._actorsTitleDiv?.parentNode) {
      this._actorsTitleDiv.parentNode.style.display = "flex";
    }

    // Files (kept as placeholder hook)
    this._filesDiv.innerHTML = "";

    // Header (publisher, genres, duration)
    this._updateHeader();

    // Buttons visibility
    this._updateButtonVisibility();

    // Hide action row in short mode
    if (this._actionDiv) {
      this._actionDiv.style.display = this._isShortMode ? "none" : "";
    }
  }

  _updateHeader() {
    if (!this._video || !this._titleHeaderDiv) return;

    const publisherName =
      this._video.getPublisherid && this._video.getPublisherid()
        ? this._video.getPublisherid().getName?.() || ""
        : "";

    const genresText =
      typeof this._video.getGenresList === "function"
        ? this._video.getGenresList().join(", ")
        : "";

    const duration =
      typeof this._video.getDuration === "function"
        ? this._video.getDuration()
        : 0;
    const durationText = duration > 0 ? parseDuration(duration) : "";

    this._titleHeaderDiv.innerHTML = `
      <h1 id="title-name" class="title" style="${this._isShortMode ? "font-size:1rem; padding-bottom:10px;" : ""}">
        ${publisherName}
      </h1>
      <div style="display:flex; align-items:baseline; max-width:700px;">
        <h3 class="title-sub-title-div" style="${this._isShortMode ? "font-size:1rem;" : ""}">
          <span id="title-type"><span>Genre: </span>${genresText}</span>
        </h3>
        ${durationText ? `<span id="title-duration" style="padding-left:10px;"><span>Duration: </span>${durationText}</span>` : ""}
      </div>
    `;
  }

  _displayPersonsList(listDiv, persons, titleDiv = null) {
    if (!listDiv) return;
    listDiv.innerHTML = "";

    if (persons && persons.length > 0) {
      persons.forEach((p) => {
        const a = document.createElement("a");
        a.href = p.getUrl?.() || "#";
        a.textContent = p.getFullname?.() || "";
        a.target = "_blank";
        a.id = `_${getUuidByString(p.getId?.() || a.textContent)}`;
        listDiv.appendChild(a);
      });
      if (titleDiv) titleDiv.style.display = "block";
    } else {
      if (titleDiv) titleDiv.style.display = "none";
    }
  }

  _updateButtonVisibility() {
    // UI-only check; real auth is handled in helpers
    const token = sessionStorage.getItem("__globular_token__");
    const isLoggedIn = !!token && token !== "null";
    if (this._editButton) this._editButton.style.display = isLoggedIn ? "" : "none";
    if (this._deleteButton) this._deleteButton.style.display = isLoggedIn ? "" : "none";
  }

  _handleEditClick() {
    if (!this._video) return;

    const editor = new VideoInfoEditor(this._video, this);
    const parent = this.parentNode;

    if (parent) {
      parent.removeChild(this);
      parent.appendChild(editor);
      displayMessage("Edit mode enabled.", 2000);
    } else {
      console.warn("VideoInfo: Parent node not found for editing.");
      displayError("Cannot open editor: Component not attached to DOM.", 3000);
    }
  }

  _handleDeleteClick() {
    if (!this._video) return;

    const toast = displayMessage(`
      <style>
        #delete-video-dialog { display:flex; flex-direction:column; align-items:center; padding:15px; }
        #delete-video-dialog p { font-style:italic; max-width:300px; text-align:center; margin-bottom:10px; }
        #delete-video-dialog img { width:185px; height:auto; object-fit:contain; padding:10px 0 15px 0; align-self:center; }
        #delete-video-dialog .dialog-actions { display:flex; justify-content:flex-end; gap:10px; width:100%; margin-top:20px; }
      </style>
      <div id="delete-video-dialog">
        <div>You're about to delete indexation for:</div>
        <p id="video-title-display"></p>
        <img id="video-poster-display" />
        <div>Is that what you want to do?</div>
        <div class="dialog-actions">
          <paper-button id="delete-cancel-btn">Cancel</paper-button>
          <paper-button id="delete-ok-btn">Ok</paper-button>
        </div>
      </div>
    `, 60 * 1000);

    const dialogVideoTitle = toast.toastElement.querySelector("#video-title-display");
    const dialogVideoPoster = toast.toastElement.querySelector("#video-poster-display");
    const okBtn = toast.toastElement.querySelector("#delete-ok-btn");
    const cancelBtn = toast.toastElement.querySelector("#delete-cancel-btn");

    dialogVideoTitle.textContent = this._video.getDescription?.() || "";
    dialogVideoPoster.src = this._video.getPoster ? (this._video.getPoster()?.getContenturl() || "placeholder.png") : "placeholder.png";

    cancelBtn.addEventListener("click", () => toast.hideToast());

    okBtn.addEventListener("click", async () => {
      toast.hideToast();
      if (!this._video) return;

      try {
        // ✅ Delegate deletion to centralized helper (handles auth, indexPath, RPC)
        const associatedFiles = [];
        try {
          associatedFiles.push(...await getTitleFilePaths(this._video, "/search/videos"));
        } catch (err) {
          console.warn("VideoInfo: failed to enumerate associated files before delete", err);
        }

        await deleteVideoHelper(this._video.globule, this._video.getId());

        // Notify UI
        displaySuccess(`"${this._video.getDescription?.() || "Video"}" was deleted successfully!`, 3000);
        associatedFiles.forEach((p) => invalidateFileCaches(p));

        // Keep your event bus behavior
        try {
          Backend?.eventHub?.publish?.(
            `_delete_infos_${this._video.getId()}_evt`,
            {
              filePaths: associatedFiles,
              infoType: "video",
            },
            true
          );
        } catch (_) { /* best-effort */ }

        // Remove from DOM & call callback
        this.parentNode && this.parentNode.removeChild(this);
        this._ondelete && this._ondelete();
      } catch (err) {
        displayError(`Failed to delete video info: ${err?.message || err}`, 3000);
      }
    });
  }
}

customElements.define("globular-video-info", VideoInfo);
