// src/components/video.js

import Plyr from 'plyr'
import './plyr.css'
import Hls from 'hls.js'

// App bus + helpers (no raw RPC calls)
import {
  Backend,
  displayError,
  getFreshToken,
  refresh,
  forceRefresh,
  isExpiringSoon,
  tokenExpMs,

  // Controllers / wrappers
  readDir,
  buildHiddenTimelineDir,

  // Data fetchers
  getFileTitlesInfo,
  getFileVideosInfo,
  getTitleFiles,
  getVideoInfo,
  getWatchingTitle,
  saveWatchingTitle,
  removeWatchingTitle,

  // Base URL helper
  getBaseUrl
} from '@globular/backend'

// Utilities
import { fireResize } from './utility'
import { PlayList } from './playlist'

// Proto types still used for declarative <globular-video-track>
import { Poster, Video } from 'globular-web-client/title/title_pb'

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------
const MP4_TOKEN_REFRESH_INTERVAL_MS = 30_000   // fallback poll when expiry unknown
const MP4_TOKEN_EXPIRY_PAD_MS = 180_000        // refresh 3 min before expiry
const PLAY_ATTEMPT_COOLDOWN_MS = 50
const HLS_MANIFEST_TIMEOUT_MS = 15_000
const HLS_SERVER_COOLDOWN_MS = 1_500           // wait after destroy before requesting a new stream

// Module-level: shared across VideoPlayer instances so close→reopen respects the cooldown
let _lastHlsDestroyAt = 0

// -----------------------------------------------------------------------------
// Polyfill: HTMLMediaElement.prototype.playing
// -----------------------------------------------------------------------------
if (!Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playing')) {
  Object.defineProperty(HTMLMediaElement.prototype, 'playing', {
    get: function () {
      return !!(this.currentTime > 0 && !this.paused && !this.ended && this.readyState > 2)
    }
  })
}

// -----------------------------------------------------------------------------
// Small helpers (token, URL building, path normalization)
// -----------------------------------------------------------------------------
function getAuthToken() {
  return sessionStorage.getItem('__globular_token__')
}

function stripQuery(p) {
  if (!p) return ''
  return String(p).split('?')[0]
}

function isHttpUrl(s) {
  return /^https?:\/\//i.test(String(s || ''))
}

function isM3u8(s) {
  return /\.m3u8($|\?)/i.test(String(s || ''))
}

function isPlaylistPath(p) {
  return /\/playlist\.m3u8($|\?)/i.test(String(p || ''))
}

function normalizePath(p) {
  return (stripQuery(p) || '').replace(/\/$/, '')
}

function getBaseName(p) {
  const n = normalizePath(p)
  return (n.split('/').pop() || '')
}

function getLowerExt(baseName) {
  if (!baseName.includes('.')) return ''
  return baseName.substring(baseName.lastIndexOf('.') + 1).toLowerCase()
}

function isDirectoryPathFromPath(p) {
  const n = normalizePath(p)
  const base = getBaseName(n)
  return n.length > 0 && !base.includes('.')
}

function isVideoLikePath(p) {
  const clean = stripQuery(p).toLowerCase()
  return (
    clean.endsWith('.mp4') ||
    clean.endsWith('.mkv') ||
    clean.endsWith('.m3u8') ||
    clean.endsWith('/playlist.m3u8')
  )
}

function callMaybe(obj, method, args = []) {
  if (!obj || typeof obj[method] !== 'function') return undefined
  try { return obj[method](...args) } catch { return undefined }
}

function propMaybe(obj, prop) {
  if (!obj) return undefined
  return obj[prop]
}

/**
 * Build a signed file URL with the current token (no globule dependency).
 * Behavior preserved from your working version.
 */
function buildFileUrl(rawPath, tokenOrOptions, application) {
  let includeToken = true
  let token = getAuthToken()

  if (typeof tokenOrOptions === 'object' && tokenOrOptions !== null && !Array.isArray(tokenOrOptions)) {
    const opts = tokenOrOptions
    if (Object.prototype.hasOwnProperty.call(opts, 'includeToken')) {
      includeToken = opts.includeToken !== false
    }
    if (typeof opts.token === 'string') token = opts.token
    if (opts.application) application = opts.application
  } else if (typeof tokenOrOptions === 'string') {
    token = tokenOrOptions
  } else if (tokenOrOptions === false) {
    includeToken = false
  } else if (tokenOrOptions !== undefined && tokenOrOptions !== null) {
    token = tokenOrOptions
  }

  let url = getBaseUrl()
  const parts = (rawPath || '').split('/').map(p => p.trim()).filter(Boolean)
  parts.forEach(p => (url += '/' + encodeURIComponent(p)))

  const qs = new URLSearchParams()
  if (includeToken && token) qs.append('token', token)
  if (application) qs.append('application', application)
  if (qs.toString()) url += '?' + qs.toString()

  return url
}

/**
 * Add/replace token as query param.
 */
function appendTokenParam(inputUrl, token) {
  if (!token || !inputUrl) return inputUrl
  try {
    const url = new URL(inputUrl, window.location.origin)
    url.searchParams.set('token', token)
    return url.toString()
  } catch {
    const glue = inputUrl.includes('?') ? '&' : '?'
    return `${inputUrl}${glue}token=${encodeURIComponent(token)}`
  }
}

/**
 * Build HLS URL (for local paths: buildFileUrl with includeToken=false)
 * and then attach token param. (Preserves behavior.)
 */
function buildHlsUrl(pathOrUrl) {
  if (!pathOrUrl) return ''
  const token = getAuthToken()
  const raw = isHttpUrl(pathOrUrl)
    ? pathOrUrl
    : buildFileUrl(pathOrUrl, { includeToken: false })
  return appendTokenParam(raw, token)
}

/**
 * Ensure a URL has token param (used by Hls loader too).
 */
function withToken(url) {
  if (!url) return url
  return appendTokenParam(url, getAuthToken())
}

/**
 * Hls loader wrapper: forces token in segment/manifest URLs.
 */
function makeTokenLoader() {
  const DefaultLoader = Hls.DefaultConfig.loader
  return class TokenLoader extends DefaultLoader {
    load(context, config, callbacks) {
      context.url = withToken(context.url)
      return super.load(context, config, callbacks)
    }
  }
}

/**
 * Compute a playlist source path when the user passes:
 * - a directory path
 * - a file path
 * - an http URL
 *
 * Preserves your behavior:
 * - If path already ends with .m3u8 => treat as HLS
 * - If directory => append /playlist.m3u8
 * - If http and not already /playlist.m3u8 => append
 */
function computePlaylistSourcePath(path) {
  const raw = String(path || '')
  const n = normalizePath(raw)

  // If already .m3u8, we don't build a secondary playlistSourcePath
  if (isM3u8(n)) return null

  if (isHttpUrl(raw)) {
    try {
      const parsed = new URL(raw)
      if (!/\/playlist\.m3u8($|\?)/i.test(parsed.pathname)) {
        let pathname = parsed.pathname.replace(/\/$/, '')
        // Strip file extension so the HLS dir matches server structure:
        // /mnt/.../video.mp4 → /mnt/.../video/playlist.m3u8
        const lastDot = pathname.lastIndexOf('.')
        const lastSlash = pathname.lastIndexOf('/')
        if (lastDot > lastSlash) pathname = pathname.substring(0, lastDot)
        parsed.pathname = pathname + '/playlist.m3u8'
      }
      return parsed.toString()
    } catch {
      return null
    }
  }

  // local path: strip file extension so the HLS dir matches server structure.
  // The server creates HLS at [stem]/playlist.m3u8, not [stem.ext]/playlist.m3u8.
  const lastDot = n.lastIndexOf('.')
  const lastSlash = n.lastIndexOf('/')
  const stem = lastDot > lastSlash ? n.substring(0, lastDot) : n
  return `${stem}/playlist.m3u8`
}

/**
 * Fetch a tiny chunk from the target URL so we can read status + auth headers.
 * We use a ranged GET instead of HEAD to avoid servers that reject HEAD requests.
 */
async function fetchHeadWithToken(url, token, forceHlsHeaders = false, isHlsSource = false) {
  const headers = {}
  if (token && (!String(url).includes('token=') || (isHlsSource || forceHlsHeaders))) {
    headers['Authorization'] = `Bearer ${token}`
    headers['token'] = token
  }

  const rangedHeaders = { ...headers, Range: 'bytes=0-0' }
  const doPlainFetch = () => fetch(url, { method: 'GET', headers })

  try {
    const res = await fetch(url, { method: 'GET', headers: rangedHeaders })
    if (res.status === 416) return doPlainFetch()
    return res
  } catch {
    return doPlainFetch()
  }
}

/** Locate subtitles next to a video file using readDir (no globule). */
async function getSubtitlesFiles(path) {
  const subsPath =
    path.substring(0, path.lastIndexOf('.')).substring(0, path.lastIndexOf('/') + 1) +
    '.hidden' + path.substring(path.lastIndexOf('/')) +
    '/__subtitles__'

  try {
    const dirVM = await readDir(subsPath)
    const files = Array.isArray(dirVM && dirVM.files) ? dirVM.files : []
    return files.map(f => ({
      getName: () => f.name || (f.path ? f.path.split('/').pop() : ''),
      getPath: () => f.path || ''
    }))
  } catch (err) {
    console.warn(`Failed to get subtitles for ${path}:`, err)
    return []
  }
}

