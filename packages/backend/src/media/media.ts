// src/backend/media.ts
import { getBaseUrl } from "../core/endpoints";
import { unary, stream } from "../core/rpc";

// ---- stubs ----
import { MediaServiceClient } from "globular-web-client/media/media_grpc_web_pb";
import * as mediapb from "globular-web-client/media/media_pb";
export type MediaFilePB = mediapb.MediaFile;

// keep this identical to accounts.ts
function clientFactory(): MediaServiceClient {
  const base = getBaseUrl() ?? "";
  return new MediaServiceClient(base, null, { withCredentials: true });
}

async function meta(): Promise<Record<string, string>> {
  try {
    const t = sessionStorage.getItem("__globular_token__");
    return t ? { token: t } : {};
  } catch {
    return {};
  }
}

function pickMethod(c: any, names: readonly string[]): string {
  for (const n of names) if (typeof c[n] === "function") return n;
  return names[0];
}
function newRq(names: readonly string[]): any {
  for (const n of names) {
    const Ctor: any = (mediapb as any)[n];
    if (typeof Ctor === "function") return new Ctor();
  }
  return {};
}

/* ------------------------------ API ------------------------------ */

export async function convertVideoToMpeg4H264(absPath: string): Promise<void> {
  const md = await meta();
  const rq = new mediapb.ConvertVideoToMpeg4H264Request();
  rq.setPath(absPath);
  await unary(clientFactory, "convertVideoToMpeg4H264", rq, undefined, md);
}

export async function convertVideoToHls(absPath: string): Promise<void> {
  const md = await meta();
  const rq = new mediapb.ConvertVideoToHlsRequest();
  rq.setPath(absPath);
  await unary(clientFactory, "convertVideoToHls", rq, undefined, md);
}

export async function createVideoTimeLine(absPath: string, width = 180, fps = 0.2): Promise<void> {
  const md = await meta();
  const rq = new mediapb.CreateVideoTimeLineRequest();
  rq.setPath(absPath);
  rq.setWidth(width);
  rq.setFps(fps);
  await unary(clientFactory, "createVideoTimeLine", rq, undefined, md);
}

export async function createVideoPreview(absPath: string, height = 128, nb = 20): Promise<void> {
  const md = await meta();
  const rq = new mediapb.CreateVideoPreviewRequest();
  rq.setPath(absPath);
  rq.setHeight(height);
  rq.setNb(nb);
  await unary(clientFactory, "createVideoPreview", rq, undefined, md);
}

export async function startProcessVideo(absPath: string): Promise<void> {
  const md = await meta();
  const rq = new mediapb.StartProcessVideoRequest();
  rq.setPath(absPath);
  await unary(clientFactory, "startProcessVideo", rq, undefined, md);
}

export async function startProcessAudio(absPath: string): Promise<void> {
  const md = await meta();
  const rq = new mediapb.StartProcessAudioRequest();
  rq.setPath(absPath);
  await unary(clientFactory, "startProcessAudio", rq, undefined, md);
}

/** Server-side fetch-then-upload by URL (progress over stream). */
export async function uploadVideoByUrl(
  destDir: string,
  url: string,
  format: "mp4" | "mp3",
  onMsg?: (m: mediapb.UploadVideoResponse) => void
): Promise<void> {
  const md = await meta();
  const rq = new mediapb.UploadVideoRequest();
  rq.setDest(destDir);
  rq.setUrl(url);
  rq.setFormat(format);

  const msgHandler = typeof onMsg === "function" ? onMsg : () => {};

  await stream(clientFactory, "uploadVideo", rq, (m: any) => {
    msgHandler(m as mediapb.UploadVideoResponse);
  }, "media.MediaService", md);
}

// -------- Media files listing (for metadata/process candidates) --------

