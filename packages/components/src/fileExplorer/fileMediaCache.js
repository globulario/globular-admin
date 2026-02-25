/**
 * fileMediaCache.js
 *
 * Bounded LRU cache for per-file media metadata (VideoInfo, AudioInfo, TitleInfo).
 *
 * Previously, _getFileDisplayInfo() mutated the file proto object directly:
 *   file.videos = videos
 *   file.audios = audios
 *   file.titles = [title]
 *
 * This caused two problems:
 *  1. Proto objects accumulated unbounded metadata as directories were visited.
 *  2. The directory proto (which holds all file protos) stayed in memory with
 *     all its enriched children even after navigating away, because the mutation
 *     kept the large info objects reachable through the file proto graph.
 *
 * This cache stores fetched metadata separately, keyed by absolute file path,
 * with a fixed maximum size.  When full, the least-recently-used entry is
 * evicted so memory use is bounded regardless of how many directories are visited.
 */

/** Maximum number of file paths whose metadata we keep simultaneously. */
const MAX_ENTRIES = 200;

class LruMap {
  constructor(max) {
    this._max = max;
    this._map  = new Map(); // insertion-order = LRU order
  }

  get(key)       { return this._map.get(key); }
  has(key)       { return this._map.has(key); }
  delete(key)    { return this._map.delete(key); }
  clear()        { this._map.clear(); }
  get size()     { return this._map.size; }

  set(key, value) {
    // Re-inserting refreshes the entry to "most recently used"
    if (this._map.has(key)) this._map.delete(key);
    this._map.set(key, value);

    // Evict oldest when over limit
    if (this._map.size > this._max) {
      this._map.delete(this._map.keys().next().value);
    }
    return this;
  }
}

const _cache = new LruMap(MAX_ENTRIES);

/**
 * Store or merge media info for a file path.
 *
 * Accepts a partial object — only the provided keys are updated; existing keys
 * are preserved.  Call once per info type as it becomes available:
 *
 *   mergeMediaInfo(path, { videos })
 *   mergeMediaInfo(path, { audios })
 *   mergeMediaInfo(path, { titles, thumbnailUrl })
 *
 * @param {string} path - absolute file path used as the cache key
 * @param {{ videos?: any[], audios?: any[], titles?: any[], thumbnailUrl?: string }} info
 */
export function mergeMediaInfo(path, info) {
  if (!path || !info) return;
  const existing = _cache.get(path) ?? {};
  _cache.set(path, { ...existing, ...info });
}

/**
 * Retrieve all cached media info for a path.
 *
 * @param {string} path
 * @returns {{ videos?: any[], audios?: any[], titles?: any[], thumbnailUrl?: string } | null}
 */
export function getMediaInfo(path) {
  return _cache.get(path) ?? null;
}

/**
 * Remove cached info for a specific file (e.g. after deletion or rename).
 *
 * @param {string} path
 */
export function clearMediaInfo(path) {
  if (path) _cache.delete(path);
}

/**
 * Wipe the entire cache (e.g. on logout or server switch).
 */
export function clearAllMediaInfo() {
  _cache.clear();
}