// -----------------------------------------------------------------------------
// Playlist helper
// -----------------------------------------------------------------------------
export function playVideos(videos, name) {
  const unique = [...new Map(videos.map(v => [v.getId(), v])).values()]
  let m3u = '#EXTM3U\n'
  m3u += `#PLAYLIST: ${name}\n\n`
  const filePaths = []

  let i = 0
  const next = async () => {
    if (i >= unique.length) {
      if (filePaths.length > 0) playVideo({ playlist: m3u, filePaths }, null, null, null)
      else playVideo(m3u, null, null, null)
      return
    }

    const v = unique[i++]
    try {
      const files = await getTitleFiles(v.getId(), '/search/videos')
      if (files.length > 0) {
        let filePath = files[0]
        if (!/\.(mp4|m3u8|mkv)$/i.test(filePath)) filePath += '/playlist.m3u8'
        const hls = /\.m3u8$/i.test(filePath)
        const url = hls ? buildFileUrl(filePath, { includeToken: false }) : buildFileUrl(filePath)
        m3u += `#EXTINF:${v.getDuration()}, ${v.getTitle()}, tvg-id="${v.getId()}"\n`
        m3u += `${url}\n\n`
        filePaths.push(filePath)
      }
    } catch (e) {
      console.warn(`Failed to process video ${v.getId()}: ${e.message}`)
    }
    next()
  }

  next()
}

// -----------------------------------------------------------------------------
// Entrypoint used elsewhere
// -----------------------------------------------------------------------------
export function playVideo(path, onplay, onclose, title) {
  const playlistPayload = (path && typeof path === 'object' && path.playlist) ? path.playlist : path

  // Close menus
  document.body.querySelectorAll('globular-dropdown-menu').forEach(menu => {
    if (menu.close) menu.close()
    if (menu.classList?.contains('file-dropdown-menu') && menu.parentNode) {
      menu.parentNode.removeChild(menu)
    }
  })

  let vp = document.querySelector('globular-video-player')
  if (!vp) {
    vp = new VideoPlayer()
    document.body.appendChild(vp)
  } else {
    vp.stop()
  }

  vp.resume = false
  vp.style.zIndex = 100
  vp.onplay = onplay || vp.onplay
  vp.onclose = onclose || vp.onclose
  vp.titleInfo = title || null
  if (vp.playlist) vp.playlist.clear()

  if ((playlistPayload || '').endsWith('video.m3u') || (playlistPayload || '').startsWith('#EXTM3U')) {
    vp.loadPlaylist(playlistPayload, path?.filePaths)
  } else {
    vp.play(path, title || null)
  }

  return vp
}

