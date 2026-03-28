import parser from 'iptv-playlist-parser';
import { secondsToTime, fireResize } from '@globular/components/utility.js';

// Use your real backends (functions, not controllers)
import { getAudioInfo, getVideoInfo } from '@globular/sdk';
import { readText } from '@globular/sdk';

/** Replace all URLs in a string with a new URL. */
function replaceURLs(inputString, newURL) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return inputString.replace(urlRegex, newURL);
}

/** Parse a minimal M3U, returning only the media URLs. */
function parseM3U(m3uContent) {
  const urls = [];
  const lines = m3uContent.split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (line && !line.startsWith('#') && line.startsWith('http')) {
      urls.push(line);
    }
  }
  return urls;
}

/** Fisher–Yates shuffle. */
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * `globular-playlist` – manages a playlist of audio/video tracks.
 */
export class PlayList extends HTMLElement {
  // Internal state
  _index = 0;
  _items = [];
  _audioPlayer = null;
  _videoPlayer = null;

  // Cached DOM
  _container = null;
  _itemsContainer = null;
  _hideNShowBtn = null;

  // Parsed playlist (from iptv-playlist-parser)
  playlist = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._renderHTML();
  }

  connectedCallback() {
    this._cacheElements();
    this._setupEventListeners();
    setTimeout(fireResize(), 500)
  }

  disconnectedCallback() {
    this._cleanupEventListeners();
  }

  clear() {
    this._items = [];
    this._index = 0;
    this.innerHTML = '';
  }

  getWidth() {
    return this._container ? this._container.offsetWidth : 0;
  }

  playNext() {
    if (this._index < this._items.length - 1) {
      this._index++;
      this.setPlaying(this._items[this._index], true, true);
    } else {
      this._index = 0;
      this._items.forEach((item) => {
        item.stopPlaying();
        item.classList.remove('playing');
      });
      const loopEnabled = this._audioPlayer?.loop || this._videoPlayer?.loop;
      if (loopEnabled && this._items.length > 0) {
        this.setPlaying(this._items[this._index], true, true);
      }
    }
  }

  playPrevious() {
    if (this._index > 0) {
      this._index--;
      this.setPlaying(this._items[this._index], true, true);
    }
  }

  stop() {
    this._index = 0;
    this._items.forEach((item) => {
      item.stopPlaying();
      item.classList.remove('playing');
    });
    this._items[0]?.scrollIntoView({ behavior: 'smooth' });
  }

  pausePlaying() {
    const currentItem = this._items[this._index];
    currentItem?.pausePlaying();
  }

  resumePlaying() {
    const currentItem = this._items[this._index];
    if (currentItem) this.setPlaying(currentItem, false, false);
  }

  /**
   * Load playlist from raw M3U, an http(s) URL, or a server path (read via File service).
   * @param {string} txt content, URL or server path to an .m3u/.m3u8
   * @param {*} _globule (unused; kept for signature compatibility)
   * @param {*} player AudioPlayer or VideoPlayer instance
   * @param {Function=} callback optional callback when rendered
   */
  async load(txt, metaPaths, player, callback) {
    this._audioPlayer = player?.constructor?.name === 'AudioPlayer' ? player : null;
    this._videoPlayer = player?.constructor?.name === 'VideoPlayer' ? player : null;

    this._items = [];
    this.innerHTML = '';

    const parseAndMap = (content) => {
      const urls = parseM3U(content);
      const parsed = parser.parse(replaceURLs(content, 'http://localhost:8080/'));
      parsed.items.forEach((it, idx) => (it.url = urls[idx]));
      return parsed;
    };

    let playlistData = null;
    try {
      if (typeof txt === 'string' && txt.startsWith('#EXTM3U')) {
        // Raw content
        playlistData = parseAndMap(txt);
      } else if (Array.isArray(txt)) {
        playlistData = { items: txt };
      } else if (/^https?:\/\//i.test(txt)) {
        // External URL
        const resp = await fetch(txt, { credentials: 'include' });
        const m3u = await resp.text();
        playlistData = parseAndMap(m3u);
      } else {
        // Server path — use File service helper
        const m3u = await readText(txt);
        playlistData = parseAndMap(m3u);
      }
    } catch (err) {
      console.error('Failed to load playlist:', err?.message || err);
      return;
    }

    if (Array.isArray(metaPaths) && playlistData?.items?.length === metaPaths.length) {
      playlistData.items.forEach((it, idx) => {
        const path = metaPaths[idx];
        it.filePath = path;
        it.url = path;
      });
    }
    this.playlist = playlistData;
    await this.refresh(callback);
  }

  async refresh(callback) {
    if (!this.playlist?.items?.length) {
      this.hidePlaylist();
      callback?.();
      return;
    }

    for (const [index, item] of this.playlist.items.entries()) {
      const playListItem = await new Promise((resolve) => new PlayListItem(item, this, index, resolve));

      playListItem.addEventListener('mouseover', () => {
        if (!playListItem.isPlaying) {
          playListItem.hidePauseButton();
          playListItem.showPlayButton();
        }
      });
      playListItem.addEventListener('mouseleave', () => {
        if (!playListItem.isPlaying) {
          playListItem.hidePlayButton();
          playListItem.hidePauseButton();
        }
      });

      this._items.push(playListItem);
      this.appendChild(playListItem);
    }

    this.orderItems();

    if (this._items.length > 0) {
      this.setPlaying(this._items[0], true, true);
    }

    callback?.();
  }

  orderItems() {
    let itemsToOrder = [...this._items];
    const shuffle = this._audioPlayer?.shuffle || this._videoPlayer?.shuffle;

    if (shuffle) {
      itemsToOrder = shuffleArray(itemsToOrder);
    } else {
      itemsToOrder.sort((a, b) => a.index - b.index);
    }

    itemsToOrder.forEach((i) => this.appendChild(i));
    this._items = itemsToOrder;
  }

  setPlaying(item, restart, resume) {
    this._items.forEach((i) => {
      i.stopPlaying();
      i.classList.remove('playing');
    });

    this._index = this._items.indexOf(item);
    item.setPlaying();
    item.classList.add('playing');

    // Note: we pass `null` for globule (no resolver here)
    const trackPath = item.filePath || item.url;
    if (this._audioPlayer) {
      this._audioPlayer.play(trackPath, item.audio, restart, resume);
      this._audioPlayer.setTrackInfo?.(this._index, this._items.length);
    } else if (this._videoPlayer) {
      this._videoPlayer.play(trackPath, null, item.video, restart, resume);
      this._videoPlayer.setTrackInfo?.(this._index, this._items.length);
    }

    item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  count() {
    return this._items.length;
  }

  _handleWindowResize = () => {
    // Let the host size be the authority; just ensure container matches it.
    // Let the parent (VideoPlayer) decide exact height; we just stretch.
    if (this._container) {
      this._container.style.height = '100%';
    }
  };

  // --- DOM / events

  _renderHTML() {
    this.shadowRoot.innerHTML = `
    <style>
      :host {
        display:block;
        height:100%;
      }

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

      #container {
        display:flex;
        overflow-y:auto;
        overflow-x:hidden;
        background-color:black;
        width:100%;
        max-width:350px;
        height:100%;
        scrollbar-width: thin;
        scrollbar-color: var(--scroll-thumb, rgba(120,120,120,0.7))
                         var(--scroll-track, rgba(0,0,0,0.05));
      }

      #items {
        display:flex;
        flex-direction:column;
        flex-grow:1;
        padding-bottom:50px;
        width:100%;
        min-width:0;
      }

      ::slotted(.playing) {
        background: linear-gradient(90deg, rgba(255,255,255,0.08), rgba(255,255,255,0)) !important;
        border-left: 2px solid var(--accent-color, #2196F3) !important;
      }

      /* ... rest unchanged ... */
    </style>
    <div id="container">
      <div id="items"><slot></slot></div>
    </div>
  `;
  }

  _cacheElements() {
    this._container = this.shadowRoot.querySelector('#container');
    this._itemsContainer = this.shadowRoot.querySelector('#items');
  }

  _setupEventListeners() {
    if (this._hideNShowBtn) {
      this._hideNShowBtn.addEventListener('click', this._handleHideShowClick);
    }
    //window.addEventListener('resize', this._handleWindowResize);
  }

  _cleanupEventListeners() {
    if (this._hideNShowBtn) {
      this._hideNShowBtn.removeEventListener('click', this._handleHideShowClick);
    }
  }

}

