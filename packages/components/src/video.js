// src/components/video.js

import Plyr from 'plyr'
import "./plyr.css"
import Hls from 'hls.js'

// App bus + helpers (no raw RPC calls)
import { Backend, displayError, getFreshToken, forceRefresh } from '@globular/backend'

// Controllers / unified wrappers
import { readDir, buildHiddenTimelineDir } from '@globular/backend'

// Utilities
import { fireResize } from './utility'
import { PlayList } from './playlist'

// Proto types still used for declarative <globular-video-track>
import { Poster, Video } from 'globular-web-client/title/title_pb'
import {
  getFileTitlesInfo,
  getFileVideosInfo,
  getTitleFiles,
  getVideoInfo,
  getWatchingTitle,
  saveWatchingTitle,
  removeWatchingTitle
} from '@globular/backend'
import { getBaseUrl } from '@globular/backend'

// --------- small helpers ---------
function getAuthToken() {
  // Central point if you later move token handling to session helpers
  return sessionStorage.getItem('__globular_token__')
}

// Polyfill for HTMLMediaElement.prototype.playing
if (!Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playing')) {
  Object.defineProperty(HTMLMediaElement.prototype, 'playing', {
    get: function () {
      return !!(this.currentTime > 0 && !this.paused && !this.ended && this.readyState > 2)
    }
  })
}

