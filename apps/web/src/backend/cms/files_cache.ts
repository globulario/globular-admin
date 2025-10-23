// src/backend/files_cache.ts
import type { DirVM, FileVM } from "./files"
import { readDir as remoteReadDir } from "./files"

type DirEntry = {
  data: DirVM
  ts: number       // cached at
  gen: number      // monotonic generation
}

export class FilesCache {
  private dirs = new Map<string, DirEntry>()
  private inflight = new Map<string, Promise<DirVM>>()
  private max = 200
  private ttlMs = 15000
  private gen = 0
  private bc?: BroadcastChannel

  constructor(opts?: { max?: number; ttlMs?: number; multiTab?: boolean }) {
    if (opts?.max) this.max = opts.max
    if (opts?.ttlMs) this.ttlMs = opts.ttlMs
    if (opts?.multiTab) {
      this.bc = new BroadcastChannel("files-cache")
      this.bc.onmessage = (e) => {
        const { type, path } = e.data || {}
        if (type === "invalidate" && typeof path === "string") this.invalidate(path)
      }
    }
  }

  /** Return cached quickly; optionally refresh in background (SWR). */
  async getDir(path: string, swr = true): Promise<DirVM> {
    const now = Date.now()
    const cached = this.dirs.get(path)
    const fresh = cached && (now - cached.ts) < this.ttlMs

    if (fresh) return cached.data

    // serve stale if present, and revalidate in background
    if (cached && swr) {
      this.revalidate(path, cached.gen) // fire & forget
      return cached.data
    }

    // no cache or SWR false → fetch now
    return this.fetchDir(path)
  }

  /** Force refresh (used after edits, or when SWR=false). */
  async fetchDir(path: string): Promise<DirVM> {
    const existing = this.inflight.get(path)
    if (existing) return existing

    const p = (async () => {
      const data = await remoteReadDir(path, /*includeHidden*/ false)
      this.put(path, data)
      return data
    })()

    this.inflight.set(path, p)
    try { return await p } finally { this.inflight.delete(path) }
  }

  /** Mark a directory (and optionally its parent) stale after mutations. */
  invalidate(path: string): void {
    // drop the dir itself
    this.dirs.delete(path)
    // and the parent listing, since its children set changed
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) || "/" : "/"
    this.dirs.delete(parent)
    this.bc?.postMessage({ type: "invalidate", path })
  }

  /** Update a single file in-place inside its parent DirVM, if cached. */
  upsertFile(file: FileVM): void {
    const parent = file.path.slice(0, file.path.lastIndexOf("/")) || "/"
    const entry = this.dirs.get(parent)
    if (!entry) return
    const idx = entry.data.files.findIndex(f => f.path === file.path)
    if (idx >= 0) entry.data.files[idx] = file
    else entry.data.files.push(file)
    entry.ts = Date.now(); entry.gen++
  }

  private put(path: string, data: DirVM) {
    const entry: DirEntry = { data, ts: Date.now(), gen: ++this.gen }
    this.dirs.set(path, entry)
    if (this.dirs.size > this.max) {
      // simple LRU-ish eviction: remove oldest ts
      let worstKey = "", worstTs = Infinity
      for (const [k, v] of this.dirs) if (v.ts < worstTs) { worstKey = k; worstTs = v.ts }
      if (worstKey) this.dirs.delete(worstKey)
    }
  }

  private async revalidate(path: string, oldGen: number) {
    try {
      const fresh = await remoteReadDir(path, false)
      // only apply if we didn't get replaced by a newer put()
      const current = this.dirs.get(path)
      if (!current || current.gen !== oldGen) return
      this.put(path, fresh)
    } catch {/* ignore background errors */}
  }
}
