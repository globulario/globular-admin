// src/backend/media/title.ts
import { getBaseUrl } from "../core/endpoints";
import { stream, unary } from "../core/rpc";
import { decodeJwtPayload } from "../core/session";

// ---- stubs ----
import { TitleServiceClient } from "globular-web-client/title/title_grpc_web_pb";
import * as titlepb from "globular-web-client/title/title_pb";

// --- add near other caches ---
const personsCache = new Map<string, titlepb.Person>();

// ---the service name constant---
const SERVICE_NAME = "title.TitleService";   // gRPC fully-qualified service name


/* =====================================================================================
 * Client + metadata
 * ===================================================================================== */

function clientFactory(): TitleServiceClient {
  const base = getBaseUrl() ?? "";
  return new TitleServiceClient(base, null, { withCredentials: true });
}

async function meta(): Promise<Record<string, string>> {
  try {
    const t = sessionStorage.getItem("__globular_token__");
    return t ? { token: t } : {};
  } catch {
    return {};
  }
}

/* =====================================================================================
 * Small in-memory caches
 * ===================================================================================== */

const videosCache = new Map<string, titlepb.Video>();
const audiosCache = new Map<string, titlepb.Audio>();
const titlesCache = new Map<string, titlepb.Title>();

// Per-file caches (lists)
const fileVideosCache = new Map<string, titlepb.Video[]>();
const fileAudiosCache = new Map<string, titlepb.Audio[]>();
const fileTitlesCache = new Map<string, titlepb.Title[]>();

// IMDb request-coalescing cache: id -> Promise<any>
const imdbPending = new Map<string, Promise<any>>();

function isRpcNotFoundError(err: any): boolean {
  if (!err) return false;
  const containsNoFile = String(err?.message || err?.grpcMessage || "")
    .toLowerCase()
    .includes("no file found");
  if (containsNoFile) return true;
  if (typeof err.code === "number" && err.code === 5) return true;
  const meta = err.metadata;
  const grpcStatus = typeof meta?.get === "function" ? meta.get("grpc-status") : meta?.["grpc-status"];
  const statusValue = Array.isArray(grpcStatus) ? grpcStatus[0] : grpcStatus;
  if (statusValue !== undefined && statusValue !== null) {
    return String(statusValue) === "5";
  }
  if (err?.status !== undefined) {
    const statusStr = String(err.status);
    if (statusStr === "5" || statusStr === "3") return true;
  }
  return false;
}

function isBadgerNotFoundError(err: any): boolean {
  if (!err) return false;
  const msg = String(err?.message || err?.grpcMessage || err || "").toLowerCase();
  return msg.includes("badger") && msg.includes("key") && msg.includes("not found");
}

/* =====================================================================================
 * Defaults
 * ===================================================================================== */

const DEFAULT_INDEXES = {
  titles: "/search/titles",
  videos: "/search/videos",
  audios: "/search/audios",
};

// --- add with other defaults (re-use titles index for people) ---
const DEFAULT_PERSONS_INDEX = DEFAULT_INDEXES.titles;
const TITLE_ID_PATTERN = /^tt\d+/i;
type WatchingContext = {
  token: string;
  username: string;
  domain: string;
};

function currentWatchingContext(): WatchingContext | null {
  try {
    const token = sessionStorage.getItem("__globular_token__");
    if (!token) return null;
    const payload = decodeJwtPayload(token);
    if (!payload) return null;

    const username =
      payload.username ||
      payload.preferred_username ||
      payload.name ||
      payload.sub ||
      payload.email ||
      "";

    if (!username) return null;

    const domain =
      payload.user_domain ||
      payload.domain ||
      (typeof payload.preferred_username === "string" &&
        payload.preferred_username.includes("@")
        ? payload.preferred_username.split("@")[1]
        : "") ||
      "";

    return {
      token,
      username,
      domain,
    };
  } catch {
    return null;
  }
}

/* =====================================================================================
 * Create + Associate APIs (kept from your original file)
 * ===================================================================================== */

/**
 * Create a Title then associate a file to it.
 */
export async function createTitleAndAssociate(
  filePath: string,
  title: titlepb.Title,
  indexPath = DEFAULT_INDEXES.titles
): Promise<void> {
  const md = await meta();

  // CreateTitle
  {
    const rq = new titlepb.CreateTitleRequest();
    rq.setTitle(title);
    rq.setIndexpath(indexPath);
    await unary(clientFactory, "createTitle", rq, undefined, md);
  }

  // Associate
  {
    const rq = new titlepb.AssociateFileWithTitleRequest();
    rq.setFilepath(filePath);
    rq.setTitleid(title.getId());
    rq.setIndexpath(indexPath);
    await unary(clientFactory, "associateFileWithTitle", rq, undefined, md);
  }

  // Bust per-file cache for titles
  fileTitlesCache.delete(filePath);
}