/** Stream all media files (audio/video) relative to /files root. */
export async function listMediaFiles(
  onFile: (f: mediapb.MediaFile) => void,
  onComplete?: () => void
): Promise<void> {
  const rq = new mediapb.ListMediaFilesRequest();
  await stream(
    clientFactory,
    "listMediaFiles",
    rq,
    (m: any) => {
      if (m && typeof onFile === "function") onFile(m as mediapb.MediaFile);
    },
    "media.MediaService"
  );
  if (typeof onComplete === "function") onComplete();
}

// -------------------------- Channel sync ---------------------------

export async function syncChannelFromPlaylist(playlistJson: string): Promise<mediapb.Channel | null> {
  const md = await meta();
  const rq = new mediapb.SyncChannelFromPlaylistRequest();
  rq.setPlaylistJson(playlistJson);
  const rsp: any = await unary(clientFactory, "syncChannelFromPlaylist", rq, undefined, md);
  return (rsp && typeof rsp.getChannel === "function") ? rsp.getChannel() : null;
}

export async function getChannel(id: string, path?: string): Promise<mediapb.Channel | null> {
  const md = await meta();
  const rq = new mediapb.GetChannelRequest();
  rq.setId(id);
  if (path) rq.setPath(path);
  const rsp: any = await unary(clientFactory, "getChannel", rq, undefined, md);
  return (rsp && typeof rsp.getChannel === "function") ? rsp.getChannel() : null;
}

export async function listChannels(path?: string, extractor?: string): Promise<mediapb.Channel[]> {
  const md = await meta();
  const rq = new mediapb.ListChannelsRequest();
  if (path) rq.setPath(path);
  if (extractor) rq.setExtractor(extractor);
  const rsp: any = await unary(clientFactory, "listChannels", rq, undefined, md);
  if (rsp && typeof rsp.getChannelsList === "function") {
    return rsp.getChannelsList();
  }
  return [];
}

// ----------------------- Video worker (global) -----------------------

/** Start the background video processing worker (no specific path). */
export async function startVideoWorker(): Promise<void> {
  const md = await meta();
  const rq = new mediapb.StartProcessVideoRequest();
  await unary(clientFactory, "startProcessVideo", rq, undefined, md);
}

/** Stop the background video processing worker. */
export async function stopVideoWorker(): Promise<void> {
  const md = await meta();
  const rq = new mediapb.StopProcessVideoRequest();
  await unary(clientFactory, "stopProcessVideo", rq, undefined, md);
}

/** Check if the background video processing worker is running. */
export async function isVideoProcessingRunning(): Promise<boolean> {
  const md = await meta();
  const rq = new mediapb.IsProcessVideoRequest();
  const rsp: any = await unary(clientFactory, "isProcessVideo", rq, undefined, md);

  if (!rsp) return false;

  // proto usually generates getIsprocessvideo(); keep fallbacks just in case
  if (typeof rsp.getIsprocessvideo === "function") return !!rsp.getIsprocessvideo();
  if (typeof rsp.getIsProcessVideo === "function") return !!rsp.getIsProcessVideo();
  return !!(rsp.isprocessvideo ?? rsp.value ?? false);
}

// ---------------------- Automatic conversion flags ----------------------

/** Enable/disable automatic video conversion (to MP4). */
export async function setVideoConversion(enabled: boolean): Promise<void> {
  const md = await meta();
  const rq = new mediapb.SetVideoConversionRequest();
  rq.setValue(enabled);
  await unary(clientFactory, "setVideoConversion", rq, undefined, md);
}

/** Enable/disable automatic stream conversion (MP4 → HLS). */
export async function setVideoStreamConversion(enabled: boolean): Promise<void> {
  const md = await meta();
  const rq = new mediapb.SetVideoStreamConversionRequest();
  rq.setValue(enabled);
  await unary(clientFactory, "setVideoStreamConversion", rq, undefined, md);
}

/** Set the daily start hour for automatic conversions ("HH:MM"). */
export async function setStartVideoConversionHour(value: string): Promise<void> {
  const md = await meta();
  const rq = new mediapb.SetStartVideoConversionHourRequest();
  rq.setValue(value);
  await unary(clientFactory, "setStartVideoConversionHour", rq, undefined, md);
}

