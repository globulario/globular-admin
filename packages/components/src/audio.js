// src/components/audio.js

import WaveSurfer from "wavesurfer.js"
import { secondsToTime, fireResize } from "./utility"

// UI bus + helpers
import { Backend, displayError, saveWatchingTitle } from "@globular/backend"

// New function-style backends
import * as Title from "@globular/backend"
import * as Files from "@globular/backend"

// Playlist widget
import { PlayList } from "./playlist"

// Proto types
import { Audio, Poster } from "globular-web-client/title/title_pb"
import { getBaseUrl } from "@globular/backend"

// --- Constants ---
const AUDIO_PLAYER_ID = "globular-audio-player-instance"
const DEFAULT_AUDIO_COVER = new URL('../assets/icons/music-quavers-flat.svg', import.meta.url).href

const AUDIO_LOOP_STORAGE_KEY = "audio_loop"
const AUDIO_SHUFFLE_STORAGE_KEY = "audio_shuffle"
const AUDIO_VOLUME_STORAGE_KEY = "audio_volume"

const MAX_AUDIO_BLOB_SIZE = 48_000_000 // 48 MB

// ---------- helpers ----------

function getAuthToken() {
  try {
    const t = sessionStorage.getItem("__globular_token__")
    if (t) return t
  } catch {}
  return undefined
}

/** Build a signed file URL with token + optional application, no globule needed. */
function buildFileUrl(rawPath, token = getAuthToken(), application) {
  // If rawPath is absolute (http/https), append/merge token there.
  if (/^https?:\/\//i.test(String(rawPath))) {
    try {
      const u = new URL(rawPath)
      if (token) u.searchParams.set("token", token)
      if (application) u.searchParams.set("application", application)
      return u.toString()
    } catch {
      // fallthrough to safer concat below
    }
  }

  // Otherwise, build from current backend base URL
  let url = getBaseUrl()
  const parts = String(rawPath || "")
    .split("/")
    .map(p => p.trim())
    .filter(Boolean)
  parts.forEach(p => (url += "/" + encodeURIComponent(p)))

  const qs = new URLSearchParams()
  if (token) qs.set("token", token)
  if (application) qs.set("application", application)
  const q = qs.toString()
  if (q) url += (url.includes("?") ? "&" : "?") + q
  return url
}

/** Title->files indirection via Title helpers (no direct service calls). */
async function getTitleFiles(titleId, indexPath) {
  try {
    if (Title?.getTitleFiles) return await Title.getTitleFiles(titleId, indexPath)
  } catch (err) {
    displayError(`Failed to get title files for ID ${titleId}: ${err?.message || err}`)
  }
  return []
}