/**
 * Create a Video then associate a file to it.
 */
export async function createVideoAndAssociate(
  filePath: string,
  video: titlepb.Video,
  indexPath = DEFAULT_INDEXES.videos
): Promise<void> {
  const md = await meta();

  // CreateVideo
  {
    const rq = new titlepb.CreateVideoRequest();
    rq.setVideo(video);
    rq.setIndexpath(indexPath);
    await unary(clientFactory, "createVideo", rq, undefined, md);
  }

  // Associate
  {
    const rq = new titlepb.AssociateFileWithTitleRequest();
    rq.setFilepath(filePath);
    rq.setTitleid(video.getId());
    rq.setIndexpath(indexPath);
    await unary(clientFactory, "associateFileWithTitle", rq, undefined, md);
  }

  // caches
  videosCache.set(video.getId(), video);
  fileVideosCache.delete(filePath);
}

/* =====================================================================================
 * Lookups by ID
 * ===================================================================================== */

export async function getTitleInfo(
  id: string,
  indexPath = DEFAULT_INDEXES.titles
): Promise<titlepb.Title | undefined> {
  // cache-hit
  if (titlesCache.has(id)) return titlesCache.get(id)!;

  const md = await meta();
  const rq = new titlepb.GetTitleByIdRequest();
  rq.setTitleid(id);
  rq.setIndexpath(indexPath);

  const rsp = await unary(clientFactory, "getTitleById", rq, undefined, md) as titlepb.GetTitleByIdResponse;
  // Expect: rsp.getTitle()
  const title: titlepb.Title | undefined = rsp?.getTitle?.();
  if (title) titlesCache.set(id, title);
  return title;
}

