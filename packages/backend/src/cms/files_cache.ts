// files_cache.ts
// A simple cache for directory listings keyed by absolute path (+ includeHidden).
// Stores a FileVM representing the directory; its .files contains children.
// Uses an injected raw fetcher (readDirFresh) to avoid recursion.

import type { FileVM } from "./files";

export type ReadDirFetcher = (path: string, includeHidden?: boolean) => Promise<FileVM>;

type DirEntry = {
  data: FileVM;   // directory node with .files
  ts: number;     // cached at
  gen: number;    // monotonic generation
};

type Options = {
  max?: number;
  ttlMs?: number;
  multiTab?: boolean;
  fetcher: ReadDirFetcher; // REQUIRED to avoid recursive cache calls
};

function keyOf(path: string, includeHidden: boolean): string {
  return `${path}::hidden=${includeHidden ? 1 : 0}`;
}

export class FilesCache {
  private dirs = new Map<string, DirEntry>();
  private inflight = new Map<string, Promise<FileVM>>();
  private max = 200;
  private ttlMs = 15000;
  private gen = 0;
  private bc?: BroadcastChannel;
  private fetcher: ReadDirFetcher;

  constructor(opts: Options) {
    if (!opts || typeof opts.fetcher !== "function") {
      throw new Error("FilesCache requires a fetcher(path) function (e.g., readDirFresh).");
    }
    this.fetcher = opts.fetcher;
    if (opts.max) this.max = opts.max;
    if (opts.ttlMs) this.ttlMs = opts.ttlMs;
    if (opts.multiTab) {
      this.bc = new BroadcastChannel("files-cache");
      this.bc.onmessage = (e) => {
        const { type, path } = e.data || {};
        if (type === "invalidate" && typeof path === "string") this.invalidate(path);
      };
    }
  }

  /** Get a directory node from cache; if stale/absent and swr, fetch fresh. */
  async getDir(path: string, swr = true, includeHidden = false): Promise<FileVM> {
    const k = keyOf(path, includeHidden);
    const now = Date.now();
    const cached = this.dirs.get(k);
    const fresh = cached && (now - cached.ts) < this.ttlMs;

    if (fresh) return cached!.data;

    // serve stale while refreshing
    if (cached && swr) {
      void this.revalidate(path, includeHidden, cached.gen);
      return cached.data;
    }

    // no cache or SWR disabled → fetch now via raw fetcher
    return this.fetchDir(path, includeHidden);
  }

  /** Force fetch (no cache short-circuit). */
  async fetchDir(path: string, includeHidden = false): Promise<FileVM> {
    const k = keyOf(path, includeHidden);
    const existing = this.inflight.get(k);
    if (existing) return existing;

    const p = (async () => {
      const dirNode = await this.fetcher(path, includeHidden);
      this.put(k, dirNode);
      return dirNode;
    })();

    this.inflight.set(k, p);
    try { return await p; } finally { this.inflight.delete(k); }
  }

  /** Mark a directory and its parent stale after mutations. */
  invalidate(path: string): void {
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) || "/" : "/";
    for (const k of [...this.dirs.keys()]) {
      if (k.startsWith(path + "::") || k.startsWith(parent + "::")) {
        this.dirs.delete(k);
      }
    }
    this.bc?.postMessage({ type: "invalidate", path });
  }

  /** Update a single file in-place inside its parent directory, if cached. */
  upsertFile(file: FileVM): void {
    const parent = file.path.slice(0, file.path.lastIndexOf("/")) || "/";
    for (const k of [keyOf(parent, false), keyOf(parent, true)]) {
      const entry = this.dirs.get(k);
      if (!entry) continue;

      const list = Array.isArray(entry.data.files) ? entry.data.files : (entry.data.files = []);
      const idx = list.findIndex(f => f.path === file.path);
      if (idx >= 0) list[idx] = file;
      else list.push(file);

      entry.ts = Date.now();
      entry.gen++;
    }
  }

  // ----------------- internal -----------------

  private put(k: string, data: FileVM) {
    const entry: DirEntry = { data, ts: Date.now(), gen: ++this.gen };
    this.dirs.set(k, entry);
    if (this.dirs.size > this.max) {
      let worstKey = "", worstTs = Infinity;
      for (const [kk, v] of this.dirs) if (v.ts < worstTs) { worstKey = kk; worstTs = v.ts; }
      if (worstKey) this.dirs.delete(worstKey);
    }
  }

  private async revalidate(path: string, includeHidden: boolean, oldGen: number) {
    try {
      const k = keyOf(path, includeHidden);
      const fresh = await this.fetcher(path, includeHidden);
      const current = this.dirs.get(k);
      if (!current || current.gen !== oldGen) return;
      this.put(k, fresh);
    } catch {
      // ignore background errors
    }
  }
}