customElements.define('globular-playlist', PlayList);

/**
 * `globular-playlist-item` – a single clickable item in a playlist.
 */
export class PlayListItem extends HTMLElement {
  _item = null;
  _parent = null;
  index = -1;

  audio = null;
  video = null;

  _isPlaying = false;
  _needsResume = false;

  _playBtn = null;
  _pauseBtn = null;
  _titleDuration = null;
  _titleImage = null;
  _titleDiv = null;
  _titleArtistSpan = null;

  // also used by parent player
  id = undefined;
  url = undefined;
  src = undefined;

  constructor(item, parent, index, done) {
    super();
    this.attachShadow({ mode: 'open' });

    this._item = item;
    this._parent = parent;
    this.index = index;

    this._renderHTML();
    this._cacheElements();
    this._setupEventListeners();

    this._initializeItem()
      .catch((e) => console.warn('Playlist item init error:', e))
      .finally(() => done(this));
  }

  get isPlaying() { return this._isPlaying; }

  setPlaying() {
    this._isPlaying = true;
    this._needsResume = false;
    this.hidePlayButton();
    this.showPauseButton();
  }

  pausePlaying() {
    this._isPlaying = false;
    this._needsResume = true;
    this.hidePauseButton();
    this.showPlayButton();
  }

  stopPlaying() {
    this._isPlaying = false;
    this._needsResume = false;
    this.hidePauseButton();
    this.hidePlayButton();
    if (this._playBtn) this._playBtn.style.display = 'block';
    if (this._pauseBtn) this._pauseBtn.style.display = 'none';
    this.classList.remove('playing');
  }

