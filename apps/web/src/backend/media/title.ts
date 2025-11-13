// src/backend/media/title.ts
import { getBaseUrl } from "../core/endpoints";
import { stream, unary } from "../core/rpc";

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

  if (fileVideosCache.has(safeFilePath)) return fileVideosCache.get(safeFilePath)!;

  const md = await meta();

  const rq = new titlepb.GetFileVideosRequest();
  rq.setFilepath(safeFilePath);
  rq.setIndexpath(safeIndexPath);

  const rsp = await unary(clientFactory, "getFileVideos", rq, undefined, md) as titlepb.GetFileVideosResponse;

  // generated API: rsp.getVideos() -> Videos message -> getVideosList()
  const videosContainer = rsp.getVideos?.();
  const list: titlepb.Video[] = videosContainer?.getVideosList?.() ?? [];

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

  const rsp = await unary(
    clientFactory,
    "getFileAudios",
    rq,
    undefined,
    md
  ) as titlepb.GetFileAudiosResponse;

  // rsp.getAudios() -> Audios message -> getAudiosList()
  const audiosContainer = rsp.getAudios?.();
  const list: titlepb.Audio[] = audiosContainer?.getAudiosList?.() ?? [];

  list.forEach(a => audiosCache.set(a.getId(), a));
  fileAudiosCache.set(safeFilePath, list);
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
    const url = `${base.replace(/\/$/, "")}/imdb_title?id=${encodeURIComponent(id)}`;
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
    return res.json();
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
export async function searchTitles(
  query: string,
  indexPath = DEFAULT_INDEXES.titles,
  fields: string[] = [],
  size = 100,
  offset = 0
): Promise<{
  summary?: titlepb.SearchSummary;
  facets?: titlepb.SearchFacets;
  hits: titlepb.SearchHit[];
}> {
  if (!query || query.trim().length === 0) {
    throw new Error("Query must be a non-empty string.");
  }

  const rq = new titlepb.SearchTitlesRequest();
  rq.setQuery(query);
  rq.setIndexpath(indexPath);
  rq.setSize(size);
  rq.setOffset(offset);
  if (fields?.length) rq.setFieldsList(fields);

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
        result.hits.push(rsp.getHit()!);
      }
    },
    SERVICE_NAME
  );

  return result;
}

// Todo Implement similar streaming searchVideos, searchAudios if needed
export async function getWatchingTitle(titleId: string): Promise<any> {

}