export async function refreshTitleMetadata(
  titleId: string
): Promise<void> {
  if (!titleId) throw new Error("Missing title ID for refresh.");

  const base = getBaseUrl() ?? "";
  const url = `${base.replace(/\/$/, "")}//api/refresh-title?id=${encodeURIComponent(titleId)}`;
  const headers = await meta();
  const reqHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...(headers.token ? { token: headers.token, authorization: `Bearer ${headers.token}` } : {}),
  };

  const res = await fetch(url, {
    method: "POST",
    headers: reqHeaders,
    body: JSON.stringify({ id: titleId }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Refresh request failed (${res.status}): ${text ? text : res.statusText || ""}`
    );
  }
}

/**
 * Rebuild the Bleve indices for titles/videos/audios from the persisted KV store.
 * Optionally narrow the rebuild to specific collections, or run it incrementally.
 */
export async function rebuildTitleIndexFromStore(
  collections?: string[],
  incremental = false
): Promise<void> {
  const md = await meta();
  const rq = new titlepb.RebuildIndexRequest();
  if (collections && collections.length > 0) {
    rq.setCollectionsList(collections);
  }
  rq.setIncremental(!!incremental);

  await unary(clientFactory, "rebuildIndexFromStore", rq, undefined, md);

  // Clear caches so subsequent reads reflect the rebuilt indices.
  videosCache.clear();
  audiosCache.clear();
  titlesCache.clear();
  fileVideosCache.clear();
  fileAudiosCache.clear();
  fileTitlesCache.clear();
}

export async function getVideoInfo(
  id: string,
  indexPath = DEFAULT_INDEXES.videos
): Promise<titlepb.Video | undefined> {
  if (videosCache.has(id)) return videosCache.get(id)!;

  const md = await meta();
  const rq = new titlepb.GetVideoByIdRequest();
  rq.setVideoid(id);
  rq.setIndexpath(indexPath);

  const rsp = await unary(clientFactory, "getVideoById", rq, undefined, md) as titlepb.GetVideoByIdResponse;
  const video: titlepb.Video | undefined = rsp?.getVideo?.();
  if (video) videosCache.set(id, video);
  return video;
}

export async function getAudioInfo(
  id: string,
  indexPath = DEFAULT_INDEXES.audios
): Promise<titlepb.Audio | undefined> {
  if (audiosCache.has(id)) return audiosCache.get(id)!;

  const md = await meta();
  const rq = new titlepb.GetAudioByIdRequest();
  rq.setAudioid(id);
  rq.setIndexpath(indexPath);

  const rsp = await unary(clientFactory, "getAudioById", rq, undefined, md) as titlepb.GetAudioByIdResponse;
  const audio: titlepb.Audio | undefined = rsp?.getAudio?.();
  if (audio) audiosCache.set(id, audio);
  return audio;
}

/**
 * Create or update audio metadata in the search index.
 * Pass the audio proto (with setters already applied) and the target index path.
 *
 * Example indexPath: `${globule.config.DataPath}/search/audios`
 */
export async function createOrUpdateAudio(
  audio: titlepb.Audio,
  indexPath: string = DEFAULT_INDEXES.audios
): Promise<void> {
  const md = await meta();

  const rq = new titlepb.CreateAudioRequest();
  rq.setAudio(audio);
  rq.setIndexpath(indexPath);

  // RPC name follows existing naming convention in your codebase
  await unary(clientFactory, "createAudio", rq, undefined, md);
}

/* =====================================================================================
 * File-scoped lookups
 * ===================================================================================== */

export async function getFileTitlesInfo(
  filePath: string,
  indexPath = DEFAULT_INDEXES.titles
): Promise<titlepb.Title[]> {
  if (fileTitlesCache.has(filePath)) return fileTitlesCache.get(filePath)!;

  const md = await meta();
  const rq = new titlepb.GetFileTitlesRequest();
  rq.setFilepath(filePath);
  rq.setIndexpath(indexPath);

  const rsp = await unary(clientFactory, "getFileTitles", rq, undefined, md) as titlepb.GetFileTitlesResponse;
  // Expect: rsp.getTitles()?.getTitlesList()
  const titlesContainer = rsp?.getTitles?.();
  const list: titlepb.Title[] = titlesContainer?.getTitlesList?.() ?? [];

  // cache each by id and by file
  list.forEach((t) => titlesCache.set(t.getId(), t));
  fileTitlesCache.set(filePath, list);
  return list;
}

// title.ts (or wherever getFileVideosInfo lives)
export async function getFileVideosInfo(
  filePath: string,
  indexPath = DEFAULT_INDEXES.videos
): Promise<titlepb.Video[]> {
  // normalize + validate ASAP
  const normalize = (v: unknown, name: string): string => {
    if (v == null) throw new Error(`${name} is ${v}`);
    if (typeof v === "string") return v;
    // common “gotchas”: URL, Path-like objects, Buffers/Uint8Array, numbers
    if (v instanceof URL) return v.pathname || `${v}`;
    if (v instanceof Uint8Array) return new TextDecoder().decode(v);
    return String(v);
  };

  const safeFilePath = normalize(filePath, "filePath");
  const safeIndexPath = normalize(indexPath, "indexPath");

  //  if (fileVideosCache.has(safeFilePath)) return fileVideosCache.get(safeFilePath)!;

  const md = await meta();

  const rq = new titlepb.GetFileVideosRequest();
  rq.setFilepath(safeFilePath);
  rq.setIndexpath(safeIndexPath);

  let list: titlepb.Video[] = [];
  try {
    const rsp = await unary(clientFactory, "getFileVideos", rq, undefined, md) as titlepb.GetFileVideosResponse;
    // generated API: rsp.getVideos() -> Videos message -> getVideosList()
    const videosContainer = rsp.getVideos?.();
    list = videosContainer?.getVideosList?.() ?? [];
  } catch (err) {
    if (!isRpcNotFoundError(err)) {
      throw err;
    }
  }

  list.forEach(v => videosCache.set(v.getId(), v));
  fileVideosCache.set(safeFilePath, list);
  return list;
}

export async function getFileAudiosInfo(
  filePath: string,
  indexPath = DEFAULT_INDEXES.audios
): Promise<titlepb.Audio[]> {
  // normalize + validate (same helper logic as videos)
  const normalize = (v: unknown, name: string): string => {
    if (v == null) throw new Error(`${name} is ${v}`);
    if (typeof v === "string") return v;
    if (v instanceof URL) return v.pathname || `${v}`;
    if (v instanceof Uint8Array) return new TextDecoder().decode(v);
    return String(v);
  };

  const safeFilePath = normalize(filePath, "filePath");
  const safeIndexPath = normalize(indexPath, "indexPath");

  if (fileAudiosCache.has(safeFilePath)) return fileAudiosCache.get(safeFilePath)!;

  const md = await meta();

  const rq = new titlepb.GetFileAudiosRequest();
  rq.setFilepath(safeFilePath);
  rq.setIndexpath(safeIndexPath);

  let list: titlepb.Audio[] = [];
  try {
    const rsp = await unary(
      clientFactory,
      "getFileAudios",
      rq,
      undefined,
      md
    ) as titlepb.GetFileAudiosResponse;

    // rsp.getAudios() -> Audios message -> getAudiosList()
    const audiosContainer = rsp.getAudios?.();
    list = audiosContainer?.getAudiosList?.() ?? [];
  } catch (err) {
    if (!isRpcNotFoundError(err)) {
      throw err;
    }
  }

  console.log("Fetched audios for file:", safeIndexPath, safeFilePath, "Count:", list.length);
  list.forEach(a => audiosCache.set(a.getId(), a));
  fileAudiosCache.set(safeFilePath, list);

  if (!list.length && !safeFilePath.includes("/.hidden/")) {
    const lastSlash = safeFilePath.lastIndexOf("/");
    if (lastSlash > -1) {
      const hiddenPath = `${safeFilePath.substring(0, lastSlash)}/.hidden${safeFilePath.substring(lastSlash)}`;
      const hiddenList = await getFileAudiosInfo(hiddenPath, safeIndexPath).catch(() => []);
      if (hiddenList.length) {
        fileAudiosCache.set(safeFilePath, hiddenList);
        return hiddenList;
      }
    }
  }

  return list;
}

/* =====================================================================================
 * Title -> files
 * ===================================================================================== */

export async function getTitleFiles(
  titleId: string,
  indexPath = DEFAULT_INDEXES.titles
): Promise<string[]> {
  const md = await meta();
  const rq = new titlepb.GetTitleFilesRequest();
  rq.setTitleid(titleId);
  rq.setIndexpath(indexPath);

  const rsp = await unary(clientFactory, "getTitleFiles", rq, undefined, md) as titlepb.GetTitleFilesResponse;
  // Expect: rsp.getFilepathsList()
  return rsp?.getFilepathsList?.() ?? [];
}

/* =====================================================================================
 * IMDb helper with request coalescing
 * ===================================================================================== */

/**
 * Fetch IMDb info for a given external title id.
 * This calls the backend HTTP endpoint: GET `${base}/imdb_title?id=...`
 * and reuses any in-flight request for the same id.
 */
export async function getImdbInfo(id: string): Promise<any> {
  if (!id) throw new Error("Missing IMDb id");

  if (imdbPending.has(id)) return imdbPending.get(id)!;

  const pending = (async () => {
    const base = getBaseUrl() ?? "";
    const url = `${base.replace(/\/$/, "")}//api/get-imdb-titles?q=${encodeURIComponent(id)}`;
    const headers = await meta();

    const res = await fetch(url, {
      method: "GET",
      headers: {
        ...(headers.token ? { token: headers.token } : {}),
      },
    });

    if (!res.ok) {
      throw new Error(`IMDb HTTP ${res.status} fetching ${url}`);
    }

    let data = await res.json();
    let results = data.results;
    if (results && results.length > 0) {
      return results[0];
    }
    return null;
  })()
    .finally(() => {
      // Ensure we drop the pending entry regardless of success/failure
      imdbPending.delete(id);
    });

  imdbPending.set(id, pending);
  return pending;
}