  showPlayButton() { if (this._playBtn) this._playBtn.style.visibility = 'visible'; }
  hidePlayButton() { if (this._playBtn) this._playBtn.style.visibility = 'hidden'; }
  showPauseButton() { if (this._pauseBtn) this._pauseBtn.style.visibility = 'visible'; }
  hidePauseButton() { if (this._pauseBtn) this._pauseBtn.style.visibility = 'hidden'; }

  _renderHTML() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: flex;
          align-items: center;
          width: 100%;
          min-width: 0;
          padding: 6px 8px;
          box-sizing: border-box;
          gap: 10px;
          color: #ccc;
          cursor: default;
          border-bottom: 1px solid rgba(255,255,255,.06);
          transition: background .15s;
          overflow: hidden;
        }
        :host(:hover) { background: rgba(255,255,255,.06); }

        .controls {
          flex-shrink: 0;
          width: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .controls iron-icon {
          width: 20px;
          height: 20px;
          color: #fff;
          cursor: pointer;
        }
        #play-arrow, #pause { visibility: hidden; }
        :host(:hover) #play-arrow, :host(:hover) #pause { visibility: visible; }

        .thumb {
          flex-shrink: 0;
          width: 48px;
          height: 36px;
          border-radius: 3px;
          overflow: hidden;
          background: #111;
        }
        .thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .info {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .title {
          font-size: .82rem;
          font-weight: 500;
          color: #eee;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .meta {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: .72rem;
          color: #888;
        }
        .artist {
          flex: 1;
          min-width: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .duration {
          flex-shrink: 0;
          font-variant-numeric: tabular-nums;
        }
      </style>
      <div class="controls">
        <iron-icon id="play-arrow" title="Play" icon="av:play-arrow"></iron-icon>
        <iron-icon id="pause" title="Pause" style="display:none" icon="av:pause"></iron-icon>
      </div>
      <div class="thumb"><img id="title-image" /></div>
      <div class="info">
        <div id="title-div" class="title"></div>
        <div class="meta">
          <span id="title-artist-span" class="artist"></span>
          <span id="title-duration-span" class="duration"></span>
        </div>
      </div>
    `;
  }

  _cacheElements() {
    this._playBtn = this.shadowRoot.querySelector('#play-arrow');
    this._pauseBtn = this.shadowRoot.querySelector('#pause');
    this._titleDuration = this.shadowRoot.querySelector('#title-duration-span');
    this._titleImage = this.shadowRoot.querySelector('#title-image');
    this._titleDiv = this.shadowRoot.querySelector('#title-div');
    this._titleArtistSpan = this.shadowRoot.querySelector('#title-artist-span');
  }

  _setupEventListeners() {
    this._playBtn?.addEventListener('click', this._handlePlayClick);
    this._pauseBtn?.addEventListener('click', this._handlePauseClick);
  }

  _handlePlayClick = () => {
    if (this._needsResume) {
      this._parent.setPlaying(this, false, true);
    } else {
      this._parent.setPlaying(this, true, true);
    }
  };

  _handlePauseClick = () => {
    this.pausePlaying();
    if (this._parent?._audioPlayer) {
      this._parent._audioPlayer.pause();
    } else if (this._parent?._videoPlayer) {
      this._parent._videoPlayer.stop();
      this._needsResume = true;
    }
  };

  /** Initialize by fetching metadata using your new backend helpers. */
  async _initializeItem() {
    this.id = this._item?.tvg?.id;
    this.url = this._item?.url;
    this.src = this._item?.tvg?.url; // thumbnail URL (if present)

    // Try Audio first, then Video
    try {
      if (this.id) {
        const audio = await getAudioInfo(this.id);
        if (audio) {
          this.audio = audio;
          this._updateDisplayFromMetadata(audio);
          return;
        }
      }
    } catch (_) {
      // continue to try video
    }

    try {
      if (this.id) {
        const video = await getVideoInfo(this.id);
        if (video) {
          this.video = video;
          this._updateDisplayFromMetadata(video);
        }
      }
    } catch (err) {
      console.error(`Failed to initialize playlist item ${this.id}:`, err);
    }
  }

  _updateDisplayFromMetadata(metadata) {
    // Accept both protobuf-style getters and plain fields
    const title =
      (metadata.getTitle && metadata.getTitle()) ||
      metadata.title ||
      (metadata.getDescription && metadata.getDescription()) ||
      metadata.description ||
      '';
    const artist =
      (metadata.getArtist && metadata.getArtist()) ||
      metadata.artist ||
      (metadata.getPublisherid &&
        metadata.getPublisherid() &&
        metadata.getPublisherid().getName &&
        metadata.getPublisherid().getName()) ||
      (metadata.publisher && metadata.publisher.name) ||
      '';
    const poster =
      (metadata.getPoster &&
        metadata.getPoster() &&
        metadata.getPoster().getContenturl &&
        metadata.getPoster().getContenturl()) ||
      (metadata.poster && metadata.poster.contentUrl) ||
      this.src ||
      '';

    const duration =
      (metadata.getDuration && metadata.getDuration()) ||
      metadata.duration;

    if (this._titleDiv) this._titleDiv.textContent = title;
    if (this._titleArtistSpan) this._titleArtistSpan.textContent = artist;
    if (this._titleImage) this._titleImage.src = poster || '';
    if (this._titleDuration && duration != null) {
      this._titleDuration.textContent = this._formatDuration(duration);
    }
  }

  _formatDuration(durationSeconds) {
    const { h, m, s } = secondsToTime(durationSeconds);
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
    if (m > 0) return `${pad(m)}:${pad(s)}`;
    return `${s}'s`;
  }

  // Kept for reference; metadata parsing is better handled by backend
  parseName(name) {
    return { title: name, author: '', featuring: '' };
  }
}

customElements.define('globular-playlist-item', PlayListItem);