// -----------------------------------------------------------------------------
// Video Player Web Component
// -----------------------------------------------------------------------------
export class VideoPlayer extends HTMLElement {
  constructor() {
    super()
    this.attachShadow({ mode: 'open' })

    // state
    this.titleInfo = null
    this.playlist = new PlayList()
    this.player = null
    this.hls = null
    this.path = ''
    this.resume = false
    this.isMinimized = false
    this.onMinimize = null
    this.onclose = null
    this.onplay = null

    this._loadingOverlay = null
    this._loadingOverlayLabel = null
    this._dialogReady = false
    this._loadingName = ''
    this._playbackCompleted = false
    this._lastProgressEvent = 0
    this._forceHlsSource = false
    this._playAttemptInFlight = false
    this._watchingRemovedAfterCompletion = false

    // refs
    this.skipPreviousBtn = null
    this.stopBtn = null
    this.skipNextBtn = null
    this.loopBtn = null
    this.shuffleBtn = null
    this.trackInfoElement = null
    this.audioTrackSelector = null
    this.playPauseBtn = null
    this.videoElement = null

    // persisted toggles
    this.loop = localStorage.getItem('video_loop') === 'true'
    this.shuffle = localStorage.getItem('video_shuffle') === 'true'
    this.resized = false
    this._cachedPlaylistWidth = 320
    this._onPlayFired = false

    // internal flags
    this._retryingPlayback = false
    this._pendingSeekTime = null
    this._closingRequested = false
    this._pendingCloseSaveState = undefined
    this._fallbackMp4Url = null  // set when we try HLS opportunistically for a raw MP4
    this._mediaSetupDone = false  // subtitle/audio-track setup runs once per video load
    this._hlsSeekTimer = null     // debounce timer for HLS seek handling

    // preview thumbnail blob URL (revoked when replaced or on disconnect)
    this._previewVttBlobUrl = null

    // mp4 token maintenance
    this._mp4TokenMaintenanceTimer = undefined
    this._mp4TokenPath = ''
    this._mp4TokenIsHttpSource = false

    const youtubeLogoUrl = new URL('../assets/icons/youtube-flat.svg', import.meta.url).href

    this.shadowRoot.innerHTML = `
      <style>
        #container{width:720px;user-select:none;background:black;}
        #content{height:100%;width:100%;display:flex;background:black;justify-content:center;overflow:hidden;background-color:var(--surface-color);color:var(--primary-text-color);position:relative;}
        @media (max-width:600px){
          .header{width:100vw;}
          #content{overflow-y:auto;width:100vw;max-width:100vw;min-width:0;background:black;flex-direction:column-reverse;height:410px;overflow:hidden;}
        }
        .header{display:flex;align-items:center;color:var(--palette-text-accent);background-color:var(--palette-primary-accent);border-top:1px solid var(--palette-action-disabled);border-left:1px solid var(--palette-action-disabled);}
        .header span{flex-grow:1;text-align:center;font-size:1.1rem;font-weight:500;display:inline-block;white-space:nowrap;overflow:hidden !important;text-overflow:ellipsis;}
        .header paper-icon-button{min-width:40px;}
        .header select{background:var(--surface-color);color:var(--palette-text-accent);border:0;outline:0;}
        select{background:var(--primary-color);color:var(--on-primary-text-color);border:0;outline:0;}
        video{display:block;width:100%;position:absolute;top:0;left:0;bottom:0;right:0;background:black;}
        @media (max-width:600px){
          #container{width:100vw;}
          #content{flex-direction:column-reverse;}
          globular-playlist{min-width:450px;}
        }
        @media (min-width:600px){ globular-playlist{min-width:450px;} }
        paper-card{background:black;}
        .plyr__controls__item.plyr__control iron-icon{fill:var(--plyr-control-icon-color,#424242);height:32px;width:32px;}
        .plyr__controls__item.plyr__control.active iron-icon{fill:var(--plyr-control-icon-active-color,white);}
        .plyr__controls{flex-wrap:wrap !important;justify-content:flex-start !important;}
        .plyr__controls__item.plyr__control.custom-control{flex:none;min-width:52px;min-height:52px;display:flex;align-items:center;justify-content:center;}
        .plyr__controls__item.plyr__control.custom-control iron-icon{--iron-icon-width:32px;--iron-icon-height:32px;height:32px;width:32px;}
      </style>

      <globular-dialog
        id="video-container"
        name="video-player"
        is-moveable="true"
        is-maximizeable="true"
        is-resizeable="true"
        show-icon="true"
        is-minimizeable="true"
      >
        <span id="title-span" slot="title">no select</span>
        <img slot="icon" src="${youtubeLogoUrl}"/>
        <select slot="header" id="audio-track-selector" style="display:none"></select>
        <paper-icon-button slot="header" id="title-info-button" icon="icons:arrow-drop-down-circle"></paper-icon-button>
        <div id="content">
          <slot name="playlist"></slot>
          <slot name="watching"></slot>
          <slot></slot>
        </div>
      </globular-dialog>

      <slot name="tracks" style="display:none;"></slot>
    `

    this.container = this.shadowRoot.querySelector('#video-container')
    this._content = this.shadowRoot.querySelector('#content')

    this.container.onminimize = () => {
      this.isMinimized = true
      if (this.onMinimize) this.onMinimize()
    }
    this.container.onclose = this.close.bind(this)
    this.container.getPreview = this.getPreview.bind(this)
    this.container.setBackGroundColor('black')
    this.container.onclick = (e) => e.stopPropagation()
    this.container.style.display = 'none'
    this.container.setAttribute('resize-direction', 'horizontal')

    this.titleSpan = this.shadowRoot.querySelector('#title-span')
    this.audioTrackSelector = this.shadowRoot.querySelector('#audio-track-selector')
    this.titleInfoButton = this.shadowRoot.querySelector('#title-info-button')
    if (this.titleInfoButton) this.titleInfoButton.addEventListener('click', this._handleTitleInfoClick)

    this.videoElement = document.createElement('video')
    this.videoElement.id = 'player'
    this.videoElement.autoplay = true
    this.videoElement.controls = true
    this.videoElement.playsInline = true
    this.appendChild(this.videoElement)

    this.container.style.height = 'auto'
    this.container.name = 'video_player'
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------
  async connectedCallback() {
    this.player = new Plyr(this.videoElement, {
      captions: { active: true, update: true },
      controls: ['play-large', 'play', 'progress', 'current-time', 'mute', 'volume', 'captions', 'settings', 'pip', 'fullscreen'],
      previewThumbnails: { enabled: false },
    })

    const pipBtn = this.querySelector("[data-plyr='pip']")
    if (pipBtn) pipBtn.style.display = 'none'

    this._addCustomPlyrControls()
    this._initPlyrEventListeners()
    this._initPlayerState()

    this.playlist.slot = 'playlist'
    this.appendChild(this.playlist)
    this.playlist.videoPlayer = this

    this._updatePlaylistVisibility()
    fireResize()

    this.container.addEventListener('dialog-resized', this._handleDialogResized)
    this.playlist.addEventListener('hide', this._handlePlaylistHide)
    this.playlist.addEventListener('show', this._handlePlaylistShow)
    window.addEventListener('orientationchange', this._handleOrientationChange)
    window.addEventListener('resize', this._handleWindowResize)

    this._loadInitialTracks()
  }

  disconnectedCallback() {
    if (this.player) this.player.destroy()
    this.player = null

    this._destroyHls()   // stamps _lastHlsDestroyAt and cleans up seek listeners

    this._revokePreviewVttBlob()
    this._stopMp4TokenMaintenance()

    this.container.removeEventListener('dialog-resized', this._handleDialogResized)
    this.playlist.removeEventListener('hide', this._handlePlaylistHide)
    this.playlist.removeEventListener('show', this._handlePlaylistShow)
    window.removeEventListener('orientationchange', this._handleOrientationChange)
    window.removeEventListener('resize', this._handleWindowResize)
    document.removeEventListener('refresh-preview', this._refreshPreviewHandler)

    this.skipPreviousBtn?.removeEventListener('click', this._skipPrevious)
    this.stopBtn?.removeEventListener('click', this._stopVideo)
    this.skipNextBtn?.removeEventListener('click', this._skipNext)
    this.loopBtn?.removeEventListener('click', this._toggleLoop)
    this.shuffleBtn?.removeEventListener('click', this._toggleShuffle)
    this.titleInfoButton?.removeEventListener('click', this._handleTitleInfoClick)
    this.videoElement?.removeEventListener('playing', this._handleVideoPlaying)
    this.videoElement?.removeEventListener('loadeddata', this._handleVideoLoadedData)
    this.videoElement?.removeEventListener('timeupdate', this._handleVideoTimeUpdate)
    this.videoElement?.removeEventListener('error', this._handleVideoElementError)
    this.audioTrackSelector?.removeEventListener('change', this._handleAudioTrackChange)

    this.shadowRoot.querySelectorAll('.plyr__controls__item.custom-control').forEach(el => el.remove())
    this.stop(false)
  }

  // ---------------------------------------------------------------------------
  // Playback helpers
  // ---------------------------------------------------------------------------
  _handleVideoPlayError = (err) => {
    if (!err) return
    this._hideLoadingOverlay()

    if (err.name === 'NotSupportedError') {
      displayError('This video format is not supported by your browser. Try a different player or convert the file.', 4000)
      return
    }

    if (err.name !== 'AbortError' && err.name !== 'NotAllowedError') {
      console.warn('Video playback failed:', err)
    }
  }

  _playVideoElement = () => {
    if (!this.videoElement) return
    if (this._playAttemptInFlight) return

    this._playAttemptInFlight = true
    Promise.resolve()
      .then(() => this.videoElement.play())
      .catch((err) => {
        if (err?.name !== 'AbortError') this._handleVideoPlayError(err)
      })
      .finally(() => {
        setTimeout(() => {
          this._playAttemptInFlight = false
        }, PLAY_ATTEMPT_COOLDOWN_MS)
      })
  }

  _resetMediaElement() {
    this.videoElement.pause()
    this.videoElement.removeAttribute('src')
    this.videoElement.load()
    this._mediaSetupDone = false
  }

  _destroyHls() {
    if (this._hlsSeekTimer) {
      clearTimeout(this._hlsSeekTimer)
      this._hlsSeekTimer = null
    }
    if (this._hlsSeekCleanup) {
      this._hlsSeekCleanup()
      this._hlsSeekCleanup = null
    }
    if (!this.hls) return
    _lastHlsDestroyAt = Date.now()   // record for server-cooldown calculation
    try { this.hls.destroy() } catch { }
    this.hls = null
  }

  // ---------------------------------------------------------------------------
  // UI handlers / dialog sizing
  // ---------------------------------------------------------------------------
  _handleDialogResized = (evt) => this.resize(evt.detail.width)

  _handlePlaylistHide = () => {
    const pv = this.querySelector('.plyr--video')
    if (pv && this.container.setWidth) this.container.setWidth(pv.offsetWidth)
  }

  _handlePlaylistShow = () => {
    const dim = localStorage.getItem('__video_player_dimension__')
    if (!dim) return
    const { width } = JSON.parse(dim)
    if (this.container.setWidth) this.container.setWidth(width)
    if (this.container.setHeight) this.container.style.height = 'auto'
  }

  _handleWindowResize = () => {
    if (this.isMinimized || !this._content) return
    if (window.innerWidth < 500) {
      this._content.style.height = 'calc(100vh - 100px)'
      this._content.style.overflowY = 'auto'
      return
    }
    this._content.style.height = ''
    this._content.style.overflowY = ''
  }

  _playlistIsVisible() {
    if (!this.playlist) return false
    const count = this.playlist.count ? this.playlist.count() : 0
    return count > 1 && this.playlist.style.display !== 'none'
  }

  _getPlaylistWidth() {
    if (!this.playlist) return this._cachedPlaylistWidth
    const measured = this.playlist.offsetWidth || this.playlist.clientWidth || 0
    if (measured > 0) this._cachedPlaylistWidth = measured
    return this._cachedPlaylistWidth
  }

  _resolveResizeWidth(w) {
    if (typeof w === 'number' && w > 0) return w
    const videoWidth = this.videoElement?.videoWidth || 720
    const playlistWidth = this._playlistIsVisible() ? this._getPlaylistWidth() : 0
    return videoWidth + playlistWidth
  }

  _handleOrientationChange = () => {
    const o = (screen.orientation || {}).type || screen.mozOrientation || screen.msOrientation
    if (['landscape-primary', 'landscape-secondary'].includes(o)) this.becomeFullscreen()
  }

  _handleVideoPlaying = () => {
    this._watchingRemovedAfterCompletion = false

    if (!this.resized) {
      const { width } = this._getFittedVideoSize()
      const playlistWidth = this._playlistIsVisible() ? this._getPlaylistWidth() : 0
      this.resize(width + playlistWidth)
    }

    if (this.onplay && !this._onPlayFired) {
      this._onPlayFired = true
      this.onplay(this.player, this.titleInfo)
    }
  }

  // ---------------------------------------------------------------------------
  // MP4 token maintenance
  // Schedules a single precise timer (not setInterval) so the src URL is updated
  // with a fresh token ~3 minutes before the current token expires. This keeps
  // a 2-hour movie playing without interruption even with a 15-minute token.
  // ---------------------------------------------------------------------------
  _startMp4TokenMaintenance(path, isHttpSource) {
    this._stopMp4TokenMaintenance()
    if (!path) return
    this._mp4TokenPath = path
    this._mp4TokenIsHttpSource = Boolean(isHttpSource)
    this._scheduleMp4TokenRefresh()
  }

  _stopMp4TokenMaintenance() {
    if (this._mp4TokenMaintenanceTimer) {
      clearTimeout(this._mp4TokenMaintenanceTimer)
      this._mp4TokenMaintenanceTimer = undefined
    }
    this._mp4TokenPath = ''
    this._mp4TokenIsHttpSource = false
  }

  _scheduleMp4TokenRefresh() {
    if (!this._mp4TokenPath) return

    const expMs = tokenExpMs()
    let delay
    if (expMs) {
      // Fire exactly PAD ms before the token expires
      delay = Math.max(5_000, expMs - Date.now() - MP4_TOKEN_EXPIRY_PAD_MS)
    } else {
      // No expiry info (non-JWT token?) — fall back to polling
      delay = MP4_TOKEN_REFRESH_INTERVAL_MS
    }

    this._mp4TokenMaintenanceTimer = window.setTimeout(
      () => void this._mp4TokenRefreshTick(),
      delay
    )
  }

  async _mp4TokenRefreshTick() {
    if (!this._mp4TokenPath || !this.videoElement) return

    // Check whether auth.ts already refreshed the token in the background.
    // If the stored token differs from the one in the current src URL, we can
    // use it directly without making a second RPC call.
    let newToken = getAuthToken()
    const srcToken = (() => {
      try { return new URL(this.videoElement.src).searchParams.get('token') } catch { return null }
    })()

    if (!newToken || newToken === srcToken) {
      // Token hasn't been refreshed yet — trigger a refresh now.
      // Uses the coalesced refresh() so we never fire two simultaneous RPC calls.
      try {
        newToken = await refresh()
      } catch (err) {
        console.warn('[video] mp4 token refresh failed:', err)
        // Retry in 30s so a transient network error doesn't leave us with an expired token
        this._mp4TokenMaintenanceTimer = window.setTimeout(
          () => void this._mp4TokenRefreshTick(),
          30_000
        )
        return
      }
    }

    // Apply the fresh token to the video src.
    if (newToken && this._mp4TokenPath) {
      const newUrl = this._buildMp4UrlWithToken(newToken)
      if (newUrl) {
        const wasPaused = this.videoElement.paused
        const preservedTime = this.videoElement.currentTime || 0

        this.videoElement.src = newUrl
        // Set currentTime immediately — the browser uses it as the range-request
        // start position so playback resumes from the same spot with minimal stall.
        if (preservedTime > 0) this.videoElement.currentTime = preservedTime
        if (!wasPaused) this.videoElement.play().catch(() => {})
      }
    }

    // Schedule the next refresh for whatever token we have now
    this._scheduleMp4TokenRefresh()
  }

  // ---------------------------------------------------------------------------
  // HLS seek debounce
  // Without this, scrubbing rapidly fires one segment-download per seek position,
  // saturating the connection and causing multi-minute stalls.
  // Strategy: stop all HLS loading as soon as seeking starts; restart from the
  // final position 150 ms after the last seek event.
  // ---------------------------------------------------------------------------
  _initHlsSeekHandling() {
    const onSeeking = () => {
      if (!this.hls) return
      if (this._hlsSeekTimer) {
        clearTimeout(this._hlsSeekTimer)
        this._hlsSeekTimer = null
      }
      this.hls.stopLoad()
    }

    const onSeeked = () => {
      if (!this.hls) return
      if (this._hlsSeekTimer) clearTimeout(this._hlsSeekTimer)
      this._hlsSeekTimer = setTimeout(() => {
        this._hlsSeekTimer = null
        if (!this.hls || !this.videoElement) return
        this.hls.startLoad(this.videoElement.currentTime)
      }, 150)
    }

    this.videoElement.addEventListener('seeking', onSeeking)
    this.videoElement.addEventListener('seeked', onSeeked)

    // Store cleanup so _destroyHls can remove the listeners
    this._hlsSeekCleanup = () => {
      this.videoElement?.removeEventListener('seeking', onSeeking)
      this.videoElement?.removeEventListener('seeked', onSeeked)
    }
  }

  _buildMp4UrlWithToken(token) {
    if (!this._mp4TokenPath) return ''
    if (this._mp4TokenIsHttpSource) {
      try {
        const u = new URL(this._mp4TokenPath)
        const params = new URLSearchParams(u.search)
        if (token) params.set('token', token)
        else params.delete('token')
        u.search = params.toString()
        return u.toString()
      } catch {
        return this._mp4TokenPath
      }
    }
    return buildFileUrl(this._mp4TokenPath, token)
  }

  // ---------------------------------------------------------------------------
  // Progress + error handlers
  // ---------------------------------------------------------------------------
  _handleVideoTimeUpdate = () => {
    if (!this.titleInfo || typeof this.titleInfo.getId !== 'function') return
    if (!this.videoElement?.playing) return

    const now = Date.now()
    if (now - this._lastProgressEvent < 1000) return
    this._lastProgressEvent = now

    Backend.publish('play_video_player_evt_', {
      _id: this.titleInfo.getId(),
      isVideo: true,
      currentTime: this.videoElement.currentTime,
      duration: this.videoElement.duration || 0,
      date: new Date()
    }, true)
  }

  _handleVideoElementError = () => {
    const mediaError = this.videoElement?.error
    if (!mediaError) return

    const networkCode = typeof MediaError !== 'undefined' ? MediaError.MEDIA_ERR_NETWORK : 2
    if (mediaError.code === networkCode) this._retryPlaybackAfterFailure()
  }

  _handleVideoLoadedData = async () => {
    if (!this.resized) {
      const { width } = this._getFittedVideoSize()
      const playlistWidth = this._playlistIsVisible() ? this._getPlaylistWidth() : 0
      this.resize(width + playlistWidth)
    }

    if (typeof this._pendingSeekTime === 'number' && !Number.isNaN(this._pendingSeekTime)) {
      try { this.videoElement.currentTime = this._pendingSeekTime } catch { }
      this._pendingSeekTime = null
    }

    this._finalizeVideoLoad()

    // Subtitle and audio-track setup runs only once per video load.
    // loadeddata fires again after every seek; running this code on each seek would
    // accumulate duplicate <track> elements and make Plyr increasingly sluggish.
    if (this._mediaSetupDone) return
    this._mediaSetupDone = true

    // subtitles
    const currentPath = stripQuery(this.path)
    if (isVideoLikePath(currentPath)) {
      const subs = await getSubtitlesFiles(currentPath)
      subs.forEach(f => {
        const track = document.createElement('track')
        track.kind = 'captions'

        const langId = (f.getName() || '').split('.').pop() || ''
        try {
          const names = new Intl.DisplayNames([langId], { type: 'language' })
          track.label = names.of(langId)
        } catch {
          track.label = langId
        }

        track.src = buildFileUrl(f.getPath())
        track.srclang = langId
        this.player.media.appendChild(track)
      })
    }

    // audio tracks
    const ats = this.videoElement.audioTracks
    if (ats && ats.length > 1) {
      this.audioTrackSelector.style.display = 'block'
      this.audioTrackSelector.innerHTML = ''
      for (let i = 0; i < ats.length; i++) {
        const t = ats[i]
        const opt = document.createElement('option')
        opt.textContent = t.label || t.language || `Track ${i + 1}`
        opt.value = String(i)
        this.audioTrackSelector.appendChild(opt)
      }

      const lang = navigator.language || navigator.userLanguage || ''
      let def = 0
      for (let i = 0; i < ats.length; i++) {
        const code = (ats[i].language || '').slice(0, 2)
        if (code && code === lang.slice(0, 2)) { ats[i].enabled = true; def = i }
        else ats[i].enabled = false
      }
      this.audioTrackSelector.value = String(def)
      this.player.rewind(0)
    } else {
      this.audioTrackSelector.style.display = 'none'
    }
  }

  _retryPlaybackAfterFailure() {
    if (this._retryingPlayback || !this.path) return

    this._retryingPlayback = true
    const resumeTime = this.videoElement?.currentTime || 0
    const titleInfo = this.titleInfo || null

    this._pendingSeekTime = resumeTime

    let timeoutId = null
    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId)
      this._retryingPlayback = false
    }