/* =====================================================================================
 * Optional cache setters (useful if some other flow creates/updates entries)
 * ===================================================================================== */

export function cacheSetTitle(t: titlepb.Title) {
  titlesCache.set(t.getId(), t);
}
export function cacheSetVideo(v: titlepb.Video) {
  videosCache.set(v.getId(), v);
}
export function cacheSetAudio(a: titlepb.Audio) {
  audiosCache.set(a.getId(), a);
}

/* =====================================================================================
 * Optional cache invalidators (call after mutations elsewhere)
 * ===================================================================================== */

export function invalidateFileCaches(filePath: string) {
  fileTitlesCache.delete(filePath);
  fileVideosCache.delete(filePath);
  fileAudiosCache.delete(filePath);
}

export function clearAllTitleCaches() {
  titlesCache.clear();
  videosCache.clear();
  audiosCache.clear();
  fileTitlesCache.clear();
  fileVideosCache.clear();
  fileAudiosCache.clear();
  imdbPending.clear();
}

export function invalidateTitleCache(titleId: string) {
  if (titleId) titlesCache.delete(titleId);
}

/* =====================================================================================
 * Cache utilities (local)
 * ===================================================================================== */

function pruneListCache<T>(
  map: Map<string, T[]>,
  idSelector: (x: T) => string,
  id: string
) {
  for (const [k, arr] of map) {
    const next = arr.filter((v) => idSelector(v) !== id);
    if (next.length !== arr.length) map.set(k, next);
  }
}

