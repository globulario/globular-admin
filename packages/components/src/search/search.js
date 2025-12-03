import getUuidByString from "uuid-by-string";
import { Backend } from "@globular/backend";
import { displayError, displayMessage } from "@globular/backend";
import { playVideo } from "../video";

// ✅ Use backend wrappers (no direct *_Request or raw client calls)
import {
  // streaming: same shape as the service messages (you were reading rsp.hasHit(), etc.)
  searchTitles,
  // unary helper to fetch file paths for a title
  getTitleFiles,
} from "@globular/backend";

import {
  // streaming: same shape as the service messages (summary/facets/hit)
  searchBlogPosts,
} from "@globular/backend";

import {
  // both a stream and a convenience collector exist; we’ll use the collector here
  searchDocuments,
} from "@globular/backend";
 
import { getBaseUrl } from "@globular/backend";

/* ------------------------------------------------------------------------------------------------
 * 1) Focused search: Audio by album — now via title backend stream (cluster-transparent)
 * ------------------------------------------------------------------------------------------------*/
export async function searchAudiosByAlbum(query, indexPath) {
  const audios = [];

  // The stream wrapper yields the same wire messages your old code consumed.
  // We simply replicate your prior parsing on each streamed response.
  await new Promise((resolve, reject) => {
    const cancel = searchTitles(
      {
        indexPath,
        query,
        offset: 0,
        size: 500,
      },
      (rsp) => {
        if (typeof rsp?.hasHit === "function" && rsp.hasHit()) {
          const hit = rsp.getHit();
          if (typeof hit?.hasAudio === "function" && hit.hasAudio()) {
            const audio = hit.getAudio();
            audios.push(audio);
          }
        }
      },
      // onEnd
      () => resolve(),
      // onError
      (err) => {
        displayError(`searchAudiosByAlbum stream error: ${err?.message || err}`, 3000);
        reject(err);
      }
    );

    void cancel; // (we don't use it here)
  });

  return audios;
}

/* ------------------------------------------------------------------------------------------------
 * 2) Get files for a Title — via backend/title helper (cluster-transparent)
 * ------------------------------------------------------------------------------------------------*/
async function getTitleFilePaths(indexPath, title) {
  if (!title || !indexPath) {
    throw new Error("Missing title or index path for getTitleFilePaths.");
  }
  try {
    const paths = await getTitleFiles(indexPath, title.getId());
    return Array.isArray(paths) ? paths : [];
  } catch (err) {
    displayError(`Failed to get files for title ${title.getId()}: ${err?.message || err}`, 3000);
    throw err;
  }
}

/* ------------------------------------------------------------------------------------------------
 * 3) Load Episodes for a Serie — same logic, search via backend/title stream (no globule)
 * ------------------------------------------------------------------------------------------------*/
async function _searchEpisodesForSerie(serieId, indexPath) {
  const hits = await _searchTitles(serieId, [], indexPath, 0, 1000, ["Title", "Episode", "Season"]);
  const episodes = [];

  hits.forEach((hit) => {
    if (typeof hit?.hasTitle === "function" && hit.hasTitle()) {
      const title = hit.getTitle();
      if (typeof title?.getType === "function" && title.getType() === "TVEpisode") {
        episodes.push(title);
      }
    }
  });

  episodes.sort((a, b) => {
    const sa = a.getSeason?.() ?? 0;
    const sb = b.getSeason?.() ?? 0;
    if (sa === sb) return (a.getEpisode?.() ?? 0) - (b.getEpisode?.() ?? 0);
    return sa - sb;
  });

  return episodes;
}

/* ------------------------------------------------------------------------------------------------
 * 4) Tiny in-memory cache for covers & imdb info (no globule; uses getBaseUrl())
 * ------------------------------------------------------------------------------------------------*/
class _CacheManager {
  constructor() {
    this._imageCache = {};
    this._imdbInfoCache = {};
  }

  getCoverDataUrl(videoId, videoUrl, videoPath) {
    const url = this._buildCoverDataUrl(videoId, videoUrl, videoPath);
    return this._imageCache[url];
  }

  setCoverDataUrl(videoId, videoUrl, videoPath, dataUrl) {
    const url = this._buildCoverDataUrl(videoId, videoUrl, videoPath);
    this._imageCache[url] = dataUrl;
  }

  _buildCoverDataUrl(videoId, videoUrl, videoPath) {
    let url = getBaseUrl() || "";
    url += "/api/get-imdb-poster";
    url += `?id=${videoId}&url=${encodeURIComponent(videoUrl)}&path=${encodeURIComponent(videoPath)}`;
    return url;
  }

  getImdbInfo(id) {
    return this._imdbInfoCache[id];
  }

  setImdbInfo(id, info) {
    this._imdbInfoCache[id] = info;
  }
}
const _cacheManager = new _CacheManager();

/* ------------------------------------------------------------------------------------------------
 * 5) Cover data URL (unchanged logic; just relies on getBaseUrl(); no domain header)
 * ------------------------------------------------------------------------------------------------*/
