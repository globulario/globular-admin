import getUuidByString from "uuid-by-string";
import { displayError, displayMessage } from "@globular/backend"; // keep your notify re-exports here
import { playVideo } from "../video";
import { GetEpisodes, searchEpisodes } from "../informationManager/titleInfo";
import { getImdbInfo } from "./search";

// ✅ backend helpers (cluster-transparent)
import { getTitleFiles, getTitleInfo } from "@globular/backend";
import { getBaseUrl } from "@globular/backend";

import "@polymer/paper-button/paper-button.js";
import "@polymer/iron-icon/iron-icon.js";
import "@polymer/paper-tabs/paper-tabs.js";
import "@polymer/paper-tabs/paper-tab.js";
import "@polymer/paper-card/paper-card.js";
import { InformationsManager } from "../informationManager/informationsManager";

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------
const INDEX_TITLES = "/search/titles";

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

async function getTitleFilePaths(indexPath, title) {
  if (!title || !indexPath) {
    throw new Error("Missing title or index path for getTitleFilePaths.");
  }
  try {
    const paths = await getTitleFiles(title.getId(), indexPath);
    return Array.isArray(paths) ? paths : [];
  } catch (err) {
    console.warn(`getTitleFilePaths: unable to fetch files for ${title.getId()} (${indexPath})`, err);
    return [];
  }
}

/**
 * Listener to auto-prompt and play the next episode when the current one ends.
 * Cluster-transparent: no globule argument.
 */
export async function playTitleListener(player, currentEpisode, indexPath = INDEX_TITLES) {
  if (!currentEpisode || !player || !player.media) {
    console.warn("playTitleListener: Missing currentEpisode or player media.");
    return;
  }

  player.media.onended = async () => {
    _exitFullscreen();
    const gp = document.getElementsByTagName("globular-video-player")[0];
    if (gp && typeof gp.close === "function") gp.close();

    if (localStorage.getItem(currentEpisode.getId())) {
      localStorage.removeItem(currentEpisode.getId());
    }

    try {
      const episodes = await searchEpisodes(currentEpisode.getSerie(), indexPath);
      const currentIndex = episodes.findIndex((e) => e.getId() === currentEpisode.getId());
      const nextEpisode = episodes[currentIndex + 1];

      if (!nextEpisode) {
        displayMessage("No more episodes in this series.", 3000);
        return;
      }

      await _promptPlayNextEpisode(nextEpisode, indexPath);
    } catch (err) {
      displayError(`Error finding next episode: ${err?.message || err}`, 3000);
    }
  };

  if (player.media.tagName.toLowerCase() === "video" && player.toggleFullscreen) {
    player.toggleFullscreen();
  }
}

function _exitFullscreen() {
  try {
    const doc = document;
    if (!doc) return;
    const fullscreenElement =
      doc.fullscreenElement ||
      doc.msFullscreenElement ||
      doc.mozFullScreenElement ||
      doc.webkitFullscreenElement;
    if (!fullscreenElement) return;

    if (doc.exitFullscreen) doc.exitFullscreen();
    else if (doc.msExitFullscreen) doc.msExitFullscreen();
    else if (doc.mozCancelFullScreen) doc.mozCancelFullScreen();
    else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
  } catch (err) {
    console.warn("Failed to exit fullscreen:", err);
  }
}

