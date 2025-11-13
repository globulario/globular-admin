// src/backend/media.ts
import { getBaseUrl } from "../core/endpoints";
import { unary, stream } from "../core/rpc";

// ---- stubs ----
import { MediaServiceClient } from "globular-web-client/media/media_grpc_web_pb";
import * as mediapb from "globular-web-client/media/media_pb";

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
  console.log(absPath, height, nb);
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

/** Server-side fetch-then-upload by URL (progress over stream). */
export async function uploadVideoByUrl(
  destDir: string,
  url: string,
  format: "mp4" | "mp3",
  onMsg: (m: mediapb.UploadVideoResponse) => void
): Promise<void> {
  const md = await meta();
  const rq = new mediapb.UploadVideoRequest();
  rq.setDest(destDir);
  rq.setUrl(url);
  rq.setFormat(format);

  await stream(clientFactory, "uploadVideo", rq, (m: any) => {
    onMsg(m as mediapb.UploadVideoResponse);
  }, "media.MediaService", md);
}