function replaceInListCache<T>(
  map: Map<string, T[]>,
  idSelector: (x: T) => string,
  nextValue: T
) {
  const id = idSelector(nextValue);
  for (const [k, arr] of map) {
    const idx = arr.findIndex((v) => idSelector(v) === id);
    if (idx >= 0) {
      const copy = arr.slice();
      copy[idx] = nextValue;
      map.set(k, copy);
    }
  }
}

/* =====================================================================================
 * Deletes
 * ===================================================================================== */

export async function deleteAudio(
  audioId: string,
  indexPath = DEFAULT_INDEXES.audios
): Promise<void> {
  const md = await meta();
  const rq = new titlepb.DeleteAudioRequest();
  rq.setAudioid(audioId);
  rq.setIndexpath(indexPath);

  await unary(clientFactory, "deleteAudio", rq, undefined, md);

  // prune caches
  audiosCache.delete(audioId);
  pruneListCache(fileAudiosCache, (a) => a.getId(), audioId);
}

export async function deleteVideo(
  videoId: string,
  indexPath = DEFAULT_INDEXES.videos
): Promise<void> {
  const md = await meta();
  const rq = new titlepb.DeleteVideoRequest();
  rq.setVideoid(videoId);
  rq.setIndexpath(indexPath);

  await unary(clientFactory, "deleteVideo", rq, undefined, md);

  // prune caches
  videosCache.delete(videoId);
  pruneListCache(fileVideosCache, (v) => v.getId(), videoId);
}

export async function deleteTitle(
  titleId: string,
  indexPath = DEFAULT_INDEXES.titles
): Promise<void> {
  const md = await meta();
  const rq = new titlepb.DeleteTitleRequest();
  rq.setTitleid(titleId);
  rq.setIndexpath(indexPath);

  await unary(clientFactory, "deleteTitle", rq, undefined, md);

  // prune caches
  titlesCache.delete(titleId);
  // Also remove from any per-file title lists
  pruneListCache(fileTitlesCache, (t) => t.getId(), titleId);
}

export async function deleteAlbum(
  albumId: string,
  indexPath = DEFAULT_INDEXES.audios
): Promise<void> {
  const md = await meta();
  const rq = new titlepb.DeleteAlbumRequest();
  rq.setAlbumid(albumId);
  rq.setIndexpath(indexPath);

  await unary(clientFactory, "deleteAlbum", rq, undefined, md);
  // No dedicated album cache here; nothing to clear.
}

/* =====================================================================================
 * Updates (metadata)
 * ===================================================================================== */

export async function updateVideoMetadata(
  video: titlepb.Video,
  indexPath = DEFAULT_INDEXES.videos
): Promise<void> {
  const md = await meta();
  const rq = new titlepb.UpdateVideoMetadataRequest();
  rq.setVideo(video);
  rq.setIndexpath(indexPath);

  await unary(clientFactory, "updateVideoMetadata", rq, undefined, md);

  // refresh caches
  videosCache.set(video.getId(), video);
  replaceInListCache(fileVideosCache, (v) => v.getId(), video);
}

export async function updateTitleMetadata(
  title: titlepb.Title,
  indexPath = DEFAULT_INDEXES.titles
): Promise<void> {
  const md = await meta();
  const rq = new titlepb.UpdateTitleMetadataRequest();
  rq.setTitle(title);
  rq.setIndexpath(indexPath);

  await unary(clientFactory, "updateTitleMetadata", rq, undefined, md);

  // refresh caches
  titlesCache.set(title.getId(), title);
  replaceInListCache(fileTitlesCache, (t) => t.getId(), title);
}

/* =====================================================================================
 * Associations
 * ===================================================================================== */

export async function associateFileWithTitle(
  filePath: string,
  titleId: string,
  indexPath = DEFAULT_INDEXES.titles
): Promise<void> {
  const md = await meta();
  const rq = new titlepb.AssociateFileWithTitleRequest();
  rq.setFilepath(filePath);
  rq.setTitleid(titleId);
  rq.setIndexpath(indexPath);

  await unary(clientFactory, "associateFileWithTitle", rq, undefined, md);

  // file->titles list is now stale
  fileTitlesCache.delete(filePath);
}