async function _promptPlayNextEpisode(nextEpisode, indexPath = INDEX_TITLES) {
  return new Promise((resolve, reject) => {
    const toast = displayMessage(
      `
      <style>
        #play-next-dialog { display:flex; flex-direction:column; align-items:center; text-align:center; }
        #play-next-dialog h3 { font-size:1.17em; font-weight:bold; margin:10px 0 5px; }
        #play-next-dialog img { max-width:250px; height:auto; align-self:center; padding-top:10px; padding-bottom:15px; }
        #play-next-dialog p { max-width:400px; margin:0 0 15px; }
        #play-next-dialog .dialog-actions { display:flex; justify-content:flex-end; gap:10px; width:100%; }
      </style>
      <div id="play-next-dialog">
        <div>Play the next episode?</div>
        <h3>Season ${nextEpisode.getSeason()} Episode ${nextEpisode.getEpisode()}: ${nextEpisode.getName()}</h3>
        <img src="${nextEpisode.getPoster ? nextEpisode.getPoster().getContenturl() : "placeholder.png"}" alt="Episode Poster">
        <p>${nextEpisode.getDescription() || "No description available."}</p>
        <div class="dialog-actions">
          <paper-button id="dialog-cancel-btn">Close</paper-button>
          <paper-button id="dialog-ok-btn">Play</paper-button>
        </div>
      </div>
    `,
      60 * 1000
    );

    if (toast && toast.toastElement) {
      toast.toastElement.style.backgroundColor = "var(--surface-color)";
      toast.toastElement.style.color = "var(--primary-text-color)";
    }

    const cancelBtn = toast.toastElement.querySelector("#dialog-cancel-btn");
    const okBtn = toast.toastElement.querySelector("#dialog-ok-btn");

    cancelBtn.addEventListener("click", () => {
      if (toast.hideToast) toast.hideToast();
      resolve();
    });

    okBtn.addEventListener("click", async () => {
      if (toast.hideToast) toast.hideToast();
      try {
        const filePaths = await getTitleFilePaths(indexPath, nextEpisode);
        if (filePaths.length > 0) {
          const nextEpisodePath = filePaths[0];
          await playVideo(
            nextEpisodePath,
            (playerInstance) => playTitleListener(playerInstance, nextEpisode, indexPath),
            null,
            nextEpisode
          );
        } else {
          displayMessage(`No video file found for episode "${nextEpisode.getName()}".`, 3000);
        }
        resolve();
      } catch (err) {
        displayError(`Failed to play next episode: ${err?.message || err}`, 3000);
        reject(err);
      }
    });
  });
}

/**
 * Show a global Title/Video/Audio information dialog.
 */