/** Set the maximum duration for automatic conversions ("HH:MM"). */
export async function setMaximumVideoConversionDelay(value: string): Promise<void> {
  const md = await meta();
  const rq = new mediapb.SetMaximumVideoConversionDelayRequest();
  rq.setValue(value);
  await unary(clientFactory, "setMaximumVideoConversionDelay", rq, undefined, md);
}

// ----------------------------- Logs ---------------------------------

export type VideoConversionLogPB = mediapb.VideoConversionLog;
export type VideoConversionErrorPB = mediapb.VideoConversionError;

/** Get all video conversion logs. */
export async function getVideoConversionLogs(): Promise<VideoConversionLogPB[]> {
  const md = await meta();
  const rq = new mediapb.GetVideoConversionLogsRequest();
  const rsp: any = await unary(clientFactory, "getVideoConversionLogs", rq, undefined, md);

  if (rsp && typeof rsp.getLogsList === "function") {
    return rsp.getLogsList() as VideoConversionLogPB[];
  }
  return [];
}

/** Clear *all* conversion logs. */
export async function clearVideoConversionLogs(): Promise<void> {
  const md = await meta();
  const rq = new mediapb.ClearVideoConversionLogsRequest();
  await unary(clientFactory, "clearVideoConversionLogs", rq, undefined, md);
}

/** Get all conversion errors. */
export async function getVideoConversionErrors(): Promise<VideoConversionErrorPB[]> {
  const md = await meta();
  const rq = new mediapb.GetVideoConversionErrorsRequest();
  const rsp: any = await unary(clientFactory, "getVideoConversionErrors", rq, undefined, md);

  if (rsp && typeof rsp.getErrorsList === "function") {
    return rsp.getErrorsList() as VideoConversionErrorPB[];
  }
  return [];
}

/** Clear a single conversion error by path. */
export async function clearVideoConversionError(path: string): Promise<void> {
  const md = await meta();
  const rq = new mediapb.ClearVideoConversionErrorRequest();
  rq.setPath(path);
  await unary(clientFactory, "clearVideoConversionError", rq, undefined, md);
}

/** Clear *all* conversion errors. */
export async function clearVideoConversionErrors(): Promise<void> {
  const md = await meta();
  const rq = new mediapb.ClearVideoConversionErrorsRequest();
  await unary(clientFactory, "clearVideoConversionErrors", rq, undefined, md);
}

// ----------------------------- Settings ------------------------------

export type MediaConversionSettings = {
  automaticVideoConversion: boolean;
  automaticStreamConversion: boolean;
  startVideoConversionHour: string;
  maximumVideoConversionDelay: string;
};

/** Best-effort fetch of media conversion settings persisted on the server. */
export async function getMediaConversionSettings(): Promise<MediaConversionSettings> {
  const defaults: MediaConversionSettings = {
    automaticVideoConversion: false,
    automaticStreamConversion: false,
    startVideoConversionHour: "00:00",
    maximumVideoConversionDelay: "00:00",
  };

  try {
    const base = (getBaseUrl() ?? "").replace(/\/$/, "");
    if (!base) return defaults;

    // Config service usually exposes service configs under /config/{serviceId}
    const res = await fetch(`${base}/config/media.MediaService`, {
      credentials: "include",
    });
    if (!res.ok) return defaults;
    const cfg = await res.json();
    return {
      automaticVideoConversion: !!cfg.AutomaticVideoConversion,
      automaticStreamConversion: !!cfg.AutomaticStreamConversion,
      startVideoConversionHour: cfg.StartVideoConversionHour || defaults.startVideoConversionHour,
      maximumVideoConversionDelay: cfg.MaximumVideoConversionDelay || defaults.maximumVideoConversionDelay,
    };
  } catch {
    return defaults;
  }
}