export async function dissociateFileWithTitle(
  filePath: string,
  titleId: string,
  indexPath = DEFAULT_INDEXES.titles
): Promise<void> {
  const md = await meta();
  const rq = new titlepb.DissociateFileWithTitleRequest();
  rq.setFilepath(filePath);
  rq.setTitleid(titleId);
  rq.setIndexpath(indexPath);

  await unary(clientFactory, "dissociateFileWithTitle", rq, undefined, md);

  // update per-file cache if present
  if (fileTitlesCache.has(filePath)) {
    const list = fileTitlesCache.get(filePath) || [];
    fileTitlesCache.set(filePath, list.filter((t) => t.getId() !== titleId));
  }
}

// ---------------------------------------------
// Person helpers
// ---------------------------------------------
export async function getPersonInfo(
  id: string,
  indexPath = DEFAULT_PERSONS_INDEX
): Promise<titlepb.Person | undefined> {
  if (personsCache.has(id)) return personsCache.get(id)!;

  const md = await meta();
  const rq = new titlepb.GetPersonByIdRequest();
  rq.setPersonid(id);
  rq.setIndexpath(indexPath);

  const rsp = await unary(clientFactory, "getPersonById", rq, undefined, md) as titlepb.GetPersonByIdResponse;
  const person: titlepb.Person | undefined = rsp?.getPerson?.();
  if (person) personsCache.set(id, person);
  return person;
}

export async function createOrUpdatePerson(
  person: titlepb.Person,
  indexPath = DEFAULT_PERSONS_INDEX
): Promise<void> {
  const md = await meta();
  const rq = new titlepb.CreatePersonRequest();
  rq.setPerson(person);
  rq.setIndexpath(indexPath);
  await unary(clientFactory, "createPerson", rq, undefined, md);
  personsCache.set(person.getId(), person);
}

export async function deletePerson(
  personId: string,
  indexPath = DEFAULT_PERSONS_INDEX
): Promise<void> {
  const md = await meta();
  const rq = new titlepb.DeletePersonRequest();
  rq.setPersonid(personId);
  rq.setIndexpath(indexPath);
  await unary(clientFactory, "deletePerson", rq, undefined, md);
  personsCache.delete(personId);
}

export function cacheSetPerson(p: titlepb.Person) {
  personsCache.set(p.getId(), p);
}


/**
 * Search for persons matching a query.
 * Streams results via TitleService.SearchPersons.
 */
export async function searchPersons(
  query: string,
  indexPath: string
): Promise<titlepb.Person[]> {
  if (!query || query.length < 2) {
    throw new Error("Query must be at least 2 characters long.");
  }

  const rq = new titlepb.SearchPersonsRequest();
  rq.setQuery(query);
  rq.setIndexpath(indexPath);
  rq.setOffset(0);
  rq.setSize(1000);

  const persons: titlepb.Person[] = [];

  try {
    await stream(
      // Your existing factory that builds a TitleService client from a resolved address
      clientFactory,                // e.g., (addr) => new TitleServiceClient(addr, null, opts)
      "searchPersons",              // RPC name
      rq,                           // SearchPersonsRequest
      (rsp: titlepb.SearchPersonsResponse) => {
        if (rsp.hasHit()) {
          const hit = rsp.getHit();
          const person = hit?.getPerson();
          if (person) persons.push(person);
        }
      },
      SERVICE_NAME                  // "title.TitleService"
      // , { base: 'https://my-gateway' } // optional override if you use one
    );
  } catch (err: any) {
    throw err;
  }

  // De-dupe by id and sort by fullname (like your previous implementation)
  const uniquePersons = [...new Map(persons.map(p => [p.getId(), p])).values()];
  uniquePersons.sort((a, b) => a.getFullname().localeCompare(b.getFullname()));

  return uniquePersons;
}

// ---------------------------------------------
// Small quality-of-life upserts for Title/Video
// (your proto treats Create* as insert-or-update)
// ---------------------------------------------
export async function createOrUpdateTitle(
  t: titlepb.Title,
  indexPath = DEFAULT_INDEXES.titles
): Promise<void> {
  const md = await meta();
  const rq = new titlepb.CreateTitleRequest();
  rq.setTitle(t);
  rq.setIndexpath(indexPath);
  await unary(clientFactory, "createTitle", rq, undefined, md);
  titlesCache.set(t.getId(), t);
}

export async function createOrUpdateVideo(
  v: titlepb.Video,
  indexPath = DEFAULT_INDEXES.videos
): Promise<void> {
  const md = await meta();
  const rq = new titlepb.CreateVideoRequest();
  rq.setVideo(v);
  rq.setIndexpath(indexPath);
  await unary(clientFactory, "createVideo", rq, undefined, md);
  videosCache.set(v.getId(), v);
}