    const handleLoaded = () => {
      this.videoElement.removeEventListener('loadeddata', handleLoaded)
      cleanup()
    }

    this.videoElement.addEventListener('loadeddata', handleLoaded, { once: true })
    timeoutId = setTimeout(() => {
      this.videoElement.removeEventListener('loadeddata', handleLoaded)
      cleanup()
    }, 10_000)

    // Refresh token before retry so stale auth doesn't cause a loop
    forceRefresh().catch(() => {}).finally(() => {
      this.resume = true
      const currentItem = this.playlist?._items?.[this.playlist._index]
      if (currentItem && typeof this.playlist.setPlaying === 'function') {
        this.playlist.setPlaying(currentItem, true, true)
      } else {
        this.play(this.path, titleInfo)
      }
    })
  }

  _handleAudioTrackChange = (evt) => {
    const idx = parseInt(evt.target.value, 10)
    const ats = this.videoElement.audioTracks
    if (!this.player || !ats) return
    for (let i = 0; i < ats.length; i++) ats[i].enabled = i === idx
    this.player.forward(0)
  }

  // ---------------------------------------------------------------------------
  // Title info
  // ---------------------------------------------------------------------------
  _handleTitleInfoClick = (evt) => {
    evt.stopPropagation()

    if (!this.titleInfo) {
      const item = this._currentPlaylistItem()
      if (item?.video) this.titleInfo = item.video
      else if (item?.audio) this.titleInfo = item.audio
    }

    if (!this.titleInfo) return displayError('No title information found.')

    if (this.titleInfo.clearActorsList) this.showTitleInfo(this.titleInfo)
    else this.showVideoInfo(this.titleInfo)
  }

  _currentPlaylistItem() {
    return this.playlist?._items?.[this.playlist?._index ?? -1]
  }

  // ---------------------------------------------------------------------------
  // Preview
  // ---------------------------------------------------------------------------
  _refreshPreviewHandler = () => {
    if (this.isMinimized && this.container.setPreview) {
      this.container.setPreview(this.getPreview())
    }
  }

  _finalizeVideoLoad() {
    if (this._dialogReady) return
    this._dialogReady = true
    if (!this.isMinimized && this.container) this.container.style.display = ''
    this._hideLoadingOverlay()
  }

  _createLoadingOverlay() {
    if (this._loadingOverlay || !this._content) return
    const overlay = document.createElement('div')
    overlay.id = 'globular-video-loading-overlay'
    overlay.style.cssText =
      'position:absolute;inset:0;display:none;align-items:center;justify-content:center;flex-direction:column;gap:12px;background:rgba(0,0,0,.85);color:white;font-family:var(--font-family, "Segoe UI", Arial, sans-serif);z-index:998;text-align:center;pointer-events:auto;'

    const style = document.createElement('style')
    style.textContent = `
      @keyframes globular-video-loading-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    `

    const spinner = document.createElement('div')
    spinner.style.cssText =
      'width:48px;height:48px;border:4px solid rgba(255,255,255,0.25);border-top-color:white;border-radius:50%;animation:globular-video-loading-spin 1s linear infinite;'

    const label = document.createElement('span')

    overlay.appendChild(style)
    overlay.appendChild(spinner)
    overlay.appendChild(label)
    this._content.appendChild(overlay)

    this._loadingOverlay = overlay
    this._loadingOverlayLabel = label
  }

  _showLoadingOverlay() {
    this._createLoadingOverlay()
    if (!this._loadingOverlay) return
    this._loadingOverlay.style.display = 'flex'
    const overlayText = this._updateLoadingOverlayText() || ''
    this.container?.setBackgroundActivity(overlayText, true)
  }

  _hideLoadingOverlay() {
    if (!this._loadingOverlay) return
    this._loadingOverlay.style.display = 'none'
    this.container?.setBackgroundActivity('', false)
  }

  _updateLoadingOverlayText() {
    if (!this._loadingOverlayLabel) return ''
    const title = this._loadingName || this._deriveInfoDisplayName()
    const text = title ? `Loading ${title}…` : 'Loading video…'
    this._loadingOverlayLabel.textContent = text
    return text
  }

  _deriveInfoDisplayName() {
    if (!this.titleInfo) return ''
    const tryFields = [
      () => (typeof this.titleInfo.getName === 'function' ? this.titleInfo.getName() : ''),
      () => (typeof this.titleInfo.getTitle === 'function' ? this.titleInfo.getTitle() : ''),
      () => (typeof this.titleInfo.getDescription === 'function' ? this.titleInfo.getDescription() : ''),
      () => (typeof this.titleInfo.getId === 'function' ? this.titleInfo.getId() : '')
    ]
    for (const f of tryFields) {
      const v = f()
      if (!v) continue
      if (typeof v === 'string') return v.replace(/<\/?br\s*\/?>/gi, ' ')
    }
    return ''
  }

  _getFileNameFromPath(path) {
    if (!path) return ''
    let clean = String(path)
    if (clean.endsWith('/playlist.m3u8')) clean = clean.substring(0, clean.lastIndexOf('/playlist.m3u8'))
    const idx = clean.lastIndexOf('/')
    return idx >= 0 ? clean.substring(idx + 1) : clean
  }

  _setTitleFromInfo(info) {
    if (!info || !this.titleSpan) return

    let display =
      (info.getName && info.getName()) ||
      (info.getTitle && info.getTitle()) ||
      (info.getDescription && info.getDescription()?.replace(/<\/?br\s*\/?>/gi, ' ')) ||
      (info.getId && info.getId()) ||
      ''

    if (info.getYear && info.getYear()) display += ` (${info.getYear()})`

    const hasEpisode = info.getEpisode && Number(info.getEpisode()) > 0
    const hasSeason = info.getSeason && Number(info.getSeason()) > 0
    const isTvEpisode = (info.getType && info.getType() === 'TVEpisode') || hasEpisode

    if (isTvEpisode) {
      const season = hasSeason ? String(info.getSeason()).padStart(2, '0') : '01'
      const episode = hasEpisode ? String(info.getEpisode()).padStart(2, '0') : '01'
      display += ` S${season}E${episode}`
    }

    this.titleSpan.innerHTML = display || ''
  }

  // ---------------------------------------------------------------------------
  // Controls
  // ---------------------------------------------------------------------------
  _addCustomPlyrControls() {
    const controls = this.querySelector('.plyr__controls')
    if (!controls) return

    controls.style.flexWrap = 'wrap'
    controls.style.justifyContent = 'flex-start'

    const frag = document.createRange().createContextualFragment(`
      <div style="flex-basis:100%;height:1px;"></div>
      <iron-icon class="plyr__controls__item plyr__control custom-control" title="Shuffle Playlist" id="shuffle" icon="av:shuffle" style="--iron-icon-width:32px;--iron-icon-height:32px;height:32px;width:32px;"></iron-icon>
      <iron-icon class="plyr__controls__item plyr__control custom-control" id="skip-previous" title="Previous Track" icon="av:skip-previous" style="--iron-icon-width:32px;--iron-icon-height:32px;height:32px;width:32px;"></iron-icon>
      <iron-icon class="plyr__controls__item plyr__control custom-control" id="skip-next" title="Next Track" icon="av:skip-next" style="--iron-icon-width:32px;--iron-icon-height:32px;height:32px;width:32px;"></iron-icon>
      <iron-icon class="plyr__controls__item plyr__control custom-control" id="stop-button" title="Stop" icon="av:stop" style="--iron-icon-width:32px;--iron-icon-height:32px;height:32px;width:32px;"></iron-icon>
      <iron-icon class="plyr__controls__item plyr__control custom-control" title="Loop Playlist" id="repeat" icon="av:repeat" style="--iron-icon-width:32px;--iron-icon-height:32px;height:32px;width:32px;"></iron-icon>
      <div id="track-info" class="custom-control"></div>
    `)
    controls.appendChild(frag)

    this.skipPreviousBtn = this.querySelector('#skip-previous')
    this.stopBtn = this.querySelector('#stop-button')
    this.skipNextBtn = this.querySelector('#skip-next')
    this.loopBtn = this.querySelector('#repeat')
    this.shuffleBtn = this.querySelector('#shuffle')
    this.trackInfoElement = this.querySelector('#track-info')

    this.skipPreviousBtn.addEventListener('click', this._skipPrevious)
    this.stopBtn.addEventListener('click', this._stopVideo)
    this.skipNextBtn.addEventListener('click', this._skipNext)
    this.loopBtn.addEventListener('click', this._toggleLoop)
    this.shuffleBtn.addEventListener('click', this._toggleShuffle)

    this.playPauseBtn = controls.querySelector("[data-plyr='play']")
    this.player.on('play', this.playlist.resumePlaying.bind(this.playlist))
    this.player.on('pause', this.playlist.pausePlaying.bind(this.playlist))
  }

  _initPlyrEventListeners() {
    // Token updates are handled proactively by _scheduleMp4TokenRefresh, not on user events.
    // Triggering src changes on seeked/play would cause disruptive reloads whenever
    // auth.ts refreshes the token in the background between user interactions.
    this.player.on('exitfullscreen', () => this.container.restore && this.container.restore())

    this.container.addEventListener('dialog-maximized', () => {
      if (this.player.media.tagName.toLowerCase() === 'video') this.player.fullscreen.enter()
    })

    this.videoElement.addEventListener('loadeddata', this._handleVideoLoadedData)
    this.videoElement.addEventListener('playing', this._handleVideoPlaying)
    this.videoElement.addEventListener('timeupdate', this._handleVideoTimeUpdate)
    this.videoElement.addEventListener('error', this._handleVideoElementError)
    this.audioTrackSelector.addEventListener('change', this._handleAudioTrackChange)

    this.videoElement.onended = () => {
      this._playbackCompleted = true
      this.resume = false
      if (this.titleInfo) localStorage.removeItem(this.titleInfo.getId())

      if ((this.playlist?.count?.() ?? 0) > 1) this.playlist.playNext()
      else if (this.loop) this.play(this.path, this.titleInfo || null)
      else this.stop()
    }
  }

  _updateVideoUrlToken(currentUrl) {
    if (this.hls || this._forceHlsSource) return
    if (isM3u8(String(currentUrl || ''))) return

    const token = getAuthToken()
    if (!token || !this.videoElement) return

    const parts = String(currentUrl || '').split('?')
    const base = parts[0]
    const params = new URLSearchParams(parts[1] || '')
    if (params.get('token') === token) return

    params.set('token', token)
    const next = `${base}?${params.toString()}`
    const wasPaused = this.videoElement.paused
    this.videoElement.src = next

    if (!wasPaused) this._playVideoElement()
  }

  _initPlayerState() {
    if (this.loopBtn) this.loopBtn.style.fill = this.loop ? 'white' : '#424242'
    if (this.shuffleBtn) this.shuffleBtn.style.fill = this.shuffle ? 'white' : '#424242'
  }

  _stopVideo = () => {
    this.stop(false)
    this.playlist.stop()
    if (this.trackInfoElement) this.trackInfoElement.innerHTML = ''
  }

  _skipNext = () => {
    this.stop(false)
    this.playlist.playNext()
  }

  _skipPrevious = () => {
    this.stop(false)
    this.playlist.playPrevious()
  }

  _toggleLoop = () => {
    this.loop = !this.loop
    localStorage.setItem('video_loop', String(this.loop))
    if (this.loopBtn) this.loopBtn.style.fill = this.loop ? 'white' : '#424242'
  }

  _toggleShuffle = () => {
    this.shuffle = !this.shuffle
    localStorage.setItem('video_shuffle', String(this.shuffle))
    if (this.shuffleBtn) this.shuffleBtn.style.fill = this.shuffle ? 'white' : '#424242'
    this.playlist.orderItems()
  }

  // ---------------------------------------------------------------------------
  // Initial tracks + playlist loading
  // ---------------------------------------------------------------------------
  async _loadInitialTracks() {
    if (this.hasAttribute('src')) {
      try {
        const res = await fetch(this.getAttribute('src'))
        const data = await res.text()
        this.loadPlaylist(data)
      } catch (e) {
        console.error('Failed to load playlist from src attribute:', e)
        displayError('Failed to load playlist from provided URL.')
      }
      return
    }

    const tracks = Array.from(this.querySelectorAll('globular-video-track'))
    if (tracks.length === 0) return

    let m3u = '#EXTM3U\n#PLAYLIST: Initial Playlist\n\n'

    for (const t of tracks) {
      try {
        const video = await t.getVideo()

        // probe metadata
        await new Promise((resolve) => {
          this.videoElement.src = video.getUrl()
          this.videoElement.onloadedmetadata = () => {
            if (video.setDuration) video.setDuration(this.videoElement.duration)
            this.videoElement.onloadedmetadata = null
            resolve()
          }
          this.videoElement.onerror = () => {
            this.videoElement.onerror = null
            resolve()
          }
        })

        const dur = video.getDuration ? video.getDuration() : 0
        if (dur) {
          const label = (video.getTitle && video.getTitle()) || ''
          m3u += `#EXTINF:${dur}, ${label}, tvg-id="${video.getId()}"\n`

          const titleFile = await getTitleFiles(video.getId(), '/search/videos')
          if (Array.isArray(titleFile) && titleFile.length > 0) {
            let filePath = titleFile[0]
            if (!/\.(mp4|m3u8|mkv)$/i.test(filePath)) filePath += '/playlist.m3u8'
            const hls = /\.m3u8$/i.test(filePath)
            const url = hls ? buildFileUrl(filePath, { includeToken: false }) : buildFileUrl(filePath)
            m3u += `${url}\n\n`
          }

          m3u += `${video.getUrl()}\n\n`
        }
      } catch (err) {
        console.error(`Error processing video track ${t.id}:`, err)
      } finally {
        t.remove()
      }
    }

    this.videoElement.src = ''
    this.loadPlaylist(m3u)
  }

  loadPlaylist(path, filePaths) {
    // Reset stored path so the first playlist item never hits the same-path
    // resume check in play() — e.g. when replaying a folder the user just watched.
    this.path = ''
    this.playlist.clear()
    this.playlist.load(path, filePaths, this, () => {
      this._updatePlaylistVisibility()
      setTimeout(fireResize, 500)
    })

    this._handleWindowResize()
    setTimeout(fireResize, 500)
  }

  _updatePlaylistVisibility() {
    const many = this.playlist.count() > 1
    this.playlist.style.display = many ? 'block' : 'none'

    const set = (el, show) => { if (el) el.style.display = show ? 'block' : 'none' }
    set(this.shuffleBtn, many)
    set(this.skipNextBtn, many)
    set(this.skipPreviousBtn, many)
    set(this.stopBtn, many)
    set(this.loopBtn, many)
    set(this.trackInfoElement, many)
  }

  setTrackInfo(index, total) {
    if (this.trackInfoElement) this.trackInfoElement.innerHTML = `${index + 1} of ${total}`
  }

  // ---------------------------------------------------------------------------
  // Info dialogs
  // ---------------------------------------------------------------------------
  showVideoInfo(video) {
    const uuid = video.getId()
    let infoBox = document.getElementById('video-info-box-' + uuid)
    if (!infoBox) {
      const html = `
        <paper-card id="video-info-box-dialog-${uuid}" style="background: var(--surface-color); z-index: 1001; position: fixed; top: 75px; left: 50%; transform: translate(-50%); max-height: 80vh; overflow-y: auto;">
          <globular-informations-manager id="video-info-box-${uuid}"></globular-informations-manager>
        </paper-card>
      `
      document.body.appendChild(document.createRange().createContextualFragment(html))
      infoBox = document.getElementById('video-info-box-' + uuid)
      const parent = document.getElementById('video-info-box-dialog-' + uuid)
      if (infoBox) infoBox.onclose = () => parent && parent.remove()
    }
    if (infoBox && infoBox.setVideosInformation) infoBox.setVideosInformation([video])
  }

  showTitleInfo(title) {
    const uuid = title.getId()
    let infoBox = document.getElementById('title-info-box-' + uuid)
    if (!infoBox) {
      const html = `
        <paper-card id="title-info-box-dialog-${uuid}" style="background-color: var(--surface-color); z-index: 1001; position: fixed; top: 75px; left: 50%; transform: translate(-50%);">
          <globular-informations-manager id="title-info-box-${uuid}"></globular-informations-manager>
        </paper-card>
      `
      document.body.appendChild(document.createRange().createContextualFragment(html))
      infoBox = document.getElementById('title-info-box-' + uuid)
      const parent = document.getElementById('title-info-box-dialog-' + uuid)
      if (infoBox) infoBox.onclose = () => parent && parent.remove()
    }
    if (infoBox && infoBox.setTitlesInformation) infoBox.setTitlesInformation([title])
  }

  // ---------------------------------------------------------------------------
  // Preview (kept behavior; only minor cleanups)
  // ---------------------------------------------------------------------------
  getPreview() {
    if (this.previewElement) {
      if (this.titleInfo) {
        const posterObj = callMaybe(this.titleInfo, 'getPoster') || propMaybe(this.titleInfo, 'poster')
        const posterUrl = posterObj
          ? callMaybe(posterObj, 'getContenturl') || propMaybe(posterObj, 'contenturl') || propMaybe(posterObj, 'url')
          : ''
        if (posterUrl) this.previewElement.style.backgroundImage = `url('${posterUrl}')`

        const titleText =
          callMaybe(this.titleInfo, 'getTitle') ||
          propMaybe(this.titleInfo, 'title') ||
          propMaybe(this.titleInfo, 'name') ||
          ''

        if (this.previewElement._title && titleText) this.previewElement._title.innerHTML = titleText
      }

      const playBtn = this.previewElement.querySelector('#preview-play-btn')
      const pauseBtn = this.previewElement.querySelector('#preview-pause-btn')
      const playing = (this.player && this.player.playing) ? 'Pause' : 'Play'
      if (playBtn && pauseBtn) {
        playBtn.style.display = playing === 'Play' ? 'block' : 'none'
        pauseBtn.style.display = playing === 'Pause' ? 'block' : 'none'
      }

      return this.previewElement
    }

    const preview = document.createElement('div')
    preview.style.cssText =
      'position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;flex-direction:column;justify-content:flex-start;user-select:none;background:rgba(0,0,0,.5);'

    let posterUrl = ''
    let description = ''

    if (this.titleInfo) {
      const posterObj = callMaybe(this.titleInfo, 'getPoster') || propMaybe(this.titleInfo, 'poster')
      posterUrl = posterObj
        ? callMaybe(posterObj, 'getContenturl') || propMaybe(posterObj, 'contenturl') || propMaybe(posterObj, 'url')
        : ''
      description =
        callMaybe(this.titleInfo, 'getDescription') ||
        propMaybe(this.titleInfo, 'description') ||
        callMaybe(this.titleInfo, 'getTitle') ||
        propMaybe(this.titleInfo, 'title') ||
        propMaybe(this.titleInfo, 'name') ||
        ''
    } else {
      description = this.path.substring(this.path.lastIndexOf('/') + 1)
    }

    if (posterUrl) {
      preview.style.backgroundImage = `url('${posterUrl}')`
    } else {
      const clapperUrl = new URL('../assets/images/movie-clapperboard.svg', import.meta.url).href
      preview.style.backgroundImage = `url('${clapperUrl}')`
    }

    preview.style.backgroundSize = 'cover'
    preview.style.backgroundPosition = 'center center'
    preview.style.backgroundBlendMode = 'overlay'
    preview.style.backgroundRepeat = 'no-repeat'

    const titleSpan = document.createElement('span')
    titleSpan.style.cssText =
      'color:white;padding:2px;font-size:.8rem;font-weight:500;overflow:hidden;text-overflow:ellipsis;position:absolute;bottom:0;'
    preview._title = titleSpan
    preview.appendChild(titleSpan)

    const buttons = document.createElement('div')
    buttons.style.cssText = 'display:flex;justify-content:center;align-items:center;flex-direction:row;flex-grow:1;'

    const mkBtn = (icon, size, handler, id) => {
      const btn = document.createElement('iron-icon')
      btn.style.cssText = `fill:white;height:${size}px;width:${size}px;`
      btn.icon = icon
      btn.id = id
      btn.onclick = (evt) => {
        evt.stopPropagation()
        handler()
        document.dispatchEvent(new CustomEvent('refresh-preview', { bubbles: true, composed: true }))
      }
      return btn
    }

    const prev = mkBtn('av:skip-previous', 32, this._skipPrevious, 'preview-skip-previous-btn')
    const play = mkBtn('av:play-circle-outline', 48, () => this.player && this.player.play(), 'preview-play-btn')
    const pause = mkBtn('av:pause-circle-outline', 48, () => this.player && this.player.pause(), 'preview-pause-btn')
    const next = mkBtn('av:skip-next', 32, this._skipNext, 'preview-skip-next-btn')

    if (this.player && this.player.playing) { play.style.display = 'none'; pause.style.display = 'block' }
    else { play.style.display = 'block'; pause.style.display = 'none' }

    play.onclick = (e) => { e.stopPropagation(); this.player && this.player.play(); play.style.display = 'none'; pause.style.display = 'block' }
    pause.onclick = (e) => { e.stopPropagation(); this.player && this.player.pause(); play.style.display = 'block'; pause.style.display = 'none' }

    buttons.appendChild(prev)
    buttons.appendChild(play)
    buttons.appendChild(pause)
    buttons.appendChild(next)

    const info = document.createElement('span')
    info.style.cssText =
      'color:white;font-size:1rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:16px;'
    info.innerHTML = this.trackInfoElement ? this.trackInfoElement.innerHTML : ''

    preview.appendChild(buttons)
    preview.appendChild(info)

    this.previewElement = preview
    return preview
  }

  // ---------------------------------------------------------------------------
  // Main play entry
  // ---------------------------------------------------------------------------
  async play(path, titleInfo) {
    if (titleInfo) {
      this.titleInfo = titleInfo
      this._setTitleFromInfo(titleInfo)
    } else {
      this.titleInfo = null
    }

    await getFreshToken(60_000)

    this._forceHlsSource = false

    let urlToPlay = path
    let token = getAuthToken()

    const httpSource = isHttpUrl(urlToPlay)
    const normalized = normalizePath(path)
    const baseName = getBaseName(normalized)
    const ext = getLowerExt(baseName)
    const isDirectoryPath = isDirectoryPathFromPath(path)

    let isHlsSource = isM3u8(urlToPlay)

    const playlistSourcePath = computePlaylistSourcePath(path) // null if already .m3u8
    const getPlaylistUrl = () => playlistSourcePath ? buildHlsUrl(playlistSourcePath) : null

    // If directory: attempt to play playlist URL
    let playlistUrl = getPlaylistUrl()
    if (isDirectoryPath && playlistUrl) {
      urlToPlay = playlistUrl
      isHlsSource = true
    }

    // Token maintenance only for non-HLS (preserve behavior)
    if (!isHlsSource) this._startMp4TokenMaintenance(path, httpSource)
    else this._stopMp4TokenMaintenance()

    // Final URL selection (preserves your decisions)
    if (!httpSource) {
      playlistUrl = getPlaylistUrl()
      urlToPlay = isHlsSource
        ? (playlistUrl || buildHlsUrl(path))
        : buildFileUrl(path, token)
    } else if (isHlsSource) {
      playlistUrl = getPlaylistUrl()
      urlToPlay = playlistUrl || buildHlsUrl(path)
    } else {
      // http mp4/mkv: ensure token param is current
      try {
        const u = new URL(urlToPlay)
        const p = new URLSearchParams(u.search)
        if (token && p.get('token') !== token) {
          p.set('token', token)
          u.search = p.toString()
          urlToPlay = u.toString()
        }
      } catch {
        // ignore
      }
    }

    // For non-HLS file sources (raw .mp4 / .mkv), try the HLS playlist first.
    // HLS segments start playing in ~2s regardless of moov-atom position.
    // If the playlist doesn't exist the HLS error handler falls back to the raw MP4.
    this._fallbackMp4Url = null
    if (!isHlsSource && !isDirectoryPath) {
      const tryPlaylistUrl = getPlaylistUrl()
      if (tryPlaylistUrl) {
        this._fallbackMp4Url = urlToPlay   // remembered for silent fallback
        this._forceHlsSource = true
        urlToPlay = tryPlaylistUrl
        isHlsSource = true
        this._stopMp4TokenMaintenance()    // HLS injects token per-segment; no maintenance needed
      }
    }

    // Same-path resume behavior preserved
    if (this.path === path) {
      this.resume = true
      this._playVideoElement()
      return
    }

    this.path = path
    this.resume = false
    this._dialogReady = false
    this._loadingName = this._getFileNameFromPath(path)
    this._showLoadingOverlay()
    this._onPlayFired = false

    this.playContent(path, token, urlToPlay)
  }

  // ---------------------------------------------------------------------------
  // Preview thumbnails (signed VTT blob)
  // ---------------------------------------------------------------------------
  _revokePreviewVttBlob() {
    if (this._previewVttBlobUrl) {
      try { URL.revokeObjectURL(this._previewVttBlobUrl) } catch { }
      this._previewVttBlobUrl = null
    }
  }

  async _loadSignedPreviewThumbnails(normalizedPath, token) {
    // For HLS playlists the path ends with /playlist.m3u8; strip it so
    // buildHiddenTimelineDir uses the parent directory name (e.g. "movie")
    // which matches the timeline created for the original source file.
    let timelinePath = normalizedPath
    if (timelinePath.endsWith('/playlist.m3u8')) {
      timelinePath = timelinePath.slice(0, -'/playlist.m3u8'.length)
    }
    const timelineDir = buildHiddenTimelineDir(timelinePath)
    const vttUrl = appendTokenParam(buildFileUrl(`${timelineDir}/thumbnails.vtt`, token), token)
    if (!vttUrl || !this.player) return

    this._revokePreviewVttBlob()

    try {
      const resp = await fetch(vttUrl)
      if (!resp.ok) {
        console.warn(`[video] Preview VTT not available (${resp.status})`)
        // Disable thumbnails so the previous video's timeline doesn't persist.
        this.player?.setPreviewThumbnails({ enabled: false })
        return
      }
      const vttText = await resp.text()
      if (!vttText || !vttText.trimStart().startsWith('WEBVTT')) {
        this.player?.setPreviewThumbnails({ enabled: false })
        return
      }

      // Base URL of the VTT directory (no query string) for resolving relative paths
      const vttDir = vttUrl.substring(0, vttUrl.lastIndexOf('/') + 1).split('?')[0]
      const serverOrigin = vttDir.replace(/^(https?:\/\/[^/]+).*/, '$1')
      const currentToken = getAuthToken() || token
      // serverOrigin is already the correct host — it comes from vttUrl which
      // is built via buildFileUrl() → getBaseUrl() (the address from the login
      // box).  Use it to rewrite any origin the backend may have baked into the
      // absolute thumbnail URLs (e.g. globular.internal → www.globular.cloud).

      const signedVttText = vttText.split('\n').map(line => {
        const trimmed = line.trim()
        // Skip blank lines, WEBVTT header, NOTE blocks, cue timings, and numeric cue IDs
        if (!trimmed ||
          trimmed.startsWith('WEBVTT') ||
          trimmed.startsWith('NOTE') ||
          trimmed.includes('-->') ||
          /^\d+$/.test(trimmed)) {
          return line
        }

        // Only process lines that look like image cue payloads
        const pathPart = trimmed.split('#')[0]
        const isImageCue = /\.(jpe?g|png|webp)/i.test(pathPart) || trimmed.includes('#xywh=')
        if (!isImageCue) return line

        const fragIdx = trimmed.indexOf('#')
        const imgPath = fragIdx >= 0 ? trimmed.substring(0, fragIdx) : trimmed
        const fragment = fragIdx >= 0 ? trimmed.substring(fragIdx) : ''

        let fullUrl
        if (imgPath.startsWith('http://') || imgPath.startsWith('https://')) {
          // Normalize origin: replace whatever the backend baked in with the
          // same origin as the VTT file itself (serverOrigin).
          try {
            const parsed = new URL(imgPath)
            fullUrl = serverOrigin + parsed.pathname + parsed.search + parsed.hash
          } catch {
            fullUrl = imgPath
          }
        } else if (imgPath.startsWith('/')) {
          fullUrl = serverOrigin + imgPath
        } else {
          fullUrl = vttDir + imgPath
        }

        if (currentToken) {
          const sep = fullUrl.includes('?') ? '&' : '?'
          fullUrl += `${sep}token=${encodeURIComponent(currentToken)}`
        }

        return fullUrl + fragment
      }).join('\n')

      const blob = new Blob([signedVttText], { type: 'text/vtt' })
      this._previewVttBlobUrl = URL.createObjectURL(blob)

      // Use Plyr's own API: destroys any existing instance and creates a fresh
      // one with the new src, so there's no stale thumbnail cache.
      this.player?.setPreviewThumbnails({ enabled: true, src: this._previewVttBlobUrl })
    } catch (err) {
      console.warn('[video] Failed to load preview thumbnails:', err)
    }
  }

  // ---------------------------------------------------------------------------
  // playContent: set source immediately, fetch metadata concurrently
  // ---------------------------------------------------------------------------
  playContent(path, token, urlToPlay) {
    this.resized = false
    this.style.zIndex = 100

    // Reset decode state and set source IMMEDIATELY (no blocking fetches before this)
    this._resetMediaElement()
    this._destroyHls()

    const src = urlToPlay
    const shouldUseHls = this._forceHlsSource || isM3u8(src)

    if (!shouldUseHls) {
      this.videoElement.src = src
      this._playVideoElement()
    }

    // Show title from whatever we already know; update when metadata arrives
    if (this.titleInfo) {
      this._setTitleFromInfo(this.titleInfo)
      this._updateLoadingOverlayText()
      this._restorePlaybackPosition(token)
    } else {
      this.titleSpan.innerHTML = this._getFileNameFromPath(path)
      this._updateLoadingOverlayText()
      // Fetch metadata in background — doesn't delay video start
      this._loadTitleInfoAndRestorePosition(path, token)
    }

    // Timeline thumbnails (non-blocking)
    const normalized = normalizePath(path)
    if (isVideoLikePath(normalized)) {
      this._loadSignedPreviewThumbnails(normalized, token)
    }

    if (shouldUseHls) {
      const hlsSrc = withToken(buildHlsUrl(src))

      if (!Hls.isSupported()) {
        displayError('HLS is not supported in this browser for .m3u8 files.')
        this.videoElement.src = hlsSrc
        this._playVideoElement()
        return
      }

      this.hls = new Hls({
        loader: makeTokenLoader(),
        xhrSetup: (xhr) => {
          const authToken = token || getAuthToken()
          if (authToken) {
            xhr.setRequestHeader('Authorization', `Bearer ${authToken}`)
            xhr.setRequestHeader('token', authToken)
          }
        }
      })

      let manifestTimer = window.setTimeout(() => {
        displayError('HLS manifest load timed out. Check network/auth/CORS.', 6000)
        this._hideLoadingOverlay()
      }, HLS_MANIFEST_TIMEOUT_MS)

      const clearManifestTimer = () => {
        if (manifestTimer) {
          clearTimeout(manifestTimer)
          manifestTimer = null
        }
      }

      this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        clearManifestTimer()
        this._playVideoElement()
      })

      this.hls.on(Hls.Events.ERROR, (_event, data) => {
        const status = data?.response?.code ?? data?.response?.status ?? null
        if (status === 401 || status === 403) {
          clearManifestTimer()
          this._retryPlaybackAfterFailure()
          return
        }

        if (data?.fatal) {
          clearManifestTimer()

          // Opportunistic HLS fallback: the playlist didn't exist (404) or failed
          // to load — silently drop back to the raw MP4 without showing an error.
          if (this._fallbackMp4Url) {
            const fallback = this._fallbackMp4Url
            this._fallbackMp4Url = null
            this._forceHlsSource = false
            try { this.hls?.destroy() } catch {}
            this.hls = null
            // Re-enable token maintenance for the raw MP4
            this._startMp4TokenMaintenance(this.path, isHttpUrl(this.path))
            this.videoElement.src = fallback
            this._playVideoElement()
            return
          }

          const reason = data?.details || data?.type || 'unknown'
          displayError(`HLS fatal error: ${reason}`, 6000)
          this._hideLoadingOverlay()
          try { this.hls?.destroy() } catch { }
          this.hls = null
          return
        }

      })

      // Delay loadSource if HLS was just destroyed — gives the server time to
      // release NFS file handles and stop the previous ffmpeg process before
      // we request a new stream. Without this, rapid close→reopen causes the
      // server to queue the new request behind cleanup of the old one (1+ min stall).
      const serverWait = Math.max(0, HLS_SERVER_COOLDOWN_MS - (Date.now() - _lastHlsDestroyAt))
      const startHls = () => {
        if (!this.hls) return   // player was closed during the wait
        this.hls.loadSource(hlsSrc)
        this.hls.attachMedia(this.videoElement)
        this._initHlsSeekHandling()
      }
      if (serverWait > 0) setTimeout(startHls, serverWait)
      else startHls()
    }
  }

  // ---------------------------------------------------------------------------
  // Metadata helpers (run concurrently with video loading)
  // ---------------------------------------------------------------------------
  async _loadTitleInfoAndRestorePosition(path, token) {
    let info = null
    try {
      const vids = await getFileVideosInfo(path).catch(() => [])
      if (Array.isArray(vids) && vids.length > 0) {
        info = vids[0]
        info.isVideo = true
      } else {
        const titles = await getFileTitlesInfo(path).catch(() => [])
        if (Array.isArray(titles) && titles.length > 0) {
          info = titles[0]
          info.isVideo = false
        }
      }
    } catch (err) {
      console.error('Error fetching title/video info:', err)
    }
    if (info) {
      this.titleInfo = info
      this._setTitleFromInfo(info)
      this._updateLoadingOverlayText()
    }
    this._restorePlaybackPosition(token)
  }

  _restorePlaybackPosition(token) {
    if (!this.titleInfo?.getId) return
    const id = this.titleInfo.getId()

    const stored = localStorage.getItem(id)
    if (stored) {
      const t = parseFloat(stored)
      if (!isNaN(t) && t > 0) this._applyOrPendSeek(t)
    }

    if (token) {
      getWatchingTitle(id, (watching) => {
        if (watching && typeof watching.currentTime === 'number' && watching.currentTime > 0) {
          this._applyOrPendSeek(watching.currentTime)
        }
      }, () => {})
    }

    if (this.playlist.style.display === 'none') {
      Backend.publish('play_video_player_evt_', {
        _id: id,
        isVideo: true,
        currentTime: this.videoElement.currentTime,
        date: new Date()
      }, true)
    }
  }

  _applyOrPendSeek(t) {
    if (this.videoElement.readyState >= 2) {
      try { this.videoElement.currentTime = t } catch {}
    } else {
      this._pendingSeekTime = t
    }
  }

  // ---------------------------------------------------------------------------
  // Window / fullscreen
  // ---------------------------------------------------------------------------
  becomeFullscreen() {
    const v = this.videoElement
    if (v.requestFullscreen) v.requestFullscreen()
    else if (v.mozRequestFullScreen) v.mozRequestFullScreen()
    else if (v.webkitRequestFullscreen) v.webkitRequestFullscreen()
    else if (v.msRequestFullscreen) v.msRequestFullscreen()
  }

  // ---------------------------------------------------------------------------
  // Close / stop (watching persistence preserved)
  // ---------------------------------------------------------------------------
  close(saveState = true) {
    const containerStillMounted = !!(this.container && this.container.parentNode)

    if (!this._closingRequested && containerStillMounted) {
      this._closingRequested = true
      this._pendingCloseSaveState = saveState
      this.container.close()
      return
    }

    if (this._closingRequested && containerStillMounted) return

    const finalSaveState = (this._pendingCloseSaveState !== undefined)
      ? this._pendingCloseSaveState
      : saveState

    this._closingRequested = false
    this._pendingCloseSaveState = undefined

    if (!this.isMinimized) {
      const pv = this.querySelector('.plyr--video')
      const width = pv ? pv.offsetWidth + 355 : 720
      const height = this.container.getHeight ? this.container.getHeight() : undefined
      localStorage.setItem('__video_player_dimension__', JSON.stringify({ width, height }))
    }

    this.stop(finalSaveState)

    if (this.parentElement) this.parentElement.removeChild(this)
    if (this.onclose) this.onclose()
  }

  stop(save = true) {
    this.videoElement.pause()
    this.resized = false
    this._dialogReady = false
    this._hideLoadingOverlay()

    const duration = Number(this.videoElement.duration || 0)
    const currentTime = Number(this.videoElement.currentTime || 0)

    const nearEnd = duration > 0 && currentTime >= duration - Math.max(5, duration * 0.02)
    const completed = this._playbackCompleted || nearEnd
    this._playbackCompleted = false

    if (this.titleInfo && this.titleInfo.getId) {
      const payload = {
        _id: this.titleInfo.getId(),
        isVideo: true,
        currentTime,
        duration,
        duration_ms: Number.isFinite(duration) ? Math.round(duration * 1000) : undefined,
        date: new Date()
      }

      if (completed) {
        payload.completed = true
        Backend.publish('remove_video_player_evt_', payload, true)
        removeWatchingTitle(this.titleInfo.getId()).catch(err => console.error('Failed to remove watching entry', err))
        localStorage.removeItem(this.titleInfo.getId())
        this._watchingRemovedAfterCompletion = true
        return
      }

      if (this._watchingRemovedAfterCompletion) {
        this._watchingRemovedAfterCompletion = false
        return
      }

      if (save && currentTime > 0) {
        saveWatchingTitle(payload).catch(err => console.error('Failed to save watching state', err))
        Backend.publish('stop_video_player_evt_', payload, true)
        localStorage.setItem(this.titleInfo.getId(), String(currentTime))
      } else if (currentTime > 0) {
        localStorage.setItem(this.titleInfo.getId(), String(currentTime))
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Sizing logic (kept as-is; only minimal reformat)
  // ---------------------------------------------------------------------------
  _getFittedVideoSize() {
    const nativeW = this.videoElement.videoWidth || 720
    const nativeH = this.videoElement.videoHeight || Math.round(nativeW * 9 / 16)

    const viewportW = window.innerWidth || document.documentElement.clientWidth || screen.width || nativeW
    const viewportH = window.innerHeight || document.documentElement.clientHeight || screen.height || nativeH

    const playlistWidth = this._playlistIsVisible() ? this._getPlaylistWidth() : 0

    const maxContainerW = viewportW * 0.9
    const maxVideoW = Math.max(240, maxContainerW - playlistWidth)
    const maxVideoH = viewportH * 0.85

    let scale = 1
    if (nativeW > maxVideoW || nativeH > maxVideoH) {
      const scaleW = maxVideoW / nativeW
      const scaleH = maxVideoH / nativeH
      scale = Math.min(scaleW, scaleH)
    }

    return {
      width: Math.round(nativeW * scale),
      height: Math.round(nativeH * scale)
    }
  }

  resize(w) {
    if (this.isMinimized) return

    const videoW = this.videoElement?.videoWidth
    const videoH = this.videoElement?.videoHeight
    if (!videoW || !videoH) return

    const calculatedWidth = this._resolveResizeWidth(w)
    if (!calculatedWidth || isNaN(calculatedWidth) || calculatedWidth <= 0) return

    this.resized = true

    let playlistWidth = 0
    try {
      if (this._playlistIsVisible()) {
        playlistWidth = this._getPlaylistWidth() || this.playlist?.offsetWidth || 0
      }
    } catch { }
    playlistWidth = Math.max(0, playlistWidth)

    const viewportMaxContainerWidth = window.innerWidth * 0.95
    let desiredContainerWidth = calculatedWidth

    const minVideoWidth = 200
    const minContainerWidth = playlistWidth + minVideoWidth
    if (desiredContainerWidth < minContainerWidth) desiredContainerWidth = minContainerWidth

    desiredContainerWidth = Math.min(desiredContainerWidth, viewportMaxContainerWidth)

    let desiredVideoWidth = desiredContainerWidth - playlistWidth
    if (desiredVideoWidth <= 0) return

    const maxVideoWidthByViewport = viewportMaxContainerWidth - playlistWidth
    const maxVideoWidthAllowed = Math.min(videoW, maxVideoWidthByViewport)
    if (maxVideoWidthAllowed <= 0) return

    let videoWidthToApply = Math.min(desiredVideoWidth, maxVideoWidthAllowed)
    let containerWidthToApply = videoWidthToApply + playlistWidth

    if (this.container && typeof this.container.setWidth === 'function') this.container.setWidth(containerWidthToApply)
    else this.style.width = containerWidthToApply + 'px'

    const ratio = videoH / videoW
    const HEADER_OFFSET = 48

    let videoHeight = Math.round(videoWidthToApply * ratio)

    const viewportMaxHeight = window.innerHeight * 0.95
    const maxAllowedHeight = Math.max(viewportMaxHeight - HEADER_OFFSET, 200)

    if (videoHeight > maxAllowedHeight) {
      videoHeight = maxAllowedHeight
      videoWidthToApply = Math.round(videoHeight / ratio)

      containerWidthToApply = videoWidthToApply + playlistWidth

      const maxVideoWidthAgain = Math.min(videoW, viewportMaxContainerWidth - playlistWidth)
      if (videoWidthToApply > maxVideoWidthAgain) {
        videoWidthToApply = maxVideoWidthAgain
        containerWidthToApply = videoWidthToApply + playlistWidth
        videoHeight = Math.round(videoWidthToApply * ratio)
      }

      if (this.container && typeof this.container.setWidth === 'function') this.container.setWidth(containerWidthToApply)
      else this.style.width = containerWidthToApply + 'px'
    }

    const heightToApply = videoHeight + HEADER_OFFSET
    if (this.container && typeof this.container.setHeight === 'function') this.container.setHeight(heightToApply)
    else this.style.height = heightToApply + 'px'
  }
}

customElements.define('globular-video-player', VideoPlayer)

// -----------------------------------------------------------------------------
// Declarative track element
// -----------------------------------------------------------------------------
export class VideoTrack extends HTMLElement {
  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
    this.shadowRoot.innerHTML = ''
  }

  async getVideo() {
    if (!this.hasAttribute('src') || !this.hasAttribute('id')) {
      throw new Error("VideoTrack: 'src' and 'id' attributes are required.")
    }

    const v = new Video()
    v.setUrl(this.getAttribute('src'))
    v.setId(this.getAttribute('id'))

    if (this.hasAttribute('title')) v.setTitle(this.getAttribute('title'))
    if (this.hasAttribute('description')) v.setDescription(this.getAttribute('description'))
    if (this.hasAttribute('genres')) v.setGenresList(this.getAttribute('genres').split(','))
    if (this.hasAttribute('poster')) {
      const p = new Poster()
      p.setUrl(this.getAttribute('poster'))
      p.setContenturl(this.getAttribute('poster'))
      v.setPoster(p)
    }

    try {
      const fetched = await new Promise((resolve, reject) => {
        getVideoInfo(v.getId(), (full) => {
          full.setUrl(v.getUrl())
          resolve(full)
        }, reject)
      })
      return fetched
    } catch (err) {
      console.warn(`Failed to fetch full video info for ${v.getId()}: ${err.message}. Returning attributes-only video.`)
      return v
    }
  }
}

customElements.define('globular-video-track', VideoTrack)