/** Build a signed file URL with the current token (no globule dependency). */
function buildFileUrl(rawPath, tokenOrOptions, application) {
  let includeToken = true
  let token = getAuthToken()

  if (
    typeof tokenOrOptions === 'object' &&
    tokenOrOptions !== null &&
    !Array.isArray(tokenOrOptions)
  ) {
    const opts = tokenOrOptions
    if (Object.prototype.hasOwnProperty.call(opts, 'includeToken')) {
      includeToken = opts.includeToken !== false
    }
    if (typeof opts.token === 'string') {
      token = opts.token
    }
    if (opts.application) {
      application = opts.application
    }
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

function callMaybe(obj, method, args = []) {
  if (!obj || typeof obj[method] !== 'function') return undefined
  try { return obj[method](...args) } catch { return undefined }
}

function propMaybe(obj, prop) {
  if (!obj) return undefined
  return obj[prop]
}

// --------- playlist helper ---------

export function playVideos(videos, name) {
  const unique = [...new Map(videos.map(v => [v.getId(), v])).values()]
  let m3u = '#EXTM3U\n'
  m3u += `#PLAYLIST: ${name}\n\n`
  const filePaths = []

  let i = 0
  const next = async () => {
    if (i >= unique.length) {
      if (filePaths.length > 0) {
        playVideo({ playlist: m3u, filePaths }, null, null, null)
      } else {
        playVideo(m3u, null, null, null)
      }
      return
    }

    const v = unique[i++]
    const indexPath = '/search/videos'
    try {
      const files = await getTitleFiles(v.getId(), indexPath)
      if (files.length > 0) {
        let filePath = files[0]
        if (!/\.(mp4|m3u8|mkv)$/i.test(filePath)) filePath += '/playlist.m3u8'
        const isHls = /\.m3u8$/i.test(filePath)
        const url = isHls ? buildFileUrl(filePath, { includeToken: false }) : buildFileUrl(filePath)
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

// --------- entrypoint used elsewhere ---------

// (removed globule param; extra args from older callers are harmless in JS)
export function playVideo(path, onplay, onclose, title) {
  let playlistPayload = path
  let playlistText = path
  if (path && typeof path === 'object' && path.playlist) {
    playlistPayload = path.playlist
  }
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

// --------- Video Player Web Component ---------

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

    this.loop = localStorage.getItem('video_loop') === 'true'
    this.shuffle = localStorage.getItem('video_shuffle') === 'true'
    this.resized = false
    this._cachedPlaylistWidth = 320
    this._onPlayFired = false

    const youtubeLogoUrl = new URL('../assets/icons/youtube-flat.svg', import.meta.url).href;

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
      <globular-dialog id="video-container" name="video-player" is-moveable="true" is-maximizeable="true" is-resizeable="true" show-icon="true" is-minimizeable="true">
        <span id="title-span" slot="title">no select</span>
        <img slot="icon" src="${youtubeLogoUrl}"/>
        <select slot="header" id="audio-track-selector" style="display:none"></select>
        <paper-icon-button slot="header" id="title-info-button" icon="icons:arrow-drop-down-circle"></paper-icon-button>
        <div id="content"><slot name="playlist"></slot><slot name="watching"></slot><slot></slot></div>
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
    this._retryingPlayback = false
    this._pendingSeekTime = null
  }

  _handleVideoPlayError = (err) => {
    if (!err) return
    this._hideLoadingOverlay()
    if (err.name === 'NotSupportedError') {
      displayError(
        "This video format is not supported by your browser. Try a different player or convert the file.",
        4000
      )
      return
    }
    if (err.name !== 'AbortError' && err.name !== 'NotAllowedError') {
      console.warn('Video playback failed:', err)
    }
  }

  _playVideoElement = () => {
    if (!this.videoElement) return
    const promise = this.videoElement.play()
    if (promise && typeof promise.catch === 'function') {
      promise.catch(this._handleVideoPlayError)
    }
  }

  async connectedCallback() {
    this.player = new Plyr(this.videoElement, {
      captions: { active: true, update: true },
      controls: ['play-large', 'play', 'progress', 'current-time', 'mute', 'volume', 'captions', 'settings', 'pip', 'fullscreen']
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
    if (this.hls) this.hls.destroy()
    this.hls = null

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
    this.videoElement?.removeEventListener('error', this._handleVideoElementError)
    this.audioTrackSelector?.removeEventListener('change', this._handleAudioTrackChange)

    this.shadowRoot.querySelectorAll('.plyr__controls__item.custom-control').forEach(el => el.remove())
    this.stop(false)
  }

  // ---- handlers ----
  _handleDialogResized = (evt) => this.resize(evt.detail.width)

  _handlePlaylistHide = () => {
    const pv = this.querySelector('.plyr--video')
    if (pv && this.container.setWidth) this.container.setWidth(pv.offsetWidth)
  }

  _handlePlaylistShow = () => {
    const dim = localStorage.getItem('__video_player_dimension__')
    if (dim) {
      const { width, height } = JSON.parse(dim)
      if (this.container.setWidth) this.container.setWidth(width)
      if (this.container.setHeight) this.container.style.height = "auto"
    }
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
    if (!this.playlist) return false;
    const count = this.playlist.count ? this.playlist.count() : 0;
    return count > 1 && this.playlist.style.display !== 'none';
  }

  _getPlaylistWidth() {
    if (!this.playlist) return this._cachedPlaylistWidth;
    const measured = this.playlist.offsetWidth || this.playlist.clientWidth || 0;
    if (measured > 0) {
      this._cachedPlaylistWidth = measured;
    }
    return this._cachedPlaylistWidth;
  }

  _resolveResizeWidth(w) {
    if (typeof w === 'number' && w > 0) {
      return w;
    }
    const videoWidth = this.videoElement?.videoWidth || 720;
    const playlistWidth = this._playlistIsVisible() ? this._getPlaylistWidth() : 0;
    return videoWidth + playlistWidth;
  }
  _handleOrientationChange = () => {
    const o = (screen.orientation || {}).type || screen.mozOrientation || screen.msOrientation
    if (['landscape-primary', 'landscape-secondary'].includes(o)) this.becomeFullscreen()
  }

  _handleVideoPlaying = () => {
    this._watchingRemovedAfterCompletion = false
    // Only auto-resize once per load; after that user can resize manually
    if (!this.resized) {
    const { width } = this._getFittedVideoSize()
    const playlistWidth = this._playlistIsVisible() ? this._getPlaylistWidth() : 0
    this.resize(width + playlistWidth) // height will be computed in resize()
    }

    if (this.onplay && !this._onPlayFired) {
      this._onPlayFired = true
      this.onplay(this.player, this.titleInfo)
    }
    
  }

  _handleVideoElementError = () => {
    const mediaError = this.videoElement?.error
    if (!mediaError) return
    const networkCode = typeof MediaError !== 'undefined' ? MediaError.MEDIA_ERR_NETWORK : 2
    if (mediaError.code === networkCode) {
      this._retryPlaybackAfterFailure()
    }
  }

  _handleVideoLoadedData = async () => {
    // On first load, size the dialog to fit within viewport (both W & H)
    if (!this.resized) {
      const { width } = this._getFittedVideoSize()
      const playlistWidth = this._playlistIsVisible() ? this._getPlaylistWidth() : 0
      this.resize(width + playlistWidth)
    }
    if (typeof this._pendingSeekTime === 'number' && !Number.isNaN(this._pendingSeekTime)) {
      try {
        this.videoElement.currentTime = this._pendingSeekTime
      } catch (err) {
        console.warn('Failed to restore playback position after reload:', err)
      }
      this._pendingSeekTime = null
    }
    this._finalizeVideoLoad()

    const subs = await getSubtitlesFiles(this.path)

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
    let timeoutId = null
    this._pendingSeekTime = resumeTime
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
    }, 10000)
    this.resume = true
    const restart = () => {
      const currentItem = this.playlist?._items?.[this.playlist._index]
      if (currentItem && typeof this.playlist.setPlaying === 'function') {
        this.playlist.setPlaying(currentItem, true, true)
      } else {
        this.play(this.path, titleInfo)
      }
    }
    restart()
  }

  _handleAudioTrackChange = (evt) => {
    const idx = parseInt(evt.target.value, 10)
    const ats = this.videoElement.audioTracks
    if (this.player && ats) {
      for (let i = 0; i < ats.length; i++) ats[i].enabled = i === idx
      this.player.forward(0)
    }
  }

  _handleTitleInfoClick = (evt) => {
    evt.stopPropagation()
    if (!this.titleInfo) {
      const playlistItem = this._currentPlaylistItem()
      if (playlistItem?.video) {
        this.titleInfo = playlistItem.video
      } else if (playlistItem?.audio) {
        this.titleInfo = playlistItem.audio
      }
    }
    if (!this.titleInfo) return displayError('No title information found.')
    if (this.titleInfo.clearActorsList) this.showTitleInfo(this.titleInfo)
    else this.showVideoInfo(this.titleInfo)
  }

  _currentPlaylistItem() {
    return this.playlist?._items?.[this.playlist?._index ?? -1]
  }

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
    this._updateLoadingOverlayText()
  }

  _hideLoadingOverlay() {
    if (!this._loadingOverlay) return
    this._loadingOverlay.style.display = 'none'
  }

  _updateLoadingOverlayText() {
    if (!this._loadingOverlayLabel) return
    const title = this._loadingName || this._deriveInfoDisplayName()
    this._loadingOverlayLabel.textContent = title ? `Loading ${title}…` : 'Loading video…'
  }

  _deriveInfoDisplayName() {
    if (this.titleInfo) {
      if (typeof this.titleInfo.getName === 'function') {
        const name = this.titleInfo.getName()
        if (name) return name
      }
      if (typeof this.titleInfo.getTitle === 'function') {
        const title = this.titleInfo.getTitle()
        if (title) return title
      }
      if (typeof this.titleInfo.getDescription === 'function') {
        const desc = this.titleInfo.getDescription()
        if (desc) return desc.replace(/<\/?br\s*\/?>/gi, ' ')
      }
      if (typeof this.titleInfo.getId === 'function') {
        const id = this.titleInfo.getId()
        if (id) return id
      }
    }
    return ''
  }

  _getFileNameFromPath(path) {
    if (!path) return ''
    let clean = path
    if (clean.endsWith('/playlist.m3u8')) clean = clean.substring(0, clean.lastIndexOf('/playlist.m3u8'))
    const idx = clean.lastIndexOf('/')
    return idx >= 0 ? clean.substring(idx + 1) : clean
  }

  _setTitleFromInfo(info) {
    if (!info || !this.titleSpan) return
    let display = ''

    if (info.getName && info.getName()) {
      display = info.getName()
    } else if (info.getTitle && info.getTitle()) {
      display = info.getTitle()
    } else if (info.getDescription && info.getDescription()) {
      display = info.getDescription().replace(/<\/?br\s*\/?>/gi, ' ')
    } else if (info.getId && info.getId()) {
      display = info.getId()
    }

    if (info.getYear && info.getYear()) {
      display += ` (${info.getYear()})`
    }

    const hasEpisode = info.getEpisode && typeof info.getEpisode === 'function' && Number(info.getEpisode()) > 0
    const hasSeason = info.getSeason && typeof info.getSeason === 'function' && Number(info.getSeason()) > 0
    if ((info.getType && info.getType() === 'TVEpisode') || hasEpisode) {
      const season = hasSeason ? String(info.getSeason()).padStart(2, '0') : '01'
      const episode = hasEpisode ? String(info.getEpisode()).padStart(2, '0') : '01'
      display += ` S${season}E${episode}`
    }

    this.titleSpan.innerHTML = display || ''
  }

  // ---- helpers ----
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
    this.player.on('seeked', () => this._updateVideoUrlToken(this.player.source))
    this.player.on('play', () => this._updateVideoUrlToken(this.player.source))
    this.player.on('exitfullscreen', () => this.container.restore && this.container.restore())
    this.container.addEventListener('dialog-maximized', () => {
      if (this.player.media.tagName.toLowerCase() === 'video') this.player.fullscreen.enter()
    })

    this.videoElement.addEventListener('loadeddata', this._handleVideoLoadedData)
    this.videoElement.addEventListener('playing', this._handleVideoPlaying)
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
    const token = getAuthToken()
    const parts = String(currentUrl || '').split('?')
    const base = parts[0]
    const params = new URLSearchParams(parts[1] || '')
    if (token && params.get('token') !== token) {
      params.set('token', token)
      const next = `${base}?${params.toString()}`
      this.videoElement.src = next
      this.player.play()
    }
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
    } else {
      const tracks = Array.from(this.querySelectorAll('globular-video-track'))
      if (tracks.length > 0) {
        let m3u = '#EXTM3U\n#PLAYLIST: Initial Playlist\n\n'
        for (const t of tracks) {
          try {
            const video = await t.getVideo()
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
            const getDur = video.getDuration ? video.getDuration() : 0
            if (getDur) {
              const label = (video.getTitle && video.getTitle()) || ''
              m3u += `#EXTINF:${getDur}, ${label}, tvg-id="${video.getId()}"\n`
              let titleFile = await getTitleFiles(video.getId(), '/search/videos')
              if (Array.isArray(titleFile) && titleFile.length > 0) {
                let filePath = titleFile[0]
                if (!/\.(mp4|m3u8|mkv)$/i.test(filePath)) filePath += '/playlist.m3u8'
                const isHls = /\.m3u8$/i.test(filePath)
                const url = isHls ? buildFileUrl(filePath, { includeToken: false }) : buildFileUrl(filePath)
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
    }
  }

  loadPlaylist(path, filePaths) {
    this.playlist.clear()
    // If your PlayList.load previously expected (path, globule, player, cb),
    // it should now ignore the second argument or you can update that class similarly.
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
    if (this.shuffleBtn) this.shuffleBtn.style.display = many ? 'block' : 'none'
    if (this.skipNextBtn) this.skipNextBtn.style.display = many ? 'block' : 'none'
    if (this.skipPreviousBtn) this.skipPreviousBtn.style.display = many ? 'block' : 'none'
    if (this.stopBtn) this.stopBtn.style.display = many ? 'block' : 'none'
    if (this.loopBtn) this.loopBtn.style.display = many ? 'block' : 'none'
    if (this.trackInfoElement) this.trackInfoElement.style.display = many ? 'block' : 'none'
  }

  setTrackInfo(index, total) {
    if (this.trackInfoElement) this.trackInfoElement.innerHTML = `${index + 1} of ${total}`
  }

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

  getPreview() {
    if (this.previewElement) {
      if (this.titleInfo) {
        const posterObj = callMaybe(this.titleInfo, 'getPoster') || propMaybe(this.titleInfo, 'poster')
        const posterUrl = posterObj
          ? callMaybe(posterObj, 'getContenturl') || propMaybe(posterObj, 'contenturl') || propMaybe(posterObj, 'url')
          : ''
        if (posterUrl) {
          this.previewElement.style.backgroundImage = `url('${posterUrl}')`
        }
        const titleText =
          callMaybe(this.titleInfo, 'getTitle') ||
          propMaybe(this.titleInfo, 'title') ||
          propMaybe(this.titleInfo, 'name') ||
          ''
        if (this.previewElement._title && titleText) this.previewElement._title.innerHTML = titleText
      }
      const playBtn = this.previewElement.querySelector('#preview-play-btn')
      const pauseBtn = this.previewElement.querySelector('#preview-pause-btn')
      const playing = this.player && this.player.playing ? 'Pause' : 'Play'
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
      const clapperUrl = new URL('../assets/images/movie-clapperboard.svg', import.meta.url).href;
      // or: import clapperUrl from '../assets/images/movie-clapperboard.svg?url';

      preview.style.backgroundImage = `url('${clapperUrl}')`;
    }

    preview.style.backgroundSize = 'cover'
    preview.style.backgroundPosition = 'center center'
    preview.style.backgroundBlendMode = 'overlay'
    preview.style.backgroundRepeat = 'no-repeat'


    const titleSpan = document.createElement('span')
    titleSpan.style.cssText = 'color:white;padding:2px;font-size:.8rem;font-weight:500;overflow:hidden;text-overflow:ellipsis;position:absolute;bottom:0;'
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

    buttons.appendChild(prev); buttons.appendChild(play); buttons.appendChild(pause); buttons.appendChild(next)

    const info = document.createElement('span')
    info.style.cssText = 'color:white;font-size:1rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:16px;'
    info.innerHTML = this.trackInfoElement ? this.trackInfoElement.innerHTML : ''

    preview.appendChild(buttons)
    preview.appendChild(info)

    this.previewElement = preview


    return preview
  }

  async play(path, titleInfo) {
    if (titleInfo) {
      this.titleInfo = titleInfo
      // set the title
      this._setTitleFromInfo(titleInfo)
    } else {
      this.titleInfo = null
    }

    await getFreshToken(60_000)
    let urlToPlay = path
    let token = getAuthToken()
    const isHttpSource = /^https?:\/\//i.test(urlToPlay)
    const isHlsSource = /\.m3u8($|\?)/i.test(urlToPlay)

    if (!isHttpSource) {
      urlToPlay = isHlsSource
        ? buildFileUrl(path, { includeToken: false })
        : buildFileUrl(path, token)
    } else if (!isHlsSource) {
      const u = new URL(urlToPlay)
      const p = new URLSearchParams(u.search)
      if (token && p.get('token') !== token) {
        p.set('token', token)
        u.search = p.toString()
        urlToPlay = u.toString()
      }
    }

    if (this.path === path && !this.videoElement.paused) {
      this.resume = true
      this._playVideoElement()
      return
    } else if (this.path === path && this.videoElement.paused) {
      this.resume = true
      this._playVideoElement()
      return
    } else {
      this.path = path
      this.resume = false
      this._dialogReady = false
      this._loadingName = this._getFileNameFromPath(path)
      this._showLoadingOverlay()
    }
    this._onPlayFired = false

    try {
      const doHead = async () => {
        const headers = {}
        if (token && (!urlToPlay.includes('token=') || isHlsSource)) {
          headers['Authorization'] = `Bearer ${token}`
          headers['token'] = token
        }
        return fetch(urlToPlay, { method: 'HEAD', headers })
      }

      let head = await doHead()
      if (head.status === 401) {
        try {
          const next = await forceRefresh()
          if (next) {
            token = next
            if (!isHttpSource) {
              urlToPlay = isHlsSource
                ? buildFileUrl(path, { includeToken: false })
                : buildFileUrl(path, next)
            } else if (!isHlsSource) {
              const u = new URL(urlToPlay)
              const p = new URLSearchParams(u.search)
              p.set('token', next)
              u.search = p.toString()
              urlToPlay = u.toString()
            }
            head = await doHead()
          }
        } catch {
          // fallthrough
        }
      }

      if (head.status === 401) {
        displayError(`Unable to read the file ${path}. Check your access privilege.`)
        this.close()
        return
      } else if (head.status !== 200) {
        throw new Error(`HTTP status ${head.status}`)
      }

      this.playContent(path, token, urlToPlay)
    } catch (e) {
      displayError(`Failed to access video URL ${urlToPlay}: ${e.message}`)
      this.stop()
    }
  }

  async playContent(path, token, urlToPlay) {
    this.resized = false
    this.style.zIndex = 100

    let info = this.titleInfo || null
    if (!info) {
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
    }
    this.titleInfo = info
    if (this.titleInfo) {
      this._setTitleFromInfo(info)
    }else{
      this.titleSpan.innerHTML = this._getFileNameFromPath(path)
    }
    this._updateLoadingOverlayText()

    if (this.titleInfo && this.titleInfo.getId) {
      const stored = localStorage.getItem(this.titleInfo.getId())
      if (stored) this.videoElement.currentTime = parseFloat(stored)

      if (token) {
        getWatchingTitle(
          this.titleInfo.getId(),
          (watching) => { if (watching && typeof watching.currentTime === 'number') this.videoElement.currentTime = watching.currentTime },
          () => { }
        )
      }

      if (this.playlist.style.display === 'none') {
        Backend.publish(
          'play_video_player_evt_',
          {
            _id: this.titleInfo.getId(),
            isVideo: true,
            currentTime: this.videoElement.currentTime,
            date: new Date()
          },
          true
        )
      }
    }

    // timeline thumbnail previews
    const timelineDir = buildHiddenTimelineDir(path)
    const previewSrc = appendTokenParam(buildFileUrl(`${timelineDir}/thumbnails.vtt`, token), token)
    if (previewSrc && this.player && this.player.setPreviewThumbnails) {
      this.player.setPreviewThumbnails({ enabled: 'true', src: previewSrc })
    }

    // reset element before assigning new source to avoid stale decode state
    this.videoElement.pause()
    this.videoElement.removeAttribute('src')
    this.videoElement.load()

    // set source
    const src = urlToPlay

    if (this.hls) { this.hls.destroy(); this.hls = null }

    if (/\.m3u8($|\?)/i.test(src)) {
      if (Hls.isSupported()) {
        this.hls = new Hls({
          xhrSetup: (xhr) => {
            const freshToken = getAuthToken()
            if (freshToken) {
              xhr.setRequestHeader('Authorization', `Bearer ${freshToken}`)
              xhr.setRequestHeader('token', freshToken) // backward-compat if needed
            }
          }
        })
        this.hls.attachMedia(this.videoElement)
        this.hls.on(Hls.Events.MEDIA_ATTACHED, () => {
          this.hls.loadSource(src)
          this.hls.on(Hls.Events.MANIFEST_PARSED, () => this._playVideoElement())
        })
        this.hls.on(Hls.Events.ERROR, (_event, data) => {
          const status = data?.response?.code ?? data?.response?.status ?? null
          if (status === 401 || status === 403) {
            this._retryPlaybackAfterFailure()
            return
          }
          if (data?.fatal && data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            this._retryPlaybackAfterFailure()
          }
        })
      } else {
        displayError('HLS is not supported in this browser for .m3u8 files.')
        this.videoElement.src = src
        this._playVideoElement()
      }
    } else {
      this.videoElement.src = src
      this._playVideoElement()
    }
  }

  becomeFullscreen() {
    const v = this.videoElement
    if (v.requestFullscreen) v.requestFullscreen()
    else if (v.mozRequestFullScreen) v.mozRequestFullScreen()
    else if (v.webkitRequestFullscreen) v.webkitRequestFullscreen()
    else if (v.msRequestFullscreen) v.msRequestFullscreen()
  }

  close(saveState = true) {
    if (!this.isMinimized) {
      const pv = this.querySelector('.plyr--video')
      const width = pv ? pv.offsetWidth + 355 : 720
      const height = this.container.getHeight ? this.container.getHeight() : undefined
      localStorage.setItem('__video_player_dimension__', JSON.stringify({ width, height }))
    }
    this.stop(saveState)
    if (this.parentElement) this.parentElement.removeChild(this)
    if (this.onclose) this.onclose()
  }

  stop(save = true) {
    this.videoElement.pause()
    this.resized = false
    this._dialogReady = false
    this._hideLoadingOverlay()
    const completed = this._playbackCompleted
    this._playbackCompleted = false

    if (this.titleInfo && this.titleInfo.getId) {
      const payload = {
        _id: this.titleInfo.getId(),
        isVideo: true,
        currentTime: this.videoElement.currentTime,
        duration: this.videoElement.duration || 0,
        duration_ms: Number.isFinite(this.videoElement.duration)
          ? Math.round(this.videoElement.duration * 1000)
          : undefined,
        date: new Date()
      }
      const currentTime = Number(this.videoElement.currentTime)
      if (completed) {
        Backend.publish('remove_video_player_evt_', payload, true)
        removeWatchingTitle(this.titleInfo.getId()).catch(err => console.error("Failed to remove watching entry", err))
        localStorage.removeItem(this.titleInfo.getId())
        this._watchingRemovedAfterCompletion = true
      } else if (this._watchingRemovedAfterCompletion) {
        // Playback already reached the end recently; closing the player shouldn't re-save progress.
        this._watchingRemovedAfterCompletion = false
      } else if (save && currentTime > 0) {
        // persist watching state server-side so "continue watching" stays accurate
        saveWatchingTitle(payload).catch(err => console.error("Failed to save watching state", err))
        Backend.publish('stop_video_player_evt_', payload, true)
        localStorage.setItem(this.titleInfo.getId(), String(this.videoElement.currentTime))
      } else if (currentTime > 0) {
        localStorage.setItem(this.titleInfo.getId(), String(this.videoElement.currentTime))
      }
    }
  }

  /**
 * Compute a video size that fits nicely on the current screen.
 * Keeps aspect ratio, clamps to ~80% of viewport.
 */
  _getFittedVideoSize() {
    const nativeW = this.videoElement.videoWidth || 720
    const nativeH = this.videoElement.videoHeight || Math.round(nativeW * 9 / 16)

    const viewportW =
      window.innerWidth ||
      document.documentElement.clientWidth ||
      screen.width ||
      nativeW

    const viewportH =
      window.innerHeight ||
      document.documentElement.clientHeight ||
      screen.height ||
      nativeH

    const playlistWidth = this._playlistIsVisible() ? this._getPlaylistWidth() : 0

    // Available space for the entire player (video + playlist)
    const maxContainerW = viewportW * 0.9
    const maxVideoW = Math.max(240, maxContainerW - playlistWidth)
    const maxVideoH = viewportH * 0.85

    // Determine scale that keeps video within the available region
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
  if (this.isMinimized) return;

  // Need intrinsic video size to keep aspect ratio
  const videoW = this.videoElement?.videoWidth;
  const videoH = this.videoElement?.videoHeight;
  if (!videoW || !videoH) return;

  const calculatedWidth = this._resolveResizeWidth(w);
  if (!calculatedWidth || isNaN(calculatedWidth) || calculatedWidth <= 0) return;

  this.resized = true;

  // --- Playlist width (if visible) ---
  let playlistWidth = 0;
  try {
    if (this._playlistIsVisible && this._playlistIsVisible()) {
      playlistWidth =
        (this._getPlaylistWidth && this._getPlaylistWidth()) ||
        this.playlist?.offsetWidth ||
        0;
    }
  } catch {
    // best-effort only
  }

  // Avoid negative space for the video
  playlistWidth = Math.max(0, playlistWidth);

  // Viewport max for the *whole* dialog
  const viewportMaxContainerWidth = window.innerWidth * 0.95;

  // Use the given width as "desired container width"
  let desiredContainerWidth = calculatedWidth;

  // Don't let desired container be smaller than playlist alone
  const minVideoWidth = 200; // arbitrary sane minimum
  const minContainerWidth = playlistWidth + minVideoWidth;
  if (desiredContainerWidth < minContainerWidth) {
    desiredContainerWidth = minContainerWidth;
  }

  // Container can't exceed viewport
  desiredContainerWidth = Math.min(desiredContainerWidth, viewportMaxContainerWidth);

  // From the desired container width, derive desired video width
  let desiredVideoWidth = desiredContainerWidth - playlistWidth;
  if (desiredVideoWidth <= 0) return;

  // Now enforce:
  // - video width ≤ intrinsic video width
  // - video width ≤ viewport after accounting for playlist
  const maxVideoWidthByViewport = viewportMaxContainerWidth - playlistWidth;
  const maxVideoWidthAllowed = Math.min(videoW, maxVideoWidthByViewport);

  if (maxVideoWidthAllowed <= 0) return;

  let videoWidthToApply = Math.min(desiredVideoWidth, maxVideoWidthAllowed);

  // Final container width to apply
  let containerWidthToApply = videoWidthToApply + playlistWidth;

  // Apply the width
  if (this.container && typeof this.container.setWidth === 'function') {
    this.container.setWidth(containerWidthToApply);
  } else {
    this.style.width = containerWidthToApply + 'px';
  }

  // --- Keep aspect ratio for height ---
  const ratio = videoH / videoW; // H/W
  const HEADER_OFFSET = 48;

  let videoHeight = Math.round(videoWidthToApply * ratio);

  // Clamp total height to viewport
  const viewportMaxHeight = window.innerHeight * 0.95;
  const maxAllowedHeight = Math.max(viewportMaxHeight - HEADER_OFFSET, 200);

  if (videoHeight > maxAllowedHeight) {
    // Too tall: clamp by height and recompute video width
    videoHeight = maxAllowedHeight;
    videoWidthToApply = Math.round(videoHeight / ratio);

    // Recalculate container width based on new video width
    containerWidthToApply = videoWidthToApply + playlistWidth;

    // Ensure we still respect viewport and intrinsic width
    const maxVideoWidthAgain = Math.min(
      videoW,
      viewportMaxContainerWidth - playlistWidth
    );
    if (videoWidthToApply > maxVideoWidthAgain) {
      videoWidthToApply = maxVideoWidthAgain;
      containerWidthToApply = videoWidthToApply + playlistWidth;
      videoHeight = Math.round(videoWidthToApply * ratio);
    }

    if (this.container && typeof this.container.setWidth === 'function') {
      this.container.setWidth(containerWidthToApply);
    } else {
      this.style.width = containerWidthToApply + 'px';
    }
  }

  const heightToApply = videoHeight + HEADER_OFFSET;

  if (this.container && typeof this.container.setHeight === 'function') {
    this.container.setHeight(heightToApply);
  } else {
    this.style.height = heightToApply + 'px';
  }
}



}

customElements.define('globular-video-player', VideoPlayer)

// --------- Declarative track element (JS) ---------

export class VideoTrack extends HTMLElement {
  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
    this.shadowRoot.innerHTML = `` // no visual content
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
        getVideoInfo(
          v.getId(),
          (full) => {
            full.setUrl(v.getUrl())
            resolve(full)
          },
          reject
        )
      })
      return fetched
    } catch (err) {
      console.warn(`Failed to fetch full video info for ${v.getId()}: ${err.message}. Returning attributes-only video.`)
      return v
    }
  }
}

customElements.define('globular-video-track', VideoTrack)
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