// STREAMING search over titles/videos/audios/persons
type SearchTitlesOptions = {
  query: string;
  indexPath?: string;
  fields?: string[];
  size?: number;
  offset?: number;
};

export async function searchTitles(
  input: string | SearchTitlesOptions,
  onMessage?: (rsp: titlepb.SearchTitlesResponse) => void,
  onEnd?: () => void,
  onError?: (err: any) => void
): Promise<{
  summary?: titlepb.SearchSummary;
  facets?: titlepb.SearchFacets;
  hits: titlepb.SearchHit[];
} | void> {
  const opts: SearchTitlesOptions =
    typeof input === "string"
      ? { query: input }
      : input || { query: "" };

  const query = typeof opts.query === "string" ? opts.query : "";
  const indexPath = opts.indexPath ?? DEFAULT_INDEXES.titles;
  const fields = opts.fields ?? [];
  const size = typeof opts.size === "number" ? opts.size : 100;
  const offset = typeof opts.offset === "number" ? opts.offset : 0;

  if (!query || typeof query !== "string" || query.trim().length === 0) {
    throw new Error("Query must be a non-empty string.");
  }

  const rq = new titlepb.SearchTitlesRequest();
  rq.setQuery(query);
  rq.setIndexpath(indexPath);
  rq.setSize(size);
  rq.setOffset(offset);
  if (fields.length) rq.setFieldsList(fields);

  // Streaming mode for callbacks (legacy behavior)
  if (typeof onMessage === "function") {
    try {
      await stream(
        clientFactory,
        "searchTitles",
        rq,
        (rsp: titlepb.SearchTitlesResponse) => onMessage?.(rsp),
        SERVICE_NAME
      );
      onEnd?.();
    } catch (err) {
      onError?.(err);
      throw err;
    }
    return;
  }

  // Collector mode (no callbacks provided)
  const result: {
    summary?: titlepb.SearchSummary;
    facets?: titlepb.SearchFacets;
    hits: titlepb.SearchHit[];
  } = { hits: [] };

  await stream(
    clientFactory,
    "searchTitles",
    rq,
    (rsp: titlepb.SearchTitlesResponse) => {
      if (rsp.hasSummary && rsp.hasSummary()) {
        result.summary = rsp.getSummary()!;
      } else if (rsp.hasFacets && rsp.hasFacets()) {
        result.facets = rsp.getFacets()!;
      } else if (rsp.hasHit && rsp.hasHit()) {
        console.log("Received hit:", rsp.getHit());
        result.hits.push(rsp.getHit()!);
      }
    },
    SERVICE_NAME
  );

  return result;
}

// Todo Implement similar streaming searchVideos, searchAudios if needed
function inferMediaType(entry: any): "video" | "audio" | "title" {
  const id = entry?.titleId || entry?.title_id || entry?._id || entry?.id || "";
  const looksLikeTitle = TITLE_ID_PATTERN.test(String(id || "").toLowerCase());
  const hint =
    typeof entry?.mediaType === "string"
      ? entry.mediaType.toLowerCase()
      : typeof entry?.type === "string"
        ? entry.type.toLowerCase()
        : typeof entry?.kind === "string"
          ? entry.kind.toLowerCase()
          : "";

  if (hint === "title") return "title";
  if (hint === "audio" || entry?.isAudio === true) return "audio";
  if (hint === "video") return looksLikeTitle ? "title" : "video";
  if (["movie", "film", "episode", "series"].includes(hint)) return "title";

  if (entry?.isVideo === false) return "audio";
  if (entry?.isVideo === true && !looksLikeTitle) return "video";

  if (typeof entry?.mimeType === "string") {
    const m = entry.mimeType.toLowerCase();
    if (m.startsWith("audio/")) return "audio";
    if (m.startsWith("video/")) return looksLikeTitle ? "title" : "video";
  }

  if (entry?.album || entry?.artist || entry?.track || entry?.trackNumber != null) {
    return "audio";
  }

  if (looksLikeTitle) return "title";
  return "video";
}

function watchingEntryToPlain(entry?: titlepb.WatchingEntry | null) {
  if (!entry) return undefined;
  const rawId = entry.getId?.() || "";
  const rawTitleId = entry.getTitleId?.() || rawId;
  const positionMs = typeof entry.getPositionMs === "function" ? entry.getPositionMs() : 0;
  const durationMs = typeof entry.getDurationMs === "function" ? entry.getDurationMs() : 0;
  const updatedAt = entry.getUpdatedAt?.() || "";
  const id = rawTitleId || rawId.split(":").at(-1) || rawId;

  return {
    _id: id,
    id: rawId || id,
    titleId: rawTitleId || id,
    title_id: rawTitleId || id,
    userId: entry.getUserId?.() || "",
    domain: entry.getDomain?.() || "",
    mediaType: entry.getMediaType?.() || "",
    position_ms: positionMs,
    duration_ms: durationMs,
    currentTime: positionMs ? positionMs / 1000 : 0,
    date: updatedAt,
    updated_at: updatedAt,
  };
}