export function showGlobalTitleInfo(title) {
  const dialogId = `title-info-box-dialog-${getUuidByString(title.getId())}`;
  let titleInfoBoxDialog = document.getElementById(dialogId);

  if (!titleInfoBoxDialog) {
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
        <globular-informations-manager id="title-info-box"></globular-informations-manager>
      </paper-card>
    `;
    document.body.appendChild(document.createRange().createContextualFragment(html));
    titleInfoBoxDialog = document.getElementById(dialogId);
    const informationsManager = titleInfoBoxDialog.querySelector("globular-informations-manager");
    informationsManager.onclose = () => {
      if (titleInfoBoxDialog.parentNode) {
        titleInfoBoxDialog.parentNode.removeChild(titleInfoBoxDialog);
      }
    };
  }

  const informationsManager = titleInfoBoxDialog.querySelector("globular-informations-manager");
  informationsManager.setTitlesInformation([title]);
}

// -----------------------------------------------------------------------------
// SearchTitleCard
// -----------------------------------------------------------------------------

export class SearchTitleCard extends HTMLElement {
  _title = null;
  _frontDiv = null;
  _backContainer = null;
  _searchTitleDetail = null;
  _seriesNameSpan = null;
  _episodeNameSpan = null;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._renderInitialStructure();
    this._getDomReferences();
  }

  _renderInitialStructure() {
    this.shadowRoot.innerHTML = `
      <style>
        .title-card { margin:7.5px; display:flex; height:380px; width:256px; perspective:1000px; }
        .flip-container { width:100%; height:100%; }
        .flipper { transition: .6s; transform-style: preserve-3d; position:relative; width:100%; height:100%; }
        .flip-container:hover .flipper { transform: rotateY(180deg); }
        .front, .back {
          backface-visibility: hidden; position:absolute; top:0; left:0; width:100%; height:100%;
          text-align:center; border-radius:8px; box-shadow: var(--shadow-elevation-6dp); overflow:hidden; background-color: var(--surface-color);
        }
        .front { z-index:2; transform: rotateY(0deg); background-size: cover; background-position: center; background-repeat: no-repeat; }
        .back { transform: rotateY(180deg); }
        .series-info {
          display:flex; flex-direction:column; align-items:flex-start; position:absolute; bottom:0; left:0; right:0;
          background: color-mix(in srgb, var(--surface-color-dark, #000) 85%, transparent);
          color: var(--on-primary-color);
          padding:10px; user-select:none;
        }
        .series-info span { width:100%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-align:left; }
        #hit-div-mosaic-series-name { font-size:1.4em; font-weight:bold; }
        #hit-div-mosaic-episode-name { font-size:1.1em; font-weight:bold; }
        globular-search-title-detail { width:100%; height:100%; }
      </style>

      <div class="title-card" id="hit-div-mosaic">
        <div class="flip-container">
          <div class="flipper">
            <div id="hit-div-mosaic-front" class="front">
              <div class="series-info">
                <span id="hit-div-mosaic-series-name"></span>
                <span id="hit-div-mosaic-episode-name"></span>
              </div>
            </div>
            <div id="back-container" class="back"></div>
          </div>
        </div>
      </div>
    `;
  }

  _getDomReferences() {
    this._frontDiv = this.shadowRoot.querySelector("#hit-div-mosaic-front");
    this._backContainer = this.shadowRoot.querySelector("#back-container");
    this._seriesNameSpan = this.shadowRoot.querySelector("#hit-div-mosaic-series-name");
    this._episodeNameSpan = this.shadowRoot.querySelector("#hit-div-mosaic-episode-name");
  }

  async setTitle(title) {
    if (this._title === title) return;
    this._title = title;
    if (!this._title) return;

    const activeTitleId = this._title.getId();

    const applyFrontVisual = (name, posterUrl) => {
      if (!this._title || this._title.getId() !== activeTitleId) {
        return;
      }
      if (typeof name === "string" && name.length > 0) {
        this._seriesNameSpan.textContent = name;
      }
      if (posterUrl !== undefined) {
        this._frontDiv.style.backgroundImage = posterUrl
          ? `url(${posterUrl})`
          : "";
      }
    };

    this.classList.add("filterable");
    this._title.getGenresList().forEach((g) => this.classList.add(getUuidByString(g.toLowerCase())));
    this.classList.add(getUuidByString(this._title.getType().toLowerCase()));

    if (this._title.getRating() < 3.5) this.classList.add(getUuidByString("low"));
    else if (this._title.getRating() < 7.0) this.classList.add(getUuidByString("medium"));
    else this.classList.add(getUuidByString("high"));

    if (!this._searchTitleDetail) {
      this._searchTitleDetail = new SearchTitleDetail();
      this._backContainer.appendChild(this._searchTitleDetail);
    }
    this._searchTitleDetail.setTitle(this._title);

    if (this._title.getType() === "TVEpisode") {
      this._seriesNameSpan.textContent = "";
      this._episodeNameSpan.textContent = `${this._title.getName()} S${this._title.getSeason()}E${this._title.getEpisode()}`;

      if (this._title.getSerie()) {
        try {
          const serie = await getTitleInfo(this._title.getSerie(), INDEX_TITLES);
          if (serie) {
            const seriePoster = serie.getPoster ? serie.getPoster() : undefined;
            const seriePosterUrl =
              seriePoster?.getContenturl?.() || seriePoster?.getUrl?.() || "";
            if (seriePosterUrl || serie.getName()) {
              applyFrontVisual(serie.getName(), seriePosterUrl);
            }
          }
        } catch (err) {
          console.warn(`getTitleById failed for serie ${this._title.getSerie()}: ${err?.message || err}. Trying IMDb.`);
          try {
            const imdbSerie = await getImdbInfo(this._title.getSerie());
            if (imdbSerie) {
              const imdbPoster =
                imdbSerie?.Poster?.ContentURL ||
                imdbSerie?.Poster?.ContentUrl ||
                imdbSerie?.Poster?.contenturl ||
                imdbSerie?.Poster?.Url ||
                imdbSerie?.Poster?.url;
              applyFrontVisual(imdbSerie.Name || "", imdbPoster || "");
            }
          } catch (imdbErr) {
            displayError(`Failed to get series poster for ${this._title.getSerie()}: ${imdbErr?.message || imdbErr}`, 3000);
          }
        }
      }

      if (!this._seriesNameSpan.textContent) {
        applyFrontVisual(this._title.getSerie() || "", null);
      }
      if (!this._frontDiv.style.backgroundImage) {
        const fallbackPoster = this._title.getPoster ? this._title.getPoster() : undefined;
        const fallbackPosterUrl =
          fallbackPoster?.getContenturl?.() || fallbackPoster?.getUrl?.() || "";
        if (fallbackPosterUrl) {
          applyFrontVisual(null, fallbackPosterUrl);
        }
      }
    } else {
    
      this._seriesNameSpan.textContent = this._title.getName();
      this._episodeNameSpan.textContent = this._title.getYear() ? `(${this._title.getYear()})` : "";
      const poster = this._title.getPoster ? this._title.getPoster() : undefined;
      const posterUrl = poster?.getContenturl?.() || poster?.getUrl?.() || "";
      if (posterUrl) {
        applyFrontVisual(null, posterUrl);
      } else {
        applyFrontVisual(null, "");
      }
    }
  }
}
customElements.define("globular-search-title-card", SearchTitleCard);

// -----------------------------------------------------------------------------
// SearchTitleDetail
// -----------------------------------------------------------------------------

export class SearchTitleDetail extends HTMLElement {
  _title_ = null;

  _titleCard = null;
  _titlePreview = null;
  _episodePreview = null;
  _seasonSelect = null;
  _episodeSelect = null;
  _episodeInfoBtn = null;
  _playEpisodeVideoBtn = null;
  _playVideoBtn = null;
  _titleInfoBtn = null;
  _loadingEpisodesInfo = null;
  _episodesListContainer = null;
  _videoDiv = null;
  _informationsDiv = null;
  _informationsManager = null;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._renderInitialStructure();
    this._getDomReferences();
    this._bindEventListeners();
  }

  _renderInitialStructure() {
    this.shadowRoot.innerHTML = `
      <style>
        .search-title-detail {
          position:absolute; max-width:256px; max-height:380px; border-radius:8px;
          background-color: var(--surface-color); box-shadow: var(--shadow-elevation-6dp);
          border: 1px solid var(--palette-divider); z-index:1000; bottom:0; left:0; right:0; top:0;
          display:flex; flex-direction:column;
          
        }
        .search-title-detail:hover { box-shadow: var(--shadow-elevation-12dp); }
        .video-div { position:relative; flex-shrink:0; }
        .preview { width:100%; max-height:130px; object-fit:cover; display:block; }
        .title-interaction-div {
          display:flex; position:absolute; top:0; right:10px; left:10px; justify-content:space-between; align-items:center; color:white;
        }
        .title-interaction-div paper-icon-button { --paper-icon-button-ink-color:white; --iron-icon-fill-color:white; }
        .season-episodes-lst {
          display:flex; flex-direction:column; width:100%; flex-grow:1; overflow-y:auto;
        }
        .season-episodes-lst::-webkit-scrollbar {
          width: 10px;
        }
        .season-episodes-lst::-webkit-scrollbar-track {
          background: var(--scroll-track, var(--surface-color));
        }
        .season-episodes-lst::-webkit-scrollbar-thumb {
          background: var(--scroll-thumb, var(--palette-divider));
          border-radius: 6px;
        }
        #loading-episodes-infos { display:flex; flex-direction:column; width:100%; padding:20px; align-items:center; text-align:center; gap:10px; }
        #loading-episodes-infos span { color: var(--secondary-text-color); }
        #episodes-select-div {
          display:flex; align-items:center; padding:10px; background-color: var(--palette-background-dark);
          border-bottom: 1px solid var(--palette-divider); flex-shrink:0;
        }
        #episodes-select-div select {
          height:24px; margin-left:5px; background: var(--surface-color); color: var(--primary-text-color);
          border:1px solid var(--palette-divider); border-radius:4px; padding:2px 5px; flex-grow:1; min-width:0;
        }
        #episodes-select-div paper-icon-button { --iron-icon-fill-color: var(--primary-color); flex-shrink:0; }
        .episode-preview-container { position:relative; flex-shrink:0; }
        #play-episode-video-button {
          position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); --iron-icon-fill-color:white;
          width:48px; height:48px; background-color: rgba(0,0,0,.5); border-radius:50%;
        }
        #informations-div {
          flex-grow:1;
          display:flex;
          flex-direction:column;
          overflow:hidden;
          background-color: var(--surface-color);
          border-top-left-radius: 8px;
          border-top-right-radius: 8px;
          position: relative;
        }

        #informations-div globular-informations-manager {
          flex:1;
          width:100%;
          box-sizing:border-box;
          overflow-x:hidden;
          overflow-y:auto;
        }

        #loading-episodes-infos{
          position: absolute;
          bottom: 0px;
          left: 0px;
          right: 0px;
          max-width: -webkit-fill-available;
        }

        #title-preview, #episode-preview {
          border-top-left-radius: 8px;
          border-top-right-radius: 8px;
        }

      </style>

      <div class="search-title-detail">
        <div class="video-div">
          <video muted loop class="preview" id="title-preview"></video>
          <div class="title-interaction-div">
            <paper-icon-button id="play-video-button" icon="av:play-circle-filled" title="Play Full Video"></paper-icon-button>
            <span style="flex-grow:1;"></span>
            <paper-icon-button id="title-info-button" icon="icons:info-outline" title="View Full Info"></paper-icon-button>
          </div>
        </div>

        <div id="informations-div">
          <globular-informations-manager short show-synopsis hide-genres hide-header compact-synopsis></globular-informations-manager>
        </div>

        <div class="season-episodes-lst" style="display:none;">
          <div id="loading-episodes-infos">
            <span>loading episodes infos wait...</span>
            <paper-progress indeterminate style="width:100%;"></paper-progress>
          </div>
          <div id="episodes-select-div">
            <select id="season-select"></select>
            <select id="episode-select"></select>
            <paper-icon-button id="episode-info-button" icon="icons:info-outline" title="View Episode Info"></paper-icon-button>
          </div>
          <div class="episode-preview-container">
            <video autoplay muted loop class="preview" id="episode-preview"></video>
            <paper-icon-button id="play-episode-video-button" icon="av:play-circle-filled" title="Play Episode"></paper-icon-button>
          </div>
        </div>
      </div>
    `;
  }

  _getDomReferences() {
    this._titleCard = this.shadowRoot.querySelector(".search-title-detail");
    this._titlePreview = this.shadowRoot.querySelector("#title-preview");
    this._episodePreview = this.shadowRoot.querySelector("#episode-preview");
    this._episodesListContainer = this.shadowRoot.querySelector(".season-episodes-lst");
    this._loadingEpisodesInfo = this.shadowRoot.querySelector("#loading-episodes-infos");
    this._videoDiv = this.shadowRoot.querySelector(".video-div");
    this._informationsDiv = this.shadowRoot.querySelector("#informations-div");
    this._seasonSelect = this.shadowRoot.querySelector("#season-select");
    this._episodeSelect = this.shadowRoot.querySelector("#episode-select");
    this._episodeInfoBtn = this.shadowRoot.querySelector("#episode-info-button");
    this._playEpisodeVideoBtn = this.shadowRoot.querySelector("#play-episode-video-button");
    this._playVideoBtn = this.shadowRoot.querySelector("#play-video-button");
    this._titleInfoBtn = this.shadowRoot.querySelector("#title-info-button");
    this._titleInteractionDiv = this.shadowRoot.querySelector(".title-interaction-div");
    this._episodesSelectDiv = this.shadowRoot.querySelector("#episodes-select-div");
    this._informationsManager = this.shadowRoot.querySelector("globular-informations-manager");
  }

  _bindEventListeners() {
    this._titleCard.addEventListener("mouseenter", this._handleTitleCardMouseEnter.bind(this));
    this._titleCard.addEventListener("mouseleave", this._handleTitleCardMouseLeave.bind(this));
    this._episodesListContainer.addEventListener("mouseenter", this._handleEpisodesListMouseEnter.bind(this));
    this._episodesListContainer.addEventListener("mouseleave", this._handleEpisodesListMouseLeave.bind(this));

    if (this._playVideoBtn) this._playVideoBtn.addEventListener("click", this._handlePlayTitleVideoClick.bind(this));
    if (this._titlePreview) this._titlePreview.addEventListener("click", this._handlePlayTitleVideoClick.bind(this));

    if (this._playEpisodeVideoBtn) this._playEpisodeVideoBtn.addEventListener("click", this._handlePlayEpisodeVideoClick.bind(this));
    if (this._episodePreview) this._episodePreview.addEventListener("click", this._handlePlayEpisodeVideoClick.bind(this));

    if (this._titleInfoBtn) this._titleInfoBtn.addEventListener("click", this._handleViewFullTitleInfoClick.bind(this));
    if (this._episodeInfoBtn) this._episodeInfoBtn.addEventListener("click", this._handleViewEpisodeInfoClick.bind(this));

    if (this._seasonSelect) this._seasonSelect.addEventListener("change", this._handleSeasonChange.bind(this));
    if (this._episodeSelect) this._episodeSelect.addEventListener("change", this._handleEpisodeChange.bind(this));
  }

  setTitle(title) {
    if (this._title_ === title) return;
    this._title_ = title;

    if (!this._title_) {
      console.warn("SearchTitleDetail: Title object is missing.");
      return;
    }

    this._populateTitleInfo();
    this._loadAndPlayTitlePreview();
    this._loadEpisodesForSeries();
  }

  _populateTitleInfo() {
    if (this._informationsManager) {
      this._informationsManager.setTitlesInformation([this._title_]);
      if (typeof this._informationsManager.hideHeader === "function") {
        this._informationsManager.hideHeader();
      }
    }
  }

  async _loadAndPlayTitlePreview() {
    const t = this._title_;
    if (!t) return;

    if (t.getType() === "TVSeries") {
      this._titlePreview.style.display = "none";
      this._playVideoBtn.style.display = "none";
      return;
    }

    this._titlePreview.style.display = "block";
    this._playVideoBtn.style.display = "block";

    try {
      const filePaths = await getTitleFilePaths(INDEX_TITLES, t);
      if (filePaths.length > 0) {
        const mainVideoPath = filePaths[0];
        this._titlePreview.src = this._getPreviewVideoUrl(mainVideoPath);
        this._titlePreview.autoplay = true;
        this._titlePreview.muted = true;
        this._titlePreview.loop = true;
        this._titlePreview.play().catch(() => {});
      } else {
        this._titlePreview.style.display = "none";
        this._playVideoBtn.style.display = "none";
      }
    } catch (err) {
      console.error(`Failed to load title preview for ${t.getId()}:`, err);
      this._titlePreview.style.display = "none";
      this._playVideoBtn.style.display = "none";
    }
  }

  _getPreviewVideoUrl(videoPath) {
    let previewPath = videoPath;
    if (previewPath.toLowerCase().includes(".mp4")) {
      previewPath = previewPath.substring(0, previewPath.lastIndexOf("."));
    }
    previewPath = `${previewPath.substring(0, previewPath.lastIndexOf("/") + 1)}.hidden${previewPath.substring(previewPath.lastIndexOf("/"))}/preview.mp4`;

    let url = getBaseUrl() || "";
    previewPath.split("/").forEach((item) => {
      const component = encodeURIComponent(item.trim());
      if (component.length > 0) url += `/${component}`;
    });
    return url;
  }

  async _loadEpisodesForSeries() {
    if (this._title_.getType() !== "TVSeries") {
      this._episodesListContainer.style.display = "none";
      this._videoDiv.style.display = "";
      this._setTitleInfoButtonLocation(false);
      return;
    }

    this._setTitleInfoButtonLocation(true);
    this._episodesListContainer.style.display = "flex";
    this._videoDiv.style.display = "none";
    this._loadingEpisodesInfo.style.display = "flex";

    try {
      const episodes = await GetEpisodes(INDEX_TITLES, this._title_);
      this._loadingEpisodesInfo.style.display = "none";

      const seasonsInfo = {};
      episodes.forEach((e) => {
        if (e.getType() === "TVEpisode" && e.getSeason() > 0) {
          if (!seasonsInfo[e.getSeason()]) seasonsInfo[e.getSeason()] = [];
          seasonsInfo[e.getSeason()].push(e);
        }
      });

      Object.keys(seasonsInfo).forEach((sNum) => {
        seasonsInfo[sNum].sort((a, b) => a.getEpisode() - b.getEpisode());
      });

      this._seasonSelect.innerHTML = "";
      let firstSeasonNum = null;
      for (const sNum in seasonsInfo) {
        const option = document.createElement("option");
        option.value = sNum;
        option.textContent = `Season ${sNum}`;
        option.episodes = seasonsInfo[sNum];
        this._seasonSelect.appendChild(option);
        if (firstSeasonNum === null) firstSeasonNum = sNum;
      }

      if (firstSeasonNum !== null) {
        this._seasonSelect.value = firstSeasonNum;
        this._populateEpisodeSelect(seasonsInfo[firstSeasonNum]);
      }
    } catch (err) {
      console.error(`Failed to load episodes for series ${this._title_.getId()}:`, err);
      displayError("Failed to load episode information.", 3000);
      this._loadingEpisodesInfo.style.display = "none";
    }
  }

  _populateEpisodeSelect(episodes) {
    this._episodeSelect.innerHTML = "";
    let firstEpisode = null;
    episodes.forEach((e) => {
      const option = document.createElement("option");
      option.value = e.getEpisode();
      option.textContent = `Episode ${e.getEpisode()}`;
      option.episode = e;
      this._episodeSelect.appendChild(option);
      if (firstEpisode === null) firstEpisode = e;
    });

    if (firstEpisode) {
      this._setEpisodePreview(firstEpisode);
    } else {
      this._episodePreview.src = "";
      this._playEpisodeVideoBtn.style.display = "none";
    }
  }

  async _setEpisodePreview(episode) {
    if (!episode) {
      this._episodePreview.src = "";
      this._playEpisodeVideoBtn.style.display = "none";
      return;
    }
    try {
      const filePaths = await getTitleFilePaths(INDEX_TITLES, episode);
      if (filePaths.length > 0) {
        const episodeVideoPath = filePaths[0];
        this._episodePreview.src = this._getPreviewVideoUrl(episodeVideoPath);
        this._episodePreview.autoplay = true;
        this._episodePreview.muted = true;
        this._episodePreview.loop = true;
        this._episodePreview.play().catch(() => {});
        this._playEpisodeVideoBtn.style.display = "block";
      } else {
        this._episodePreview.src = "";
        this._playEpisodeVideoBtn.style.display = "none";
        displayMessage(`No video file found for episode "${episode.getName()}" to preview.`, 2000);
      }
    } catch (err) {
      console.error(`Failed to set episode preview for ${episode.getName()}:`, err);
      this._episodePreview.src = "";
      this._playEpisodeVideoBtn.style.display = "none";
    }
  }

  _handleTitleCardMouseEnter() {
    if (!this._title_ || !this._titlePreview) {
      return;
    }
    if (this._title_.getType() !== "TVEpisode" && this._title_.getType() !== "TVSeries") {
      this._titlePreview.play();
    }
    // (episode preview is controlled by its own container hover)
  }

  _handleTitleCardMouseLeave() {
    if (!this._title_ || !this._titlePreview) {
      return;
    }
    if (this._title_.getType() !== "TVEpisode" && this._title_.getType() !== "TVSeries") {
      this._titlePreview.pause();
    }
  }

  _handleEpisodesListMouseEnter() {
    this._episodePreview.play();
  }

  _handleEpisodesListMouseLeave() {
    this._episodePreview.pause();
  }

  _setTitleInfoButtonLocation(inEpisodes) {
    if (!this._titleInfoBtn) return;
    if (inEpisodes) {
      this._titleInfoBtn.style.position = "absolute";
      this._titleInfoBtn.style.top = "-4px";
      this._titleInfoBtn.style.left = "-4px";
      this._titleInfoBtn.style.zIndex = "100";
      this._titleInfoBtn.style.marginLeft = "";
      if (this._informationsDiv && this._titleInfoBtn.parentNode !== this._informationsDiv) {
        this._informationsDiv.appendChild(this._titleInfoBtn);
      }
    } else if (this._titleInteractionDiv && this._titleInfoBtn.parentNode !== this._titleInteractionDiv) {
      this._titleInfoBtn.style.marginLeft = "";
      this._titleInfoBtn.style.position = "";
      this._titleInfoBtn.style.top = "";
      this._titleInfoBtn.style.left = "";
      this._titleInteractionDiv.appendChild(this._titleInfoBtn);
    }
  }

  async _handlePlayTitleVideoClick() {
    if (!this._title_) return;

    try {
      const filePaths = await getTitleFilePaths(INDEX_TITLES, this._title_);
      if (filePaths.length > 0) {
        const mainVideoPath = filePaths[0];
        await playVideo(
          mainVideoPath,
          (playerInstance) => playTitleListener(playerInstance, this._title_, INDEX_TITLES),
          null,
          this._title_
        );
      } else {
        displayMessage(`No video file found for "${this._title_.getName()}".`, 3000);
      }
    } catch (err) {
      displayError(`Failed to play video for "${this._title_.getName()}": ${err?.message || err}`, 3000);
    }
  }

  async _handlePlayEpisodeVideoClick() {
    const selectedEpisodeOption = this._episodeSelect.options[this._episodeSelect.selectedIndex];
    if (!selectedEpisodeOption || !selectedEpisodeOption.episode) return;

    const episode = selectedEpisodeOption.episode;

    try {
      const filePaths = await getTitleFilePaths(INDEX_TITLES, episode);
      if (filePaths.length > 0) {
        const episodeVideoPath = filePaths[0];
        await playVideo(
          episodeVideoPath,
          (playerInstance) => playTitleListener(playerInstance, episode, INDEX_TITLES),
          null,
          episode
        );
      } else {
        displayMessage(`No video file found for episode "${episode.getName()}".`, 3000);
      }
    } catch (err) {
      displayError(`Failed to play episode video: ${err?.message || err}`, 3000);
    }
  }

  _handleViewFullTitleInfoClick() {
    if (this._title_) showGlobalTitleInfo(this._title_);
  }

  _handleViewEpisodeInfoClick() {
    const selectedEpisodeOption = this._episodeSelect.options[this._episodeSelect.selectedIndex];
    if (selectedEpisodeOption && selectedEpisodeOption.episode) {
      showGlobalTitleInfo(selectedEpisodeOption.episode);
    }
  }

  _handleSeasonChange() {
    const selectedOption = this._seasonSelect.options[this._seasonSelect.selectedIndex];
    if (selectedOption && selectedOption.episodes) {
      this._populateEpisodeSelect(selectedOption.episodes);
    }
  }

  _handleEpisodeChange() {
    const selectedOption = this._episodeSelect.options[this._episodeSelect.selectedIndex];
    if (selectedOption && selectedOption.episode) {
      this._setEpisodePreview(selectedOption.episode);
    }
  }
}

customElements.define("globular-search-title-detail", SearchTitleDetail);
