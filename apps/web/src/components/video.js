// src/components/video.js

import Plyr from 'plyr'
import "./plyr.css"
import Hls from 'hls.js'

// App bus + helpers (no raw RPC calls)
import { displayError } from '../backend/ui/notify'
import { Backend } from '../backend/backend'

// Controllers / unified wrappers
import { readDir } from '../backend/cms/files'

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
  getWatchingTitle
} from '../backend/media/title'
import { getBaseUrl } from '../backend/core/endpoints'

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
function buildFileUrl(rawPath, token = getAuthToken(), application) {
  let url = getBaseUrl()
  const parts = (rawPath || '').split('/').map(p => p.trim()).filter(Boolean)
  parts.forEach(p => (url += '/' + encodeURIComponent(p)))

  const qs = new URLSearchParams()
  if (token) qs.append('token', token)
  if (application) qs.append('application', application)
  if (qs.toString()) url += '?' + qs.toString()
  return url
}

// --------- playlist helper ---------

export function playVideos(videos, name) {
  const unique = [...new Map(videos.map(v => [v.getId(), v])).values()]
  let m3u = '#EXTM3U\n'
  m3u += `#PLAYLIST: ${name}\n\n`

  let i = 0
  const next = async () => {
    if (i >= unique.length) {
      // No globule anymore; keep API compatible by omitting it
      playVideo(m3u, null, null, null)
      return
    }

    const v = unique[i++]

    // Without globule/config, default to the standard index path
    const indexPath = '/search/videos'

    try {
      const files = await getTitleFiles(v.getId(), indexPath)
      if (files.length > 0) {
        let filePath = files[0]
        if (!/\.(mp4|m3u8|mkv)$/i.test(filePath)) filePath += '/playlist.m3u8'
        const url = buildFileUrl(filePath)
        m3u += `#EXTINF:${v.getDuration()}, ${v.getDescription()}, tvg-id="${v.getId()}"\n`
        m3u += `${url}\n\n`
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

  const watching = document.querySelector('globular-media-watching')
  if (watching && watching.parentNode) watching.parentNode.removeChild(watching)

  if ((path || '').endsWith('video.m3u') || (path || '').startsWith('#EXTM3U')) {
    vp.loadPlaylist(path)
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
      </style>
      <globular-dialog id="video-container" name="video-player" is-moveable="true" is-maximizeable="true" is-resizeable="true" show-icon="true" is-minimizeable="true">
        <span id="title-span" slot="title">no select</span>
        <img slot="icon" src="${youtubeLogoUrl}"/>
        <select slot="header" id="audio-track-selector" style="display:none"></select>
        <paper-icon-button slot="header" id="title-info-button" icon="icons:arrow-drop-down-circle"></paper-icon-button>
        <globular-watching-menu slot="header"></globular-watching-menu>
        <div id="content"><slot name="playlist"></slot><slot name="watching"></slot><slot></slot></div>
      </globular-dialog>
      <slot name="tracks" style="display:none;"></slot>
    `

    this.container = this.shadowRoot.querySelector('#video-container')
    this.container.onminimize = () => {
      this.isMinimized = true
      if (this.onMinimize) this.onMinimize()
    }
    this.container.onclose = this.close.bind(this)
    this.container.getPreview = this.getPreview.bind(this)
    this.container.setBackGroundColor('black')
    this.container.onclick = (e) => e.stopPropagation()

    this.titleSpan = this.shadowRoot.querySelector('#title-span')
    this.audioTrackSelector = this.shadowRoot.querySelector('#audio-track-selector')
    this.watchingMenu = this.shadowRoot.querySelector('globular-watching-menu')
    this.titleInfoButton = this.shadowRoot.querySelector('#title-info-button')

    // Hide watching menu if not logged
    if (!getAuthToken()) {
      if (this.watchingMenu && this.watchingMenu.remove) this.watchingMenu.remove()
    } else {
      this.watchingMenu?.addEventListener('open-media-watching', (evt) => {
        evt.stopPropagation()
        evt.detail.mediaWatching.slot = 'watching'
        evt.detail.mediaWatching.style.zIndex = '1000'
        this.appendChild(evt.detail.mediaWatching)
      })
    }

    this.videoElement = document.createElement('video')
    this.videoElement.id = 'player'
    this.videoElement.autoplay = true
    this.videoElement.controls = true
    this.videoElement.playsInline = true
    this.appendChild(this.videoElement)

    this.container.style.height = 'auto'
    this.container.name = 'video_player'
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
    document.removeEventListener('refresh-preview', this._refreshPreviewHandler)

    this.skipPreviousBtn?.removeEventListener('click', this._skipPrevious)
    this.stopBtn?.removeEventListener('click', this._stopVideo)
    this.skipNextBtn?.removeEventListener('click', this._skipNext)
    this.loopBtn?.removeEventListener('click', this._toggleLoop)
    this.shuffleBtn?.removeEventListener('click', this._toggleShuffle)
    this.titleInfoButton?.removeEventListener('click', this._handleTitleInfoClick)
    this.videoElement?.removeEventListener('playing', this._handleVideoPlaying)
    this.videoElement?.removeEventListener('onloadeddata', this._handleVideoLoadedData)
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
      if (this.container.setHeight) this.container.setHeight(height)
    }
  }

  _handleOrientationChange = () => {
    const o = (screen.orientation || {}).type || screen.mozOrientation || screen.msOrientation
    if (['landscape-primary', 'landscape-secondary'].includes(o)) this.becomeFullscreen()
  }

  _handleVideoPlaying = () => {
    // Only auto-resize once per load; after that user can resize manually
    if (!this.resized) {
      const { width } = this._getFittedVideoSize()
      this.resize(width) // height will be computed in resize()
    }
  }

  _handleVideoLoadedData = async () => {
    // On first load, size the dialog to fit within viewport (both W & H)
    if (!this.resized) {
      const { width, height } = this._getFittedVideoSize()
      this.resize(width, height)
    }
    
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
    if (!this.titleInfo) return displayError('No title information found.')
    if (this.titleInfo.clearActorsList) this.showTitleInfo(this.titleInfo)
    else this.showVideoInfo(this.titleInfo)
  }

  _refreshPreviewHandler = () => {
    if (this.isMinimized && this.container.setPreview) {
      this.container.setPreview(this.getPreview())
    }
  }

  // ---- helpers ----
  _addCustomPlyrControls() {
    const controls = this.querySelector('.plyr__controls')
    if (!controls) return

    controls.style.flexWrap = 'wrap'
    controls.style.justifyContent = 'flex-start'

    const frag = document.createRange().createContextualFragment(`
      <div style="flex-basis:100%;height:1px;"></div>
      <iron-icon class="plyr__controls__item plyr__control custom-control" title="Shuffle Playlist" id="shuffle" icon="av:shuffle"></iron-icon>
      <iron-icon class="plyr__controls__item plyr__control custom-control" id="skip-previous" title="Previous Track" icon="av:skip-previous"></iron-icon>
      <iron-icon class="plyr__controls__item plyr__control custom-control" id="skip-next" title="Next Track" icon="av:skip-next"></iron-icon>
      <iron-icon class="plyr__controls__item plyr__control custom-control" id="stop-button" title="Stop" icon="av:stop"></iron-icon>
      <iron-icon class="plyr__controls__item plyr__control custom-control" title="Loop Playlist" id="repeat" icon="av:repeat"></iron-icon>
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
    this.audioTrackSelector.addEventListener('change', this._handleAudioTrackChange)

    this.videoElement.onended = () => {
      this.resume = false
      if (this.titleInfo) localStorage.removeItem(this.titleInfo.getId())

      if (this.playlist.items.length > 1) this.playlist.playNext()
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
              const label = (video.getTitle && video.getTitle()) || (video.getDescription && video.getDescription()) || ''
              m3u += `#EXTINF:${getDur}, ${label}, tvg-id="${video.getId()}"\n`
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

  loadPlaylist(path) {
    this.playlist.clear()
    // If your PlayList.load previously expected (path, globule, player, cb),
    // it should now ignore the second argument or you can update that class similarly.
    this.playlist.load(path, /* deprecated globule */ undefined, this, () => {
      this._updatePlaylistVisibility()
      setTimeout(fireResize, 500)
    })
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
        <paper-card id="video-info-box-dialog-${uuid}" style="background: var(--surface-color); z-index: 1001; position: fixed; top: 75px; left: 50%; transform: translate(-50%);">
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
      if (this.titleInfo && this.titleInfo.getPoster) {
        this.previewElement.style.backgroundImage = `url('${this.titleInfo.getPoster().getContenturl()}')`
        if (this.previewElement._title) this.previewElement._title.innerHTML = this.titleInfo.getDescription()
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
      posterUrl = this.titleInfo.getPoster && this.titleInfo.getPoster().getContenturl()
      description = this.titleInfo.getDescription ? this.titleInfo.getDescription() : ''
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
    titleSpan.innerHTML = description
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
    } else {
      this.titleInfo = null
    }

    let urlToPlay = path
    const token = getAuthToken()

    if (!/^https?:\/\//i.test(urlToPlay)) {
      urlToPlay = buildFileUrl(path, token)
    } else {
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
      this.videoElement.play()
      return
    } else if (this.path === path && this.videoElement.paused) {
      this.resume = true
      this.videoElement.play()
      return
    } else {
      this.path = path
      this.resume = false
    }

    try {
      const head = await fetch(urlToPlay, { method: 'HEAD' })
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

    const fileName = path.substring(path.lastIndexOf('/') + 1).replace('/playlist.m3u8', '')
    this.titleSpan.innerHTML = fileName
    if (!this.isMinimized) this.container.style.display = ''

    let info = this.titleInfo || null
    if (!info) {
      try {
        const vids = await getFileVideosInfo(path).catch(() => [])
        if (Array.isArray(vids) && vids.length > 0) {
          info = vids[0]
          info.isVideo = true
          if (info.getDescription) this.titleSpan.innerHTML = info.getDescription().replace('</br>', ' ')
        } else {
          const titles = await getFileTitlesInfo(path).catch(() => [])
          if (Array.isArray(titles) && titles.length > 0) {
            info = titles[0]
            info.isVideo = false
            let display = info.getName ? info.getName() : ''
            if (info.getYear && info.getYear()) display += ` (${info.getYear()})`
            if (info.getType && info.getType() === 'TVEpisode') {
              if (info.getSeason && info.getEpisode) {
                display += ` S${info.getSeason()}E${info.getEpisode()}`
              }
            }
            this.titleSpan.innerHTML = display
          }
        }
      } catch (err) {
        console.error('Error fetching title/video info:', err)
      }
    }
    this.titleInfo = info

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
            isVideo: this.titleInfo.isVideo,
            currentTime: this.videoElement.currentTime,
            date: new Date()
          },
          true
        )
      }
    }

    // timeline thumbnail
    let thumbBase = path
    if (/\.(mp4|MP4|mkv)$/i.test(path)) thumbBase = path.substring(0, path.lastIndexOf('.'))
    const vtt = buildFileUrl(
      `${thumbBase.substring(0, thumbBase.lastIndexOf('/') + 1)}.hidden${thumbBase.substring(thumbBase.lastIndexOf('/'))}/__timeline__/thumbnails.vtt`,
      token
    )
    if (this.player && this.player.setPreviewThumbnails) {
      this.player.setPreviewThumbnails({ enabled: 'true', src: vtt })
    }

    // set source
    const src = urlToPlay

    if (this.hls) { this.hls.destroy(); this.hls = null }

    if (/\.m3u8($|\?)/i.test(src)) {
      if (Hls.isSupported()) {
        this.hls = new Hls({
          xhrSetup: (xhr) => {
            if (token) {
              xhr.setRequestHeader('Authorization', `Bearer ${token}`)
              xhr.setRequestHeader('token', token) // backward-compat if needed
            }
          }
        })
        this.hls.attachMedia(this.videoElement)
        this.hls.on(Hls.Events.MEDIA_ATTACHED, () => {
          this.hls.loadSource(src)
          this.hls.on(Hls.Events.MANIFEST_PARSED, () => this.videoElement.play())
        })
      } else {
        displayError('HLS is not supported in this browser for .m3u8 files.')
        this.videoElement.src = src
        this.videoElement.play()
      }
    } else {
      this.videoElement.src = src
      this.videoElement.play()
    }

    if (this.onplay && this.titleInfo) this.onplay(this.player, this.titleInfo)
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

    if (this.titleInfo && this.titleInfo.getId) {
      const payload = {
        _id: this.titleInfo.getId(),
        isVideo: this.titleInfo.isVideo,
        currentTime: this.videoElement.currentTime,
        date: new Date()
      }
      if (this.videoElement.duration !== this.videoElement.currentTime && save) {
        Backend.publish('stop_video_player_evt_', payload, true)
      } else {
        Backend.publish('remove_video_player_evt_', payload, true)
      }
      localStorage.setItem(this.titleInfo.getId(), String(this.videoElement.currentTime))
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

    const maxW = viewportW * 0.8
    const maxH = viewportH * 0.8

    let scale = 1
    if (nativeW > maxW || nativeH > maxH) {
      const scaleW = maxW / nativeW
      const scaleH = maxH / nativeH
      scale = Math.min(scaleW, scaleH)
    }

    return {
      width: Math.round(nativeW * scale),
      height: Math.round(nativeH * scale)
    }
  }

  resize(containerWidth) {
    if (this.isMinimized) return

    this.resized = true

    // Prefer an explicit containerWidth, then native video width, then 720
    let w = containerWidth || this.videoElement.videoWidth || 720

    const nativeW = this.videoElement.videoWidth || 0
    const listW =
      this.playlist && this.playlist.offsetWidth ? this.playlist.offsetWidth : 0

    // Don’t go wider than the video itself (before adding playlist)
    if (nativeW > 0 && w > nativeW) {
      w = nativeW
    }

    // If playlist is visible and has more than one item, add its width
    if (this.playlist.count() > 1 && this.playlist.style.display !== 'none') {
      w += listW
    }

    // Clamp to screen width
    const max = screen.width * 0.95
    if (w > max) w = max

    if (this.container.setWidth) this.container.setWidth(w)
    if (this.container.setHeight) this.container.setHeight('auto')
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