export async function getCoverDataUrl(videoId, videoUrl, videoPath) {
  const cachedData = _cacheManager.getCoverDataUrl(videoId, videoUrl, videoPath);
  if (cachedData) return cachedData;

  const url = _cacheManager._buildCoverDataUrl(videoId, videoUrl, videoPath);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.timeout = 1500;
    xhr.open("GET", url, true);
    xhr.responseType = "text";

    xhr.onload = () => {
      if (xhr.status === 200) {
        _cacheManager.setCoverDataUrl(videoId, videoUrl, videoPath, xhr.responseText);
        resolve(xhr.responseText);
      } else {
        reject(new Error(`Failed to get video cover. Status: ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error(`Network error fetching video cover for ${videoId}.`));
    xhr.ontimeout = () => reject(new Error(`Timeout fetching video cover for ${videoId}.`));
    xhr.send();
  });
}

/* ------------------------------------------------------------------------------------------------
 * 6) IMDb info — no domain header, base URL only
 * ------------------------------------------------------------------------------------------------*/
export async function getImdbInfo(id) {
  const cachedInfo = _cacheManager.getImdbInfo(id);
  if (cachedInfo) return cachedInfo;

  if (!_cacheManager._imdbInfoCache[id] || !_cacheManager._imdbInfoCache[id].promise) {
    _cacheManager._imdbInfoCache[id] = {
      promise: new Promise((resolve, reject) => {
        const url = `${getBaseUrl() || ""}/api/get-imdb-titles?id=${encodeURIComponent(id)}`;
        const xmlhttp = new XMLHttpRequest();
        xmlhttp.timeout = 10_000;

        xmlhttp.onload = () => {
          if (xmlhttp.status >= 200 && xmlhttp.status < 300) {
            try {
              const obj = JSON.parse(xmlhttp.responseText);
              _cacheManager.setImdbInfo(id, obj);
              resolve(obj);
            } catch (e) {
              reject(new Error(`Failed to parse IMDb info for ${id}: ${e.message}`));
            }
          } else {
            reject(new Error(`Failed to get IMDb info for ${id}. Status: ${xmlhttp.status}`));
          }
        };
        xmlhttp.onerror = () => reject(new Error(`Network error fetching IMDb info for ${id}.`));
        xmlhttp.ontimeout = () => reject(new Error(`Timeout fetching IMDb info for ${id}.`));
        xmlhttp.open("GET", url, true);
        xmlhttp.send();
      }),
    };
  }
  return _cacheManager._imdbInfoCache[id].promise;
}

/* ------------------------------------------------------------------------------------------------
 * 7) Title play listener (no globule)
 * ------------------------------------------------------------------------------------------------*/
export async function playTitleListener(player, currentEpisode, indexPath) {
  if (!currentEpisode || !player || !player.media) {
    console.warn("playTitleListener: Missing currentEpisode or player media.");
    return;
  }

  player.media.onended = async () => {
    _exitFullscreen();
    const globalPlayer = document.getElementsByTagName("globular-video-player")[0];
    if (globalPlayer && typeof globalPlayer.close === "function") globalPlayer.close();

    if (localStorage.getItem(currentEpisode.getId())) {
      localStorage.removeItem(currentEpisode.getId());
    }

    try {
      const episodes = await _searchEpisodesForSerie(currentEpisode.getSerie(), indexPath);
      const currentIndex = episodes.findIndex((e) => e.getId() === currentEpisode.getId());
      const nextEpisode = episodes[currentIndex + 1];

      if (!nextEpisode) {
        displayMessage("No more episodes in this series.", 3000);
        return;
      }

      await _promptPlayNextEpisode(nextEpisode, indexPath);
    } catch (err) {
      displayError(`Error finding next episode: ${err.message}`, 3000);
    }
  };

  if (player.media.tagName.toLowerCase() === "video" && player.toggleFullscreen) {
    player.toggleFullscreen();
  }
}

function _exitFullscreen() {
  if (document.exitFullscreen) document.exitFullscreen();
  else if (document.msExitFullscreen) document.msExitFullscreen();
  else if (document.mozCancelFullScreen) document.mozCancelFullScreen();
  else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
}

/* ------------------------------------------------------------------------------------------------
 * 8) Prompt to play next episode (unchanged UI; uses getTitleFilePaths() wrapper now; no globule)
 * ------------------------------------------------------------------------------------------------*/
async function _promptPlayNextEpisode(nextEpisode, indexPath) {
  return new Promise((resolve, reject) => {
    const toast = displayMessage(`
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
    `);

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
            (playerInstance) => {
              playTitleListener(playerInstance, nextEpisode, indexPath);
            },
            null,
            nextEpisode
          );
        } else {
          displayMessage(`No video file found for episode "${nextEpisode.getName()}".`, 3000);
        }
        resolve();
      } catch (err) {
        displayError(`Failed to play next episode: ${err.message}`, 3000);
        reject(err);
      }
    });
  });
}

/* ------------------------------------------------------------------------------------------------
 * 9) Multi-context search entrypoint: cluster-transparent — wrappers handle fan-out
 *    We simply call the right wrapper per context once (no globule loops).
 * ------------------------------------------------------------------------------------------------*/
export async function search(query, contexts, offset = 0, maxResults = 150) {
  for (const context of contexts) {
    const indexPath = `/search/${context}`; // cluster-global logical path
    try {
      if (context === "blogPosts") {
        await _searchBlogPosts(query, contexts, indexPath, offset, maxResults);
      } else if (context === "webPages") {
        await searchWebpageContent(query, contexts, offset, maxResults);
      } else {
        await _searchTitles(query, contexts, indexPath, offset, maxResults);
      }
    } catch (err) {
      displayError(`Search failed for context "${context}": ${err.message || err}`, 3000);
      // continue other contexts
    }
  }
}

/* ------------------------------------------------------------------------------------------------
 * 10) Titles search — via backend/title stream; preserves your publish/collect logic (no globule)
 * ------------------------------------------------------------------------------------------------*/
async function _searchTitles(
  query,
  contexts,
  indexPath,
  offset,
  maxResults,
  fields = null
) {
  const hits = [];

  await new Promise((resolve, reject) => {
    const cancel = searchTitles(
      {
        indexPath,
        query,
        offset,
        size: maxResults,
        fields: fields || undefined,
      },
      (rsp) => {
        if (typeof rsp?.hasSummary === "function" && rsp.hasSummary() && !fields) {
          Backend.eventHub.publish("_display_search_results_", {}, true);
          Backend.eventHub.publish(
            "__new_search_event__",
            { query, summary: rsp.getSummary(), contexts, offset },
            true
          );
        } else if (typeof rsp?.hasFacets === "function" && rsp.hasFacets() && !fields) {
          const uuid = `_${getUuidByString(query)}`;
          Backend.eventHub.publish(`${uuid}_search_facets_event__`, { facets: rsp.getFacets() }, true);
        } else if (typeof rsp?.hasHit === "function" && rsp.hasHit()) {
          const hit = rsp.getHit();

          if (!fields) {
            const uuid = `_${getUuidByString(query)}`;
            const contextName = indexPath.substring(indexPath.lastIndexOf("/") + 1);
            const snippets = hit.getSnippetsList?.() ?? [];
            snippets.forEach(() => {
              Backend.eventHub.publish(`${uuid}_search_hit_event__`, { hit, context: contextName }, true);
            });
          } else {
            hits.push(hit);
          }
        }
      },
      () => resolve(),
      (err) => {
        displayError(`SearchTitles stream error: ${err?.message || err}`, 3000);
        reject(err);
      }
    );
    void cancel;
  });

  return hits;
}

/* ------------------------------------------------------------------------------------------------
 * 11) Blog posts — via backend/blog stream; preserves your event publishing (no globule)
 * ------------------------------------------------------------------------------------------------*/
async function _searchBlogPosts(query, contexts, indexPath, offset, maxResults) {
  await new Promise((resolve, reject) => {
    const cancel = searchBlogPosts(
      {
        indexPath,
        query,
        offset,
        size: maxResults,
      },
      (rsp) => {
        if (typeof rsp?.hasSummary === "function" && rsp.hasSummary()) {
          Backend.eventHub.publish("_display_search_results_", {}, true);
          Backend.eventHub.publish(
            "__new_search_event__",
            { query, summary: rsp.getSummary(), contexts, offset },
            true
          );
        } else if (typeof rsp?.hasFacets === "function" && rsp.hasFacets()) {
          const uuid = `_${getUuidByString(query)}`;
          Backend.eventHub.publish(`${uuid}_search_facets_event__`, { facets: rsp.getFacets() }, true);
        } else if (typeof rsp?.hasHit === "function" && rsp.hasHit()) {
          const hit = rsp.getHit();
          const uuid = `_${getUuidByString(query)}`;
          Backend.eventHub.publish(`${uuid}_search_hit_event__`, { hit, context: "blogPosts" }, true);
        }
      },
      () => resolve(),
      (err) => {
        displayError(`SearchBlogPosts stream error: ${err?.message || err}`, 3000);
        reject(err);
      }
    );
    void cancel;
  });
}

/* ------------------------------------------------------------------------------------------------
 * 12) Web page search — uses backend/search_document collector (cluster-transparent)
 * ------------------------------------------------------------------------------------------------*/
export async function searchWebpageContent(query, contexts, offset, maxResults) {
  const router = document.querySelector("globular-router");
  const application = router ? router.getAttribute("base") || "" : "";
  const indexRoot = `/search/applications/${application}`; // cluster-global logical path

  const opts = {
    paths: [indexRoot],
    language: "en",
    fields: ["Text"],
    offset,
    pageSize: maxResults,
    query,
    application, // forwarded if your gateway expects it
    snippetLength: 0,
  };

  const start = performance.now();
  const results = await searchDocuments(opts);
  const took = performance.now() - start;

  Backend.eventHub.publish(
    "__new_search_event__",
    {
      query,
      summary: {
        getTotal: () => results.length,
        getTook: () => took,
      },
      contexts,
      offset,
    },
    true
  );

  // Keeps compatibility: publish the raw results array to the same channel you used before
  Backend.eventHub.publish(`display_webpage_search_result_${query}`, results, true);
}