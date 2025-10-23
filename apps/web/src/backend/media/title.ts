// src/backend/title.ts
import { getBaseUrl } from "../core/endpoints";
import { unary } from "../core/rpc";

// ---- stubs ----
import { TitleServiceClient } from "globular-web-client/title/title_grpc_web_pb";
import * as titlepb from "globular-web-client/title/title_pb";

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

export async function getFileVideosInfo(
  filePath: string,
  indexPath = DEFAULT_INDEXES.videos
): Promise<titlepb.Video[]> {
  if (fileVideosCache.has(filePath)) return fileVideosCache.get(filePath)!;

  const md = await meta();
  const rq = new titlepb.GetFileVideosRequest();
  rq.setFilepath(filePath);
  rq.setIndexpath(indexPath);

  const rsp = await unary(clientFactory, "getFileVideos", rq, undefined, md) as titlepb.GetFileVideosResponse;
  // Expect: rsp.getVideos()?.getVideosList()
  const videosContainer = rsp?.getVideos?.();
  const list: titlepb.Video[] = videosContainer?.getVideosList?.() ?? [];

  list.forEach((v) => videosCache.set(v.getId(), v));
  fileVideosCache.set(filePath, list);
  return list;
}

export async function getFileAudiosInfo(
  filePath: string,
  indexPath = DEFAULT_INDEXES.audios
): Promise<titlepb.Audio[]> {
  if (fileAudiosCache.has(filePath)) return fileAudiosCache.get(filePath)!;

  const md = await meta();
  const rq = new titlepb.GetFileAudiosRequest();
  rq.setFilepath(filePath);
  rq.setIndexpath(indexPath);

  const rsp = await unary(clientFactory, "getFileAudios", rq, undefined, md) as titlepb.GetFileAudiosResponse;
  // Expect: rsp.getAudios()?.getAudiosList()
  const audiosContainer = rsp?.getAudios?.();
  const list: titlepb.Audio[] = audiosContainer?.getAudiosList?.() ?? [];

  list.forEach((a) => audiosCache.set(a.getId(), a));
  fileAudiosCache.set(filePath, list);
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