/** HEAD probe to confirm URL reachability. */
async function assertReachable(url) {
  const res = await fetch(url, { method: "HEAD" })
  if (res.status === 401) throw new Error("401 Unauthorized")
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

// ---------- public API ----------

/**
 * Create an M3U playlist from Audio objects and play it.
 * Uses Title.getTitleFiles for each audio id.
 */
export async function playAudios(audios, name) {
  const uniqueAudios = [...new Map(audios.map(a => [a.getId(), a])).values()]
  let m3u = "#EXTM3U\n"
  m3u += `#PLAYLIST: ${name}\n\n`

  for (const audio of uniqueAudios) {
    try {
      // Without globule, we default to standard index path; your Title helper can ignore it if not needed
      const idx = "/search/audios"
      const files = await getTitleFiles(audio.getId(), idx)
      if (files.length) {
        // prefer a concrete file path
        const first = files[0]
        const fileUrl = buildFileUrl(first)
        const dur = audio.getDuration ? audio.getDuration() : 0
        const title = (audio.getTitle && audio.getTitle()) || ""
        m3u += `#EXTINF:${dur}, ${title}, tvg-id="${audio.getId()}"\n`
        m3u += `${fileUrl}\n\n`
      }
    } catch (e) {
      console.error(`Audio ${audio.getId()} error:`, e)
    }
  }

  playAudio(m3u)
}

/**
 * Entrypoint to play a single audio file or a whole playlist.
 */
export async function playAudio(path, onPlay, onClose, audioInfo) {
  let player = document.getElementById(AUDIO_PLAYER_ID)
  if (!player) {
    player = new AudioPlayer()
    player.id = AUDIO_PLAYER_ID
    document.body.appendChild(player)
  } else {
    player.stop()
    player.playlist.clear()
  }

  player.style.zIndex = 100
  player.onPlay = onPlay || player.onPlay
  player.onClose = onClose || player.onClose

  player._audioData = audioInfo || null

  if (String(path).endsWith("audio.m3u") || String(path).startsWith("#EXTM3U")) {
    player.loadPlaylist(path)
  } else {
    // single file
    try {
      // optional local check (path-only)
      let existsLocally = false
      if (Files?.hasLocal) {
        try {
          const { exists } = await Files.hasLocal(path)
          existsLocally = !!exists
        } catch { /* ignore */ }
      }
      await player.play(path, audioInfo || null, existsLocally)
      player.hidePlaylist()
    } catch (err) {
      displayError(`Failed to play audio ${path}: ${err?.message || err}`)
      player.close()
    }
  }
  return player
}

// ---------- Component ----------

export class AudioPlayer extends HTMLElement {
  constructor() {
    super()
    this.attachShadow({ mode: "open" })

    // state
    this._wavesurfer = null
    this._audioData = null
    this._currentPath = ""
    this._loop = localStorage.getItem(AUDIO_LOOP_STORAGE_KEY) === "true"
    this._shuffle = localStorage.getItem(AUDIO_SHUFFLE_STORAGE_KEY) === "true"

    // callbacks
    this._onMinimize = null
    this._onClose = () => {}
    this._onPlay = () => {}

    // refs
    this._container = null
    this._content = null
    this._titleSpan = null
    this._audioElement = null
    this._albumNameElement = null
    this._albumYearElement = null
    this._albumCoverElement = null
    this._trackTitleElement = null
    this._trackInfoElement = null
    this._waveformElement = null
    this._playSlider = null
    this._currentTimeSpan = null
    this._totalTimeSpan = null
    this._playBtn = null
    this._pauseBtn = null
    this._stopBtn = null
    this._skipNextBtn = null
    this._skipPreviousBtn = null
    this._fastForwardBtn = null
    this._fastRewindBtn = null
    this._loopBtn = null
    this._shuffleBtn = null
    this._volumeBtn = null
    this._vizWrapper = null

    // playlist
    this.playlist = new PlayList()

    this._renderHTML()
  }

  connectedCallback() {
    this._cacheElements()
    this._setupEventListeners()
    this._initializeWaveSurfer()
    this._applyInitialPlayerState()
    this._setupInitialPlaylist()
    this._setupResponsiveSizing()
  }

  disconnectedCallback() {
    this._cleanupEventListeners()
    if (this._wavesurfer) {
      this._wavesurfer.destroy()
      this._wavesurfer = null
    }
  }

  // --------- template ----------


  _renderHTML() {

    const icon = DEFAULT_AUDIO_COVER;
    this.shadowRoot.innerHTML = `
      <style>
        .header{display:flex;align-items:center;color:var(--palette-text-accent);background-color:var(--palette-primary-accent);}
        .header paper-icon-button{min-width:40px;}
        .header span{flex-grow:1;text-align:center;font-size:1.1rem;font-weight:500;display:inline-block;white-space:nowrap;overflow:hidden !important;text-overflow:ellipsis;max-width:calc(100vw - 50px);}
        ::-webkit-scrollbar {
          width: 10px;
        }
        ::-webkit-scrollbar-track {
          background: var(--scroll-track, var(--surface-color));
        }
        ::-webkit-scrollbar-thumb {
          background: var(--scroll-thumb, var(--palette-divider));
          border-radius: 6px;
        }
        #content{height:100%;width:100%;display:flex;background:#000;justify-content:center;overflow:hidden;color:var(--primary-text-color);}
        @media (max-width:600px){
          .header{width:100vw;}
          #content{overflow-y:auto;width:100vw;max-width:100vw;min-width:0;background:black;flex-direction:column-reverse;height:410px;overflow:hidden;}
        }
        .vz-wrapper{width:100%;max-height:calc(100vh - 100px);min-height:600px;overflow-y:auto;max-width:100vw;padding:0 5px;display:flex;flex-direction:column;justify-content:center;align-items:center;
          background: radial-gradient(circle,#39668b,#000);box-shadow: inset 0 0 160px 0 #000;cursor:pointer;}
        .vz-wrapper img{max-width:300px;max-height:300px;}
        .vz-wrapper.-canvas{height:initial;width:initial;background:transparent;box-shadow:none;}
        iron-icon{fill:white;}
        @media screen and (min-width:420px){.vz-wrapper{box-shadow: inset 0 0 200px 60px #000;}}
        .buttons{width:100%;display:flex;justify-content:center;align-items:center;flex-direction:column;margin-bottom:10px;}
        .buttons iron-icon{transition:.3s;height:20px;width:20px;}
        .buttons span{color:white;font-size:.75rem;padding:0 2px;}
        .buttons iron-icon:hover{cursor:pointer;height:24px;width:24px;}
        .toolbar iron-icon{transition:.3s;height:28px;width:28px;}
        .toolbar iron-icon:hover{cursor:pointer;height:32px;width:32px;}
        .toolbar #pause, #play-arrow-btn{transition:.3s;height:40px;width:40px;}
        .toolbar #pause:hover, #play-arrow-btn:hover{cursor:pointer;height:42px;width:42px;}
        #shuffle-btn,#skip-previous-btn{padding-right:20px;}
        #repeat-btn,#skip-next-btn{padding-left:20px;}
        #skip-previous-btn{padding-right:10px;} #skip-next-btn{padding-left:10px;}
        #controls{flex-grow:1;display:flex;align-items:center;width:100%;margin-right:10px;}
        #waveform{width:100%;align-self:center;} audio{display:none;}
        .album-name{font-size:1.5rem;font-weight:500;color:white;white-space:nowrap;overflow:hidden !important;text-overflow:ellipsis;text-align:center;}
        .album-year{font-size:1.5rem;padding-left:20px;color:white;}
        .album-cover{margin:10px 0;border:1px solid black;box-shadow:5px 5px 15px 5px #152635;}
        .track-title{margin-top:10px;font-size:1.6rem;flex-grow:1;color:white;display:inline-block;white-space:initial;overflow:hidden !important;text-overflow:ellipsis;text-align:center;}
        #track-info-display{position:absolute;bottom:10px;left:20px;color:white;font-size:1.6rem;}
        @media (max-width:600px){
          .album-year{display:none;}
          .track-title{font-size:1.25rem;}
          #track-info-display{bottom:50px;font-size:1rem;}
          .vz-wrapper{height:auto;padding:0;min-width:0;overflow-y:inherit;}
          .vz-wrapper img{max-width:180px;max-height:180px;}
        }
      </style>

      <globular-dialog id="audio-container" name="audio-player" is-moveable="true" is-maximizeable="true" is-resizeable="true" show-icon="true" is-minimizeable="true">
        <span id="title-span" slot="title">no select</span>
        <img slot="icon" src="${icon}"/>
        <div id="content">
          <slot name="playlist"></slot>
          <div class="vz-wrapper">
            <div id="track-info-display"></div>
            <div style="display:flex;margin-top:10px;">
              <span class="album-name"></span>
              <span class="album-year"></span>
            </div>
            <img class="album-cover"/>
            <span class="track-title"></span>
            <div id="waveform"></div>
            <div class="buttons">
              <div id="controls">
                <paper-slider id="play-slider" style="flex-grow:1;"></paper-slider>
                <div style="display:flex;align-items:center;padding-right:10px;">
                  <span id="current-time-span"></span><span>/</span><span id="total-time-span"></span>
                </div>
                <div style="position:relative;">
                  <iron-icon id="volume-up-btn" icon="av:volume-up"></iron-icon>
                </div>
              </div>
              <div class="toolbar" style="display:flex;padding:0 10px;align-items:center;height:40px;margin-top:20px;">
                <iron-icon title="Shuffle Playlist" id="shuffle-btn" icon="av:shuffle"></iron-icon>
                <iron-icon id="skip-previous-btn" title="Previous Track" icon="av:skip-previous"></iron-icon>
                <iron-icon id="fast-rewind-btn" title="Rewind" icon="av:fast-rewind"></iron-icon>
                <iron-icon id="play-arrow-btn" title="Play" icon="av:play-circle-outline"></iron-icon>
                <iron-icon id="pause-btn" title="Pause" style="display:none;" icon="av:pause-circle-outline"></iron-icon>
                <iron-icon id="fast-forward-btn" title="Forward" icon="av:fast-forward"></iron-icon>
                <iron-icon id="skip-next-btn" title="Next Track" icon="av:skip-next"></iron-icon>
                <iron-icon id="stop-btn" title="Stop" icon="av:stop"></iron-icon>
                <iron-icon title="Loop Playlist" id="repeat-btn" icon="av:repeat"></iron-icon>
              </div>
            </div>
          </div>
          <slot name="tracks"></slot>
        </div>
        <audio></audio>
      </globular-dialog>
    `
  }

  _cacheElements() {
    this._container = this.shadowRoot.querySelector("#audio-container")
    this._content = this.shadowRoot.querySelector("#content")
    this._titleSpan = this.shadowRoot.querySelector("#title-span")
    this._audioElement = this.shadowRoot.querySelector("audio")

    this._albumNameElement = this.shadowRoot.querySelector(".album-name")
    this._albumYearElement = this.shadowRoot.querySelector(".album-year")
    this._albumCoverElement = this.shadowRoot.querySelector(".album-cover")
    this._trackTitleElement = this.shadowRoot.querySelector(".track-title")
    this._trackInfoElement = this.shadowRoot.querySelector("#track-info-display")
    this._waveformElement = this.shadowRoot.querySelector("#waveform")
    this._playSlider = this.shadowRoot.querySelector("#play-slider")
    this._currentTimeSpan = this.shadowRoot.querySelector("#current-time-span")
    this._totalTimeSpan = this.shadowRoot.querySelector("#total-time-span")

    this._playBtn = this.shadowRoot.querySelector("#play-arrow-btn")
    this._pauseBtn = this.shadowRoot.querySelector("#pause-btn")
    this._stopBtn = this.shadowRoot.querySelector("#stop-btn")
    this._skipNextBtn = this.shadowRoot.querySelector("#skip-next-btn")
    this._skipPreviousBtn = this.shadowRoot.querySelector("#skip-previous-btn")
    this._fastForwardBtn = this.shadowRoot.querySelector("#fast-forward-btn")
    this._fastRewindBtn = this.shadowRoot.querySelector("#fast-rewind-btn")
    this._loopBtn = this.shadowRoot.querySelector("#repeat-btn")
    this._shuffleBtn = this.shadowRoot.querySelector("#shuffle-btn")
    this._volumeBtn = this.shadowRoot.querySelector("#volume-up-btn")
    this._vizWrapper = this.shadowRoot.querySelector(".vz-wrapper")
  }

  _setupEventListeners() {
    if (this._container) {
      this._container.onclick = e => e.stopPropagation()
      this._container.getPreview = this.getPreview.bind(this)
      this._container.onclose = this.close.bind(this)
      this._container.onminimize = this._handleMinimize.bind(this)
      this._container.setAttribute("resize-direction", "horizontal")
      this._container.style.minWidth = "360px"
      this._container.style.minHeight = "320px"
      this._container.style.width = this._container.style.width || "640px"
      if (typeof this._container.setBackGroundColor === "function") {
        this._container.setBackGroundColor("rgba(0,0,0,0.85)")
      }
    }

    this.playlist.audioPlayer = this

    this._playBtn.addEventListener("click", this._handlePlayClick)
    this._pauseBtn.addEventListener("click", this._handlePauseClick)
    this._stopBtn.addEventListener("click", this._handleStopClick)
    this._skipNextBtn.addEventListener("click", this._handleSkipNextClick)
    this._skipPreviousBtn.addEventListener("click", this._handleSkipPreviousClick)
    this._loopBtn.addEventListener("click", this._handleLoopToggle)
    this._shuffleBtn.addEventListener("click", this._handleShuffleToggle)
    this._volumeBtn.addEventListener("click", this._handleVolumeClick)
    this._fastForwardBtn.addEventListener("click", this._handleFastForward)
    this._fastRewindBtn.addEventListener("click", this._handleFastRewind)

    this._playSlider.addEventListener("mousedown", this._handleSliderMouseDown)
    this._playSlider.addEventListener("mouseup", this._handleSliderMouseUp)
    this._playSlider.addEventListener("change", this._handleSliderChange)

    this._albumCoverElement.addEventListener("click", this._handleCoverClick)
    this._vizWrapper.addEventListener("click", this._handleVizWrapperClick)

    window.addEventListener("resize", this._handleWindowResize)
  }

  _cleanupEventListeners() {
    if (this._container) {
      this._container.onclick = null
      this._container.getPreview = null
      this._container.onclose = null
      this._container.onminimize = null
    }

    this._playBtn.removeEventListener("click", this._handlePlayClick)
    this._pauseBtn.removeEventListener("click", this._handlePauseClick)
    this._stopBtn.removeEventListener("click", this._handleStopClick)
    this._skipNextBtn.removeEventListener("click", this._handleSkipNextClick)
    this._skipPreviousBtn.removeEventListener("click", this._handleSkipPreviousClick)
    this._loopBtn.removeEventListener("click", this._handleLoopToggle)
    this._shuffleBtn.removeEventListener("click", this._handleShuffleToggle)
    this._volumeBtn.removeEventListener("click", this._handleVolumeClick)
    this._fastForwardBtn.removeEventListener("click", this._handleFastForward)
    this._fastRewindBtn.removeEventListener("click", this._handleFastRewind)

    this._playSlider.removeEventListener("mousedown", this._handleSliderMouseDown)
    this._playSlider.removeEventListener("mouseup", this._handleSliderMouseUp)
    this._playSlider.removeEventListener("change", this._handleSliderChange)

    this._albumCoverElement.removeEventListener("click", this._handleCoverClick)
    this._vizWrapper.removeEventListener("click", this._handleVizWrapperClick)

    window.removeEventListener("resize", this._handleWindowResize)

    if (this._wavesurfer) {
      this._wavesurfer.un("seek", this._wavesurferSeekHandler)
      this._wavesurfer.un("ready", this._wavesurferReadyHandler)
      this._wavesurfer.un("audioprocess", this._wavesurferAudioProcessHandler)
      this._wavesurfer.un("finish", this._wavesurferFinishHandler)
      this._wavesurfer.destroy()
    }
  }

  _handleMinimize() {
    if (this._onMinimize) this._onMinimize()
  }

  // ---- controls handlers ----
  _handlePlayClick = (e) => {
    e.stopPropagation()
    this._wavesurfer.play()
    this._playBtn.style.display = "none"
    this._pauseBtn.style.display = "block"
    this.playlist.resumePlaying()
  }

  _handlePauseClick = (e) => {
    e.stopPropagation()
    this.playlist.pausePlaying()
    this.pause()
  }

  _handleStopClick = () => {
    this.stop()
    this.playlist.stop()
    if (this._trackInfoElement) this._trackInfoElement.innerHTML = ""
  }

  _handleSkipNextClick = () => {
    this.stop()
    this.playlist.playNext()
  }

  _handleSkipPreviousClick = () => {
    this.stop()
    this.playlist.playPrevious()
  }

  _handleLoopToggle = () => {
    this._loop = !this._loop
    localStorage.setItem(AUDIO_LOOP_STORAGE_KEY, String(this._loop))
    this._loopBtn.style.fill = this._loop ? "white" : "gray"
  }

  _handleShuffleToggle = () => {
    this._shuffle = !this._shuffle
    localStorage.setItem(AUDIO_SHUFFLE_STORAGE_KEY, String(this._shuffle))
    this._shuffleBtn.style.fill = this._shuffle ? "white" : "gray"
    this.playlist.orderItems()
  }

  _handleVolumeClick = (evt) => {
    evt.stopPropagation()
    const existing = this.shadowRoot.querySelector("#volume-panel")
    if (existing) { existing.remove(); return }

    const html = `
      <paper-card id="volume-panel" style="position:absolute;top:24px;right:0;z-index:100;padding:10px;">
        <div style="display:flex;align-items:center;">
          <iron-icon id="volume-down-icon" icon="av:volume-down" style="fill:white;"></iron-icon>
          <paper-slider id="volume-slider" style="flex-grow:1;"></paper-slider>
          <iron-icon id="volume-up-icon" icon="av:volume-up" style="fill:white;"></iron-icon>
        </div>
      </paper-card>
    `
    const range = document.createRange()
    this._volumeBtn.parentNode.appendChild(range.createContextualFragment(html))
    const panel = this.shadowRoot.querySelector("#volume-panel")
    if (!panel) return

    const volumeSlider = panel.querySelector("#volume-slider")
    const volumeDownIcon = panel.querySelector("#volume-down-icon")
    const volumeUpIcon = panel.querySelector("#volume-up-icon")

    volumeSlider.max = 100
    volumeSlider.value = (this._wavesurfer.getVolume() || 0) * 100

    if (this._wavesurfer.getVolume() === 0) volumeDownIcon.icon = "av:volume-off"

    volumeSlider.addEventListener("click", e => e.stopPropagation())
    volumeSlider.addEventListener("change", () => {
      const vol = Number(volumeSlider.value / 100)
      this._wavesurfer.setVolume(vol)
      localStorage.setItem(AUDIO_VOLUME_STORAGE_KEY, String(vol))
      this._updateVolumeIcons(vol, volumeDownIcon, volumeUpIcon)
    })

    volumeDownIcon.addEventListener("click", (e) => {
      e.stopPropagation()
      let v = volumeSlider.value - 10
      v = Math.max(0, v)
      this._updateVolumeIcons(v / 100, volumeDownIcon, volumeUpIcon)
      volumeSlider.value = v
      this._wavesurfer.setVolume(Number(v / 100))
    })

    volumeUpIcon.addEventListener("click", (e) => {
      e.stopPropagation()
      let v = volumeSlider.value + 10
      v = Math.min(100, v)
      this._updateVolumeIcons(v / 100, volumeDownIcon, volumeUpIcon)
      volumeSlider.value = v
      this._wavesurfer.setVolume(Number(v / 100))
    })
  }

  _updateVolumeIcons(volume, downIcon, upIcon) {
    if (volume === 0) {
      this._volumeBtn.icon = "av:volume-off"
      downIcon.icon = "av:volume-off"
    } else {
      this._volumeBtn.icon = "av:volume-up"
      downIcon.icon = "av:volume-down"
    }
  }

  _handleVizWrapperClick = (evt) => {
    const p = this.shadowRoot.querySelector("#volume-panel")
    if (p && !p.contains(evt.target)) p.remove()
  }

  _handleCoverClick = (evt) => {
    evt.stopPropagation()
    if (this._playBtn.style.display === "none") this._pauseBtn.click()
    else this._playBtn.click()
  }

  _handleFastForward = () => {
    if (!this._wavesurfer.isPlaying()) return
    const duration = this._wavesurfer.getDuration()
    const next = this._wavesurfer.getCurrentTime() + duration * 0.1
    if (next < duration) this._seekAndCenter(next / duration)
    else this.stop()
  }

  _handleFastRewind = () => {
    if (!this._wavesurfer.isPlaying()) return
    const duration = this._wavesurfer.getDuration()
    const prev = this._wavesurfer.getCurrentTime() - duration * 0.1
    if (prev > 0) this._seekAndCenter(prev / duration)
    else this.stop()
  }

  _handleSliderMouseDown = () => { this._playSlider.busy = true }
  _handleSliderMouseUp = () => {
    if (this._wavesurfer) {
      const dur = this._wavesurfer.getDuration() || 1
      this._wavesurfer.seekTo(this._playSlider.value / dur)
      this._playSlider.busy = false
    }
  }
  _handleSliderChange = () => {}

  // ---- wavesurfer callbacks ----
  _wavesurferSeekHandler = () => {
    if (!this._wavesurfer.backend.source) return
    if (this._wavesurfer.isPlaying()) {
      this._playBtn.style.display = "none"
      this._pauseBtn.style.display = "block"
    } else {
      this._playBtn.style.display = "block"
      this._pauseBtn.style.display = "none"
    }
  }

  _wavesurferReadyHandler = () => {
    if (!this._wavesurfer) return
    this._playSlider.max = this._wavesurfer.getDuration()

    const vol = localStorage.getItem(AUDIO_VOLUME_STORAGE_KEY)
    if (vol !== null) this._wavesurfer.setVolume(parseFloat(vol))

    const total = secondsToTime(this._wavesurfer.getDuration())
    this._totalTimeSpan.innerHTML =
      `${total.h.toString().padStart(2,"0")}:` +
      `${total.m.toString().padStart(2,"0")}:` +
      `${total.s.toString().padStart(2,"0")}`

    // resume if stored
    if (this._audioData?.getId) {
      const t = localStorage.getItem(this._audioData.getId())
      if (t) {
        const pos = Math.min(parseFloat(t), this._wavesurfer.getDuration() - 0.25)
        if (!Number.isNaN(pos) && pos > 0) this._wavesurfer.seekTo(pos / this._wavesurfer.getDuration())
      }
    }

    this._wavesurfer.play()
    this._playBtn.style.display = "none"
    this._pauseBtn.style.display = "block"
    fireResize()
  }

  _seekAndCenter(value) {
    if (!this._wavesurfer) return
    const fn =
      typeof this._wavesurfer.seekAndCenter === "function"
        ? this._wavesurfer.seekAndCenter
        : this._wavesurfer.seekTo
    if (typeof fn === "function") fn.call(this._wavesurfer, value)
  }

  _wavesurferAudioProcessHandler = (position) => {
    if (!this._wavesurfer) return
    const duration = this._wavesurfer.getDuration()
    if (!this._playSlider.busy) this._playSlider.value = position
    this._playSlider.title = `${((position / (duration || 1)) * 100).toFixed(2)}%`

    const ct = secondsToTime(position)
    this._currentTimeSpan.innerHTML =
      `${ct.h.toString().padStart(2,"0")}:` +
      `${ct.m.toString().padStart(2,"0")}:` +
      `${ct.s.toString().padStart(2,"0")}`
  }

  _wavesurferFinishHandler = async () => {
    if (this.playlist.count() > 1) {
      this.playlist.playNext()
    } else if (this._loop) {
      if (this._currentPath && this._audioData) {
        try {
          let existsLocally = false
          if (Files?.hasLocal) {
            const { exists } = await Files.hasLocal(this._currentPath)
            existsLocally = !!exists
          }
          await this.play(this._currentPath, this._audioData, existsLocally)
        } catch (e) {
          displayError(`Failed to replay audio: ${e?.message || e}`)
          this.stop()
        }
      } else {
        this.stop()
      }
    } else {
      this.stop()
    }
  }

  _handleWindowResize = () => {
    const w = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth
    if (w < 600) {
      this._content.style.height = "calc(100vh - 100px)"
      this._content.style.overflowY = "auto"
      if (this._vizWrapper) this._vizWrapper.style.minWidth = "0px"
    } else {
      this._content.style.height = ""
      this._content.style.overflowY = ""
      if (this._vizWrapper) this._vizWrapper.style.minWidth = "600px"
    }
  }

  _applyInitialPlayerState() {
    this._loopBtn.style.fill = this._loop ? "white" : "gray"
    this._shuffleBtn.style.fill = this._shuffle ? "white" : "gray"
  }

  _setupInitialPlaylist() {
    this.playlist.slot = "playlist"
    this.appendChild(this.playlist)
    this.playlist.audioPlayer = this
    this.loadTracks("Initial Playlist")
  }

  _initializeWaveSurfer() {
    if (this._wavesurfer) this._wavesurfer.destroy()
    this._wavesurfer = WaveSurfer.create({
      container: this._waveformElement,
      scrollParent: true,
      waveColor: "#93a1ad",
      progressColor: "#172a39",
      background: "transparent",
      height: 70,
      cursorColor: "#1976d2",
      hideScrollbar: true,
      xhr: { cache: "default", mode: "no-cors" }
    })

    this._wavesurfer.on("seek", this._wavesurferSeekHandler)
    this._wavesurfer.on("ready", this._wavesurferReadyHandler)
    this._wavesurfer.on("audioprocess", this._wavesurferAudioProcessHandler)
    this._wavesurfer.on("finish", this._wavesurferFinishHandler)
  }

  _setupResponsiveSizing() {
    this._handleWindowResize()
    fireResize()
  }

  // ---------- public methods ----------

  getPreview() {
    if (!this._previewElement) {
      this._previewElement = document.createElement("div")
      this._previewElement.style.cssText =
        "position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;flex-direction:column;justify-content:center;user-select:none;background:rgba(0,0,0,.5);overflow:hidden;background-size:cover;background-position:center;background-blend-mode:overlay;background-repeat:no-repeat;"

      this._previewElement._title = document.createElement("span")
      this._previewElement.artist = document.createElement("span")
      this._previewElement.album = document.createElement("span")
      this._previewElement.trackInfo = document.createElement("span")
      this._previewElement.currentTimeSpan = document.createElement("span")

      this._previewElement.appendChild(this._previewElement._title)
      this._previewElement.appendChild(this._previewElement.artist)
      this._previewElement.appendChild(this._previewElement.album)

      const buttons = document.createElement("div")
      buttons.style.cssText = "display:flex;justify-content:center;align-items:center;flex-direction:row;flex-grow:1;margin-top:10px;"

      const mkBtn = (icon, size, handler, id) => {
        const btn = document.createElement("iron-icon")
        btn.style.cssText = `fill:white;height:${size}px;width:${size}px;cursor:pointer;margin:0 5px;`
        btn.icon = icon
        btn.id = id
        btn.onclick = (evt) => {
          evt.stopPropagation()
          handler()
          this._container.dispatchEvent(new CustomEvent("refresh-preview", { bubbles: true, composed: true }))
        }
        return btn
      }

      const prev = mkBtn("av:skip-previous", 32, () => this._skipPreviousBtn.click(), "preview-skip-previous-btn")
      const play = mkBtn("av:play-circle-outline", 48, () => this._playBtn.click(), "preview-play-btn")
      const pause = mkBtn("av:pause-circle-outline", 48, () => this._pauseBtn.click(), "preview-pause-btn")
      const next = mkBtn("av:skip-next", 32, () => this._skipNextBtn.click(), "preview-skip-next-btn")

      buttons.appendChild(prev); buttons.appendChild(play); buttons.appendChild(pause); buttons.appendChild(next)
      this._previewElement.appendChild(buttons)
      this._previewElement.appendChild(this._previewElement.trackInfo)
      this._previewElement.appendChild(this._previewElement.currentTimeSpan)

      setInterval(() => {
        if (this._previewElement.currentTimeSpan && this._currentTimeSpan && this._totalTimeSpan) {
          this._previewElement.currentTimeSpan.innerHTML = `${this._currentTimeSpan.innerHTML} / ${this._totalTimeSpan.innerHTML}`
        }
      }, 1000)
    }

    if (this._audioData) {
      const poster = this._audioData.getPoster && this._audioData.getPoster()
      const posterUrl = poster && poster.URL ? poster.URL : DEFAULT_AUDIO_COVER
      this._previewElement.style.backgroundImage = `url('${posterUrl || DEFAULT_AUDIO_COVER}')`
      this._previewElement._title.innerHTML = (this._audioData.getTitle && this._audioData.getTitle()) || ""
      this._previewElement.artist.innerHTML = (this._audioData.getArtist && this._audioData.getArtist()) || ""
      this._previewElement.album.innerHTML = (this._audioData.getAlbum && this._audioData.getAlbum()) || ""
      this._previewElement.trackInfo.innerHTML = this._trackInfoElement.innerHTML || ""

      const playBtn = this._previewElement.querySelector("#preview-play-btn")
      const pauseBtn = this._previewElement.querySelector("#preview-pause-btn")
      if (playBtn && pauseBtn) {
        if (this._wavesurfer && this._wavesurfer.isPlaying()) {
          playBtn.style.display = "none"; pauseBtn.style.display = "block"
        } else {
          playBtn.style.display = "block"; pauseBtn.style.display = "none"
        }
      }
    }
    return this._previewElement
  }

  setTrackInfo(index, total) {
    if (this._trackInfoElement) this._trackInfoElement.innerHTML = `${index + 1} / ${total}`
  }

  pause() {
    if (this._wavesurfer) this._wavesurfer.pause()
    if (this._playBtn) this._playBtn.style.display = "block"
    if (this._pauseBtn) this._pauseBtn.style.display = "none"
  }

  close() {
    this.stop(false)
    this._audioData = null
    this._currentPath = ""
    if (this.parentElement) this.parentElement.removeChild(this)
    if (this.onClose) this.onClose()
  }

  stop(saveState = true) {
    if (this._wavesurfer) {
      this._wavesurfer.stop()
      this._wavesurfer.seekTo(0)
    }
    if (this._playSlider) this._playSlider.value = 0
    if (this._playBtn) this._playBtn.style.display = "block"
    if (this._pauseBtn) this._pauseBtn.style.display = "none"

    // Persist last position keyed by title id (if available)
    if (this._audioData?.getId) {
      const currentTime = (this._wavesurfer && this._wavesurfer.getCurrentTime()) || 0
      if (saveState && this._wavesurfer && this._wavesurfer.getDuration() !== currentTime) {
        const payload = {
          _id: this._audioData.getId(),
          isVideo: false,
          currentTime,
          date: new Date()
        }
        saveWatchingTitle(payload).catch(err => console.error("Failed to save audio watching state", err))
        Backend.publish("stop_video_player_evt_", payload, true)
      } else {
        Backend.publish("remove_video_player_evt_", {
          _id: this._audioData.getId(),
          isVideo: false,
          currentTime,
          date: new Date()
        }, true)
      }
      localStorage.setItem(this._audioData.getId(), String(currentTime))
    }
  }

  hidePlaylist() {
    this.playlist.style.display = "none"
    this._shuffleBtn.style.display = "none"
    this._skipNextBtn.style.display = "none"
    this._skipPreviousBtn.style.display = "none"
    this._trackInfoElement.style.display = "none"
    this._stopBtn.style.display = "none"
    this._loopBtn.style.display = "none"
    if (this._container) {
      this._container.style.width = "400px"
    }
    if (this._vizWrapper) this._vizWrapper.style.minWidth = "0px"
  }

  showPlaylist() {
    if (this.playlist.count() > 1) {
      this.playlist.style.display = ""
      this._shuffleBtn.style.display = ""
      this._skipNextBtn.style.display = ""
      this._skipPreviousBtn.style.display = ""
      this._trackInfoElement.style.display = ""
      this._stopBtn.style.display = ""
      this._loopBtn.style.display = ""
      if (this._container) {
        this._container.style.width = "640px"
      }
      if (this._vizWrapper) this._vizWrapper.style.minWidth = "600px"
    } else {
      this.hidePlaylist()
    }
  }

  // ---------- playlist & loading ----------

  async loadTracks(name = "Playlist") {
    const tracks = Array.from(this.querySelectorAll("globular-audio-track"))
    if (tracks.length === 0) return

    let m3u = "#EXTM3U\n"
    m3u += `#PLAYLIST: ${name}\n\n`

    for (const t of tracks) {
      try {
        const a = await t.getAudio()
        const url = a.getUrl()
        const id = a.getId()
        const label =
          (a.getTitle && a.getTitle()) ||
          (a.getArtist && a.getArtist()) ||
          (a.getAlbum && a.getAlbum()) ||
          ""
        m3u += `#EXTINF:${a.getDuration ? a.getDuration() || 0 : 0}, ${label}, tvg-id="${id}"\n`
        m3u += `${url}\n\n`
      } catch (e) {
        console.warn("Failed to add <globular-audio-track>:", e)
      } finally {
        t.remove()
      }
    }
    this.loadPlaylist(m3u)
  }

  loadPlaylist(m3uTextOrUrl) {
    this.playlist.clear()
    // Note: old API passed a 'globule'; deprecated now, we pass undefined
    this.playlist.load(m3uTextOrUrl, undefined, this, () => {
      if (this.playlist.count() > 1) this.showPlaylist()
      else this.hidePlaylist()
      setTimeout(fireResize, 500)
    })
  }

  // ---------- core play ----------

  /**
   * Play a single path. Builds signed URL via buildFileUrl when needed.
   */
  async play(path, audioInfo, existsLocally = false) {
    if (audioInfo) {
      this._audioData = audioInfo
    } else {
      this._audioData = null
    }

    // Avoid duplicate reloads while already playing same path
    if (this._currentPath === path && this._wavesurfer && this._wavesurfer.isPlaying()) {
      return
    }
    this._currentPath = path

    const token = getAuthToken()
    let urlToPlay = buildFileUrl(path, token)

    try {
      await assertReachable(urlToPlay)
    } catch (e) {
      displayError(`Unable to access ${urlToPlay}: ${e.message}`)
      this.close()
      return
    }

    // Header info text + cover/title
    const fileName = path.substring(path.lastIndexOf("/") + 1)
    // remove the ?query part if any
    const cleanFileName = fileName.split("?")[0]
    this._titleSpan.innerHTML = cleanFileName

    let info = this._audioData || null
    if (!info) {
      // Try resolving audio metadata from backend helpers
      try {
        const audios = (await Title?.getFileAudiosInfo?.(path)) || []
        if (Array.isArray(audios) && audios.length > 0) {
          info = audios[0]
        } else {
          const titles = (await Title?.getFileTitlesInfo?.(path)) || []
          if (Array.isArray(titles) && titles.length > 0) {
            // synthesize minimal Audio-like info
            const a = new Audio()
            if (titles[0].getId) a.setId(titles[0].getId())
            if (titles[0].getName) a.setTitle(titles[0].getName())
            info = a
          }
        }
      } catch (e) {
        console.warn("Metadata lookup failed:", e)
      }
    }

    if (info) {
      this._audioData = info

      const title = (info.getTitle && info.getTitle()) || ""
      const artist = (info.getArtist && info.getArtist()) || ""
      const album = (info.getAlbum && info.getAlbum()) || ""
      const year = (info.getYear && info.getYear()) || ""

      this._trackTitleElement.innerHTML = title || fileName
      this._albumNameElement.innerHTML = album || ""
      this._albumYearElement.innerHTML = year || ""
      const poster = info.getPoster && info.getPoster()
      const posterUrl = poster && poster.getContenturl ? poster.getContenturl() : DEFAULT_AUDIO_COVER
      this._albumCoverElement.src = posterUrl

      console.log("Playing audio:", info  )
      // continue listening position (localStorage + optional watching title)
      if (info.getId) {
        const stored = localStorage.getItem(info.getId())
        if (stored) {
          // Seek is applied after duration is known in _wavesurferReadyHandler
        }
        if (Title?.getWacthingTitle && token) {
          Title.getWacthingTitle(
            info.getId(),
            (watching) => {
              if (watching && typeof watching.currentTime === "number") {
                localStorage.setItem(info.getId(), String(watching.currentTime))
              }
            },
            () => {}
          )
        }
      }

      // Publish "play" event if single track UI
      if (this.playlist.style.display === "none") {
        Backend.publish(
          "play_video_player_evt_",
          {
            _id: info.getId && info.getId(),
            isVideo: false,
            currentTime: 0,
            date: new Date()
          },
          true
        )
      }
    }

    // finally load into wavesurfer
    this._wavesurfer.load(urlToPlay)
  }
}

customElements.define("globular-audio-player", AudioPlayer)

// ---------- Declarative track ----------

class AudioTrack extends HTMLElement {
  constructor() {
    super()
    this.attachShadow({ mode: "open" })
    this.shadowRoot.innerHTML = `<style></style><div></div>`
  }

  async getAudio() {
    const id = this.getAttribute("id")
    const src = this.getAttribute("src")
    if (!id || !src) throw new Error("AudioTrack: 'id' and 'src' are required.")

    const audio = new Audio()
    audio.setId(id)
    audio.setUrl(src)
    if (this.getAttribute("title")) audio.setTitle(this.getAttribute("title"))
    if (this.getAttribute("artist")) audio.setArtist(this.getAttribute("artist"))
    if (this.getAttribute("album")) audio.setAlbum(this.getAttribute("album"))
    if (this.getAttribute("duration")) audio.setDuration(parseFloat(this.getAttribute("duration")) || 0)

    const posterUrl = this.getAttribute("cover")
    if (posterUrl) {
      const poster = new Poster()
      poster.setContenturl(posterUrl)
      poster.setUrl(posterUrl)
      audio.setPoster(poster)
    }

    try {
      // Fetch enriched info via Title helper
      const fetched = await Title?.getAudioInfo?.(audio.getId()).catch(() => null)
      if (fetched) {
        if (!audio.getTitle?.() && fetched.getTitle?.()) audio.setTitle(fetched.getTitle())
        if (!audio.getArtist?.() && fetched.getArtist?.()) audio.setArtist(fetched.getArtist())
        if (!audio.getAlbum?.() && fetched.getAlbum?.()) audio.setAlbum(fetched.getAlbum())
        if ((!audio.getPoster() || !audio.getPoster().getContenturl?.()) && fetched.getPoster?.()) {
          audio.setPoster(fetched.getPoster())
        }
        if (!audio.getDuration?.() && fetched.getDuration?.()) audio.setDuration(fetched.getDuration())
      } else {
        console.warn(`No backend info for audio ID ${id}, using attributes only.`)
      }
      return audio
    } catch (err) {
      console.error(`AudioTrack backend info error for ${id}:`, err)
      return audio
    }
  }
}

customElements.define("globular-audio-track", AudioTrack)