export async function getWatchingTitles(): Promise<any[]> {
  const ctx = currentWatchingContext();
  if (!ctx) return [];

  try {
    const md = await meta();
    const rq = new titlepb.ListWatchingRequest();
    const rsp = await unary(clientFactory, "listWatching", rq, undefined, md) as titlepb.ListWatchingResponse;
    const items = rsp?.getItemsList?.() ?? [];
    return items.map((entry) => watchingEntryToPlain(entry)).filter((entry): entry is ReturnType<typeof watchingEntryToPlain> => !!entry);
  } catch (err: any) {
    console.error("Failed to fetch watching titles:", err);
    throw err;
  }
}

export async function getWatchingTitle(
  titleId: string,
  onSuccess?: (entry: any | undefined) => void,
  onError?: (err: any) => void
): Promise<any | undefined> {
  if (!titleId) {
    const err = new Error("Missing title identifier.");
    if (onError) onError(err);
    throw err;
  }

  try {
    const ctx = currentWatchingContext();
    if (!ctx) {
      const err = new Error("Not authenticated.");
      if (onError) onError(err);
      throw err;
    }

    const md = await meta();
    const rq = new titlepb.GetWatchingRequest();
    rq.setTitleId(titleId);
    const entry = await unary(clientFactory, "getWatching", rq, undefined, md) as titlepb.WatchingEntry;
    const plain = watchingEntryToPlain(entry);
    if (onSuccess) onSuccess(plain);
    return plain;
  } catch (err) {
    if (isBadgerNotFoundError(err) || isRpcNotFoundError(err)) {
      if (onSuccess) onSuccess(undefined);
      return undefined;
    }
    if (onError) onError(err);
    throw err;
  }
}

export async function removeWatchingTitle(title: { _id?: string } | string): Promise<void> {
  const ctx = currentWatchingContext();
  if (!ctx) throw new Error("Not authenticated.");

  const id = typeof title === "string" ? title : title?._id;
  if (!id) throw new Error("Missing watching title identifier.");

  const md = await meta();
  const rq = new titlepb.RemoveWatchingRequest();
  rq.setTitleId(id);
  await unary(clientFactory, "removeWatching", rq, undefined, md);
}

export async function saveWatchingTitle(entry: any): Promise<void> {
  const ctx = currentWatchingContext();
  if (!ctx) throw new Error("Not authenticated.");

  if (!entry || (!entry._id && !entry.titleId && !entry.title_id && !entry.id)) {
    throw new Error("Missing title identifier.");
  }

  const md = await meta();
  const watchingEntry = new titlepb.WatchingEntry();

  const titleId = entry.titleId || entry.title_id || entry.id || entry._id;
  if (!titleId) {
    throw new Error("Unable to determine titleId for watching entry.");
  }

  const entryId = `${ctx.username}:${titleId}`;

  watchingEntry.setId(entryId);
  watchingEntry.setTitleId(titleId);
  watchingEntry.setUserId(ctx.username);
  watchingEntry.setDomain(entry.domain || ctx.domain || "");

  const currentTimeSec = typeof entry.currentTime === "number" ? entry.currentTime : 0;
  const positionMs =
    typeof entry.position_ms === "number" ? entry.position_ms : Math.round(Math.max(0, currentTimeSec) * 1000);
  watchingEntry.setPositionMs(positionMs);

  if (typeof entry.duration_ms === "number") {
    watchingEntry.setDurationMs(entry.duration_ms);
  } else if (typeof entry.duration === "number") {
    watchingEntry.setDurationMs(Math.round(entry.duration * 1000));
  }

  const mediaType = inferMediaType(entry);
  watchingEntry.setMediaType(mediaType);

  const updatedAt =
    typeof entry.date === "string" && entry.date
      ? new Date(entry.date).toISOString()
      : new Date().toISOString();
  watchingEntry.setUpdatedAt(updatedAt);

  const rq = new titlepb.SaveWatchingRequest();
  rq.setEntry(watchingEntry);
  await unary(clientFactory, "saveWatching", rq, undefined, md);
}
