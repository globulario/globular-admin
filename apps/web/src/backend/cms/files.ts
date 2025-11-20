// files.ts
// Unified, typed backend wrapper for the File service.
// Proto alignment: FileInfo { name,size,mode,mode_time,is_dir,path,mime,thumbnail,checksum,metadata,files[] }

import { getBaseUrl } from "../core/endpoints";
import { unary, stream } from "../core/rpc";

// ---- Generated stubs (adjust paths if needed) ----
import { FileServiceClient } from "globular-web-client/file/file_grpc_web_pb";
import * as filepb from "globular-web-client/file/file_pb";
import { FilesCache, type ReadDirFetcher } from "./files_cache";

declare const Buffer: any;

/* ------------------------------------------------------------------
 * Constants (kept for callers)
 * ------------------------------------------------------------------ */
export const THUMBNAIL_PREVIEW_DIR = "/__preview__";
export const SUBTITLES_DIR = "/__subtitles__";
export const TIMELINE_THUMBNAILS_DIR = "/__timeline__";
export const DEFAULT_AVATAR_PATH = "https://www.w3schools.com/howto/img_avatar.png";
export const LOCAL_MEDIA_PROTOCOL = "local-media://";

/* ------------------------------------------------------------------
 * FileVM mirrors proto FileInfo (recursive). Extras remain optional
 * but we remove any legacy `thumbnails[]` to match proto strictly.
 * ------------------------------------------------------------------ */
export class FileVM {
  // Proto-aligned core
  name: string;
  size?: number;
  mode?: number;
  modeTime?: Date;       // derived from mode_time (seconds) => Date
  isDir: boolean;
  path: string;
  mime?: string;
  thumbnail?: string;    // single thumbnail (no array)
  checksum?: string;
  metadata?: any;        // Struct -> JS object
  files?: FileVM[];      // recursion

  // Extras kept for backward compatibility (not in proto)
  id?: string;
  ext?: string;
  owner?: string | number;
  group?: string | number;
  permissions?: number;
  hidden?: boolean;

  mtime?: Date;
  ctime?: Date;
  atime?: Date;

  linkTarget?: string;

  titles?: any[];
  videos?: any[];
  audios?: any[];

  hash?: string;
  width?: number;
  height?: number;
  childrenCount?: number;

  constructor(init: Partial<FileVM>) {
    // proto core
    this.name = init.name ?? "";
    this.size = init.size;
    this.mode = init.mode;
    this.modeTime = init.modeTime;
    this.isDir = !!init.isDir;
    this.path = init.path ?? "";
    this.mime = init.mime;
    this.thumbnail = init.thumbnail;
    this.checksum = init.checksum;
    this.metadata = init.metadata;
    this.files = init.files;

    // extras
    this.id = init.id;
    this.ext = init.ext;
    this.owner = init.owner;
    this.group = init.group;
    this.permissions = init.permissions;
    this.hidden = init.hidden;

    this.mtime = init.mtime;
    this.ctime = init.ctime;
    this.atime = init.atime;

    this.linkTarget = init.linkTarget;

    this.titles = init.titles;
    this.videos = init.videos;
    this.audios = init.audios;

    this.hash = init.hash;
    this.width = init.width;
    this.height = init.height;
    this.childrenCount = init.childrenCount;
  }

  /** Build a FileVM from a generated proto (or duck-typed object with similar getters). */
  static fromProto(info: any): FileVM {
    if (!info) return new FileVM({ path: "", name: "", isDir: false });

    // helpers
    const id = getStr(info, ["getId", "id"]) || undefined;
    const path = getStr(info, ["getPath", "path"], "");
    const name =
      getStr(info, ["getName", "name"], "") ||
      (path ? path.substring(path.lastIndexOf("/") + 1) : "");
    const isDir = getBool(info, ["getIsDir", "getIsdir", "isDir", "isdir"], false);
    const size = numUndef(info, ["getSize", "size"]);
    const mode = numUndef(info, ["getMode", "mode"]);

    // proto uses mode_time seconds; some impls might emit ms — normalize.
    const mtRaw =
      getNum(info, ["getModetime", "getModeTime", "mode_time"]) || 0;
    const modeTime = toDateFromMaybeSeconds(mtRaw);

    const mime = strUndef(info, ["getMime", "getMimeType", "mime", "mimetype"]);
    const thumbnail = strUndef(info, ["getThumbnail", "thumbnail"]);
    const checksum = strUndef(info, ["getChecksum", "checksum"]);

    // metadata (Struct → JS)
    let metadata: any = undefined;
    try {
      const m = tryCall(info, "getMetadata");
      if (m && typeof m.toJavaScript === "function") metadata = m.toJavaScript();
      else metadata = m ?? (info.metadata ?? undefined);
    } catch {
      metadata = info?.metadata;
    }

    // children (repeated FileInfo files = 11)
    let files: FileVM[] | undefined = undefined;
    try {
      const list =
        (typeof info.getFilesList === "function" && info.getFilesList()) ||
        (Array.isArray(info.files) ? info.files : []);
      if (Array.isArray(list)) files = list.map(FileVM.fromProto);
    } catch {}

    // legacy extras that sometimes exist on servers
    const mtimeMs = getNum(info, ["getMtime", "getMTime", "mtime", "modTime"]) || 0;
    const ctimeMs = getNum(info, ["getCtime", "getCTime", "ctime"]) || 0;
    const atimeMs = getNum(info, ["getAtime", "getATime", "atime"]) || 0;

    const owner =
      strOrNumUndef(info, ["getOwner", "owner", "getUser", "user", "getUid", "uid"]);
    const group = strOrNumUndef(info, ["getGroup", "group", "getGid", "gid"]);
    const permissions = numUndef(info, ["getPermissions", "permissions"]);
    const hidden = boolUndef(info, ["getHidden", "hidden"]);

    const linkTarget = strUndef(info, ["getLinkTarget", "getLink", "linkTarget", "link"]);

    const titles = callList(info, ["getTitlesList", "getTitleList", "titlesList", "titles"]);
    const videos = callList(info, ["getVideosList", "videosList", "videos"]);
    const audios = callList(info, ["getAudiosList", "audiosList", "audios"]);

    const width = numUndef(info, ["getWidth", "width"]);
    const height = numUndef(info, ["getHeight", "height"]);
    const childrenCount = numUndef(info, ["getChildrenCount", "childrenCount"]);
    const hash = strUndef(info, ["getHash", "getMd5", "hash", "md5"]);

    const vm = new FileVM({
      id,
      path,
      name,
      isDir,
      size,
      mode,
      modeTime,
      mime,
      thumbnail,
      checksum,
      metadata,
      files,

      owner,
      group,
      permissions,
      hidden,

      mtime: mtimeMs ? new Date(Number(mtimeMs)) : undefined,
      ctime: ctimeMs ? new Date(Number(ctimeMs)) : undefined,
      atime: atimeMs ? new Date(Number(atimeMs)) : undefined,

      linkTarget,

      titles: titles || undefined,
      videos: videos || undefined,
      audios: audios || undefined,

      hash,
      width,
      height,
      childrenCount,
    });

    if (!vm.name && vm.path) vm.name = basename(vm.path);
    if (!vm.ext && vm.name.includes(".")) vm.ext = vm.name.split(".").pop()!.toLowerCase();

    return vm;
  }

  getFilesList(): FileVM[] {
    return this.files || [];
  }
}

/* ------------------------------------------------------------------
 * Link helpers (shared between backend + views)
 * ------------------------------------------------------------------ */

function getPathString(file: any): string {
  if (!file) return "";
  if (typeof file.getPath === "function") return file.getPath() || "";
  if (typeof file.path === "string") return file.path;
  return "";
}

function getNameString(file: any): string {
  if (!file) return "";
  if (typeof file.getName === "function") return file.getName() || "";
  if (typeof file.name === "string" && file.name.length) return file.name;
  const p = getPathString(file);
  if (!p) return "";
  const idx = p.lastIndexOf("/");
  return idx >= 0 ? p.substring(idx + 1) : p;
}

function isMaybeDir(file: any): boolean {
  if (!file) return false;
  if (typeof file.getIsDir === "function") return !!file.getIsDir();
  if (typeof file.isDir === "boolean") return file.isDir;
  return false;
}

export function isLinkFile(file: any): boolean {
  if (!file || isMaybeDir(file)) return false;
  const name = getNameString(file).toLowerCase();
  return name.endsWith(".lnk") || !!file?.isLink || !!file?.linkTarget;
}

export async function loadLinkTarget(file: any): Promise<any> {
  if (!file || !isLinkFile(file)) return null;
  if (file.linkTarget) return file.linkTarget;
  if (file.__linkTargetPromise) return file.__linkTargetPromise;

  const promise = (async () => {
    const path = getPathString(file);
    if (!path) throw new Error("Invalid link path.");
    const raw = await readText(path);
    if (!raw || raw.trim().length === 0) throw new Error("Link file is empty.");
    const bytes = base64ToBytes(raw);
    let info: any = filepb.FileInfo.deserializeBinary(bytes);
    const targetPath =
      (typeof info.getPath === "function" && info.getPath()) ||
      info.path ||
      "";
    if (targetPath) {
      try {
        const fresh = await getFile(targetPath);
        if (fresh) info = fresh;
      } catch (err) {
        console.warn("Failed to fetch linked file info", err);
      }
    }
    file.linkTarget = info;
    file.isLink = true;
    return info;
  })();

  file.__linkTargetPromise = promise;
  return promise;
}

export async function getDisplayFileForLink(file: any): Promise<any> {
  const target = await loadLinkTarget(file);
  return target || file;
}

export function getActionFile(file: any): any {
  return (file && file.linkTarget) || file;
}

// Backward compatibility: DirVM is just a FileVM
export type DirVM = FileVM;

// ---- Cache controls -------------------------------------------------------
let CACHE_ENABLED = true;

// Inject a fetcher that calls readDirFresh to avoid recursion
const injectedFetcher: ReadDirFetcher = (p, includeHidden) => readDirFresh(p, !!includeHidden);

let _cache: FilesCache | null = new FilesCache({
  max: 200,
  ttlMs: 15000,
  multiTab: true,
  fetcher: injectedFetcher,
});

export function useFilesCache(enable: boolean) { CACHE_ENABLED = enable; }

export function setFilesCacheOptions(opts: { max?: number; ttlMs?: number; multiTab?: boolean }) {
  _cache = new FilesCache({
    ...opts,
    fetcher: injectedFetcher,
  });
}

export function getFilesCache(): FilesCache | null { return _cache; }

/* ------------------------------ helpers ------------------------------ */
function clientFactory(): FileServiceClient {
  const base = getBaseUrl() ?? '';
  return new FileServiceClient(base, null, { withCredentials: true });
}

async function meta(): Promise<Record<string, string>> {
  try {
    const t = sessionStorage.getItem('__globular_token__');
    return t ? { token: t } : {};
  } catch {
    return {};
  }
}

/** Pick a method name from candidates that exists on the client */
function pickMethod(client: any, candidates: ReadonlyArray<string>): string {
  for (const m of candidates) if (typeof (client as any)[m] === 'function') return m;
  return candidates[0];
}

/** Construct a request using the first constructor name that exists */
function newRq(names: readonly string[]): any {
  for (const n of names) {
    const Ctor: any = (filepb as any)[n];
    if (Ctor) return new Ctor();
  }
  return {};
}

function getStr(obj: any, getters: string[], dflt = ''): string {
  for (const g of getters) {
    const v = tryCall(obj, g);
    if (typeof v === 'string') return v;
  }
  return dflt;
}
function strUndef(obj: any, getters: string[]): string | undefined {
  const s = getStr(obj, getters, "");
  return s === "" ? undefined : s;
}
function getNum(obj: any, getters: string[], dflt = 0): number {
  for (const g of getters) {
    const v = tryCall(obj, g);
    if (typeof v === 'number') return v;
  }
  return dflt;
}
function numUndef(obj: any, getters: string[]): number | undefined {
  const n = getNum(obj, getters, 0);
  return n === 0 ? undefined : n;
}
function getBool(obj: any, getters: string[], dflt = false): boolean {
  for (const g of getters) {
    const v = tryCall(obj, g);
    if (typeof v === 'boolean') return v;
  }
  return dflt;
}
function boolUndef(obj: any, getters: string[]): boolean | undefined {
  const b = getBool(obj, getters, false);
  return b ? true : undefined;
}
function tryCall(obj: any, method: string): any {
  try {
    if (obj && typeof obj[method] === 'function') return obj[method]();
  } catch {}
  return undefined;
}
function callList(obj: any, methods: string[]): any[] | undefined {
  for (const m of methods) {
    try {
      const fn = obj && (obj as any)[m];
      if (typeof fn === 'function') {
        const v = fn.call(obj);
        if (Array.isArray(v)) return v;
      } else if (Array.isArray((obj as any)[m])) {
        return (obj as any)[m];
      }
    } catch {}
  }
  return undefined;
}
function parentOf(p: string): string {
  if (!p || p === "/") return "/";
  const i = p.lastIndexOf("/");
  return i > 0 ? p.slice(0, i) || "/" : "/";
}
function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}
function toDateFromMaybeSeconds(v: number): Date | undefined {
  if (!v) return undefined;
  // if value looks like seconds (<= 1e12), convert; if already ms (>=1e12), use as-is.
  const ms = v < 1e12 ? v * 1000 : v;
  return new Date(Number(ms));
}

/* ------------------------------ method map ------------------------------ */
const SERVICE_METHODS = {
  getInfo:       { method: ['getFileInfo'], rq: ['GetFileInfoRequest'] },
  read:          { method: ['readFile', 'readfile'], rq: ['ReadFileRequest'] },
  save:          { method: ['saveFile'], rq: ['SaveFileRequest'] },
  createDir:     { method: ['createDir', 'createDirectory'], rq: ['CreateDirRequest'] },
  addPublicDir:  { method: ['addPublicDir'], rq: ['AddPublicDirRequest'] },
  createLnk:     { method: ['createLnk', 'createLink'], rq: ['CreateLnkRequest'] },
  deleteFile:    { method: ['deleteFile'], rq: ['DeleteFileRequest'] },
  deleteDir:     { method: ['deleteDir'], rq: ['DeleteDirRequest'] },
  rename:        { method: ['rename'], rq: ['RenameRequest'] },

  // existing extra
  getPublicDirs: { method: ['getPublicDirs'], rq: ['GetPublicDirsRequest'] },

  // extra RPCs
  getMetadata:     { method: ['getFileMetadata', 'getMetadata'], rq: ['GetFileMetadataRequest'] },
  getThumbnails:   { method: ['getThumbnails'],                  rq: ['GetThumbnailsRequest'] },
  uploadFile:      { method: ['uploadFile'],                     rq: ['UploadFileRequest'] },
  createArchive:   { method: ['createArchive'],                  rq: ['CreateArchiveRequest'] },
  copy:            { method: ['copy'],                           rq: ['CopyRequest'] },
  move:            { method: ['move'],                           rq: ['MoveRequest'] },
  removePublicDir: { method: ['removePublicDir'],                rq: ['RemovePublicDirRequest'] },
  writeExcel:      { method: ['writeExcelFile'],                 rq: ['WriteExcelFileRequest'] },
  htmlToPdf:       { method: ['htmlToPdf'],                      rq: ['HtmlToPdfRqst'] },
  stop:            { method: ['stop'],                           rq: ['StopRequest'] },
} as const;

/* ------------------------------ API ------------------------------ */

/** List a directory; returns a FileVM with .files children. */
export async function readDir(path: string, recursive = false): Promise<DirVM> {
  if (CACHE_ENABLED && _cache) {
    return _cache.getDir(path, /*swr*/ true, recursive) as unknown as DirVM;
  }
  return readDirFresh(path, recursive);
}
export async function readDirFresh(path: string, recursive = false): Promise<DirVM> {
  const md = await meta();
  const rq: any = newRq(['ReadDirRequest']);
  const requestedPath = path || '/';
  const encodedPath = encodeURI(requestedPath);

  if (typeof rq.setPath === 'function') rq.setPath(encodedPath);
  if (typeof rq.setRecursive === 'function') rq.setRecursive(recursive);
  if (typeof rq.setThumbnailheight === 'function') rq.setThumbnailheight(80);
  if (typeof rq.setThumbnailwidth === 'function') rq.setThumbnailwidth(80);

  const client = clientFactory();
  const method = 'readDir' in (client as any) ? 'readDir' : 'readdir';

  // Build a proper tree while streaming
  const nodes = new Map<string, FileVM>();
  let root: FileVM | null = null;

  // Helpers
  const norm = (p: string) => (p || '/').replace(/\/+/g, '/');
  const isUnder = (child: string, rootPath: string) => {
    const c = norm(child);
    const r = norm(rootPath);
    if (c === r) return true;
    return c.startsWith(r.endsWith('/') ? r : r + '/');
  };
  const getOrCreate = (p: string): FileVM => {
    const k = norm(p);
    let n = nodes.get(k);
    if (!n) {
      n = new FileVM({ path: k, name: basename(k), isDir: true, files: [] });
      nodes.set(k, n);
    }
    if (!Array.isArray(n.files)) n.files = [];
    return n;
  };
  const addChild = (parent: FileVM, child: FileVM) => {
    if (!Array.isArray(parent.files)) parent.files = [];
    if (!parent.files.find((f) => f.path === child.path)) parent.files.push(child);
  };

  await stream(() => client, method, rq, (chunk: any) => {
    const info = chunk?.getInfo?.() ?? chunk?.info;
    if (!info) return;

    const vm = FileVM.fromProto(info);
    const vmPath = norm(vm.path);

    // First message is often the root directory itself
    if (!root && (vmPath === norm(encodedPath) || vmPath === norm(requestedPath))) {
      vm.isDir = true;
      if (!Array.isArray(vm.files)) vm.files = [];
      root = vm;
      nodes.set(vmPath, vm);
      return;
    }

    // Ignore anything not under the requested root (defensive)
    const rootPath = root ? root.path : (requestedPath || '/');
    if (!isUnder(vmPath, rootPath)) return;

    // Ensure the node and its parent exist
    const node = getOrCreate(vmPath);
    // Preserve fields from the streamed vm (don’t nuke existing children)
    Object.assign(node, { ...vm, files: node.files ?? vm.files ?? [] });

    // Link into parent (but don’t link above the requested root)
    const p = parentOf(vmPath);
    if (isUnder(p, rootPath)) {
      const parentNode = getOrCreate(p);
      addChild(parentNode, node);
    }
  }, "file.FileService", md as any);

  // If server never streamed the root, synthesize it and attach direct children
  if (!root) {
    root = new FileVM({
      name: basename(requestedPath || "/"),
      path: norm(requestedPath || "/"),
      isDir: true,
      files: [],
    });
    nodes.set(root.path, root);
  }

  // Ensure root.files is at least an array
  if (!Array.isArray(root.files)) root.files = [];

  const linkPromises: Promise<any>[] = [];
  nodes.forEach((node) => {
    if (!node || node.isDir) return;
    if (!isLinkFile(node)) return;
    linkPromises.push(
      loadLinkTarget(node).catch((err) => {
        console.warn("Failed to resolve link target", err);
        return null;
      })
    );
  });
  if (linkPromises.length) await Promise.allSettled(linkPromises);



  return root as DirVM;
}

/** Fetch a single file’s info */
export async function getFile(path: string): Promise<FileVM | null> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.getInfo.rq);
  if (typeof rq.setPath === 'function') rq.setPath(path);
  else rq.path = path;

  const method = pickMethod(clientFactory(), SERVICE_METHODS.getInfo.method);
  const rsp: any = await unary(clientFactory, method, rq, undefined, md);
  const info = rsp && (rsp.getInfo?.() ?? rsp.getFileinfo?.() ?? rsp.info);
  const vm = info ? FileVM.fromProto(info) : null;
  if (vm && CACHE_ENABLED && _cache) _cache.upsertFile(vm);
  return vm;
}

/** Stream a file’s bytes. onChunk receives raw Uint8Array chunks */
function extractChunkBytes(msg: any): Uint8Array | null {
  if (!msg) return null;
  try {
    if (typeof msg.getData_asU8 === "function") {
      const data = msg.getData_asU8();
      return data instanceof Uint8Array ? data : new Uint8Array(data);
    }
    if (typeof msg.getData === "function") {
      const data = msg.getData();
      if (data instanceof Uint8Array) return data;
      if (typeof data === "string") return base64ToBytes(data);
    }
    const direct = msg.data;
    if (direct instanceof Uint8Array) return direct;
    if (typeof direct === "string") return base64ToBytes(direct);
  } catch (err) {
    console.warn("Failed to decode stream chunk", err);
  }
  return null;
}

export async function readFile(path: string, onChunk: (b: Uint8Array) => void): Promise<void> {
  const rq = newRq(SERVICE_METHODS.read.rq);
  if (typeof rq.setPath === 'function') rq.setPath(path);
  else rq.path = path;

  const method = pickMethod(clientFactory(), SERVICE_METHODS.read.method);
  await stream(clientFactory, method, rq, (msg) => {
    const data = extractChunkBytes(msg);
    if (data) onChunk(data);
  }, "file.FileService");
}

/** Save a complete file (overwrite) */
export async function saveFile(path: string, data: Uint8Array): Promise<void> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.save.rq);
  if (typeof rq.setPath === 'function') rq.setPath(path);
  else rq.path = path;
  if (typeof rq.setData === 'function') rq.setData(data);
  else rq.data = data;

  const method = pickMethod(clientFactory(), SERVICE_METHODS.save.method);
  await unary(clientFactory, method, rq, undefined, md);
  if (CACHE_ENABLED && _cache) _cache.invalidate(parentOf(path));
}

/** Create a directory under `parentPath` with `name` */
export async function createDir(parentPath: string, name: string): Promise<void> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.createDir.rq);
  if (typeof rq.setPath === 'function') rq.setPath(parentPath);
  else rq.path = parentPath;
  if (typeof rq.setName === 'function') rq.setName(name);
  else rq.name = name;

  const method = pickMethod(clientFactory(), SERVICE_METHODS.createDir.method);
  await unary(clientFactory, method, rq, undefined, md);
  if (CACHE_ENABLED && _cache) _cache.invalidate(parentPath);
}

/** Add a public directory (FileService domain-wide) */
export async function addPublicDir(path: string): Promise<void> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.addPublicDir.rq);
  if (typeof rq.setPath === 'function') rq.setPath(path);
  else rq.path = path;
  const method = pickMethod(clientFactory(), SERVICE_METHODS.addPublicDir.method);
  await unary(clientFactory, method, rq, undefined, md);
  if (CACHE_ENABLED && _cache) _cache.invalidate(path);
}

function extractPathFromTarget(target: any): string | undefined {
  if (!target && target !== "") return undefined;
  if (typeof target === "string") return target;
  if (typeof target.getPath === "function") {
    const p = target.getPath();
    if (typeof p === "string" && p.length > 0) return p;
  }
  if (typeof target.path === "string" && target.path.length > 0) return target.path;
  if (target.__vm && typeof target.__vm.path === "string") return target.__vm.path;
  return undefined;
}

async function fetchFileInfoProto(path: string): Promise<any | null> {
  if (!path) return null;
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.getInfo.rq);
  if (typeof rq.setPath === 'function') rq.setPath(path);
  else rq.path = path;
  const method = pickMethod(clientFactory(), SERVICE_METHODS.getInfo.method);
  const rsp: any = await unary(clientFactory, method, rq, undefined, md);
  const info = rsp && (rsp.getInfo?.() ?? rsp.getFileinfo?.() ?? rsp.info);
  return info || null;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  const globalBtoa = typeof btoa === "function" ? btoa : null;
  if (!globalBtoa) {
    throw new Error("No base64 encoder available in this environment.");
  }
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, Array.from(sub));
  }
  return globalBtoa(binary);
}

function base64ToBytes(str: string): Uint8Array {
  if (typeof str !== "string" || str.length === 0) return new Uint8Array(0);
  const sanitized = str.replace(/\s+/g, "");
  if (typeof Buffer !== "undefined") {
    return Uint8Array.from(Buffer.from(sanitized, "base64"));
  }
  if (typeof atob === "function") {
    const binary = atob(sanitized);
    const len = binary.length;
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) out[i] = binary.charCodeAt(i);
    return out;
  }
  throw new Error("No base64 decoder available.");
}

function looksLikeFsPath(str: string): boolean {
  return str.startsWith("/") || str.startsWith("\\");
}

function looksLikeBase64(str: string): boolean {
  return /^[A-Za-z0-9+/=]+$/.test(str);
}

async function resolveLinkPayload(targetInfo: any): Promise<string> {
  if (typeof targetInfo === "string") {
    if (!looksLikeFsPath(targetInfo) && looksLikeBase64(targetInfo)) {
      return targetInfo;
    }
    const proto = await fetchFileInfoProto(targetInfo);
    if (proto && typeof proto.serializeBinary === "function") {
      const bytes = proto.serializeBinary();
      const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      return bytesToBase64(arr);
    }
    throw new Error(`Unable to fetch file info for path ${targetInfo}`);
  }

  if (targetInfo instanceof Uint8Array) {
    return bytesToBase64(targetInfo);
  }

  if (typeof targetInfo?.serializeBinary === "function") {
    const bytes = targetInfo.serializeBinary();
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return bytesToBase64(arr);
  }

  if (ArrayBuffer.isView(targetInfo) && targetInfo.byteLength !== undefined) {
    const view = targetInfo as ArrayBufferView;
    return bytesToBase64(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  }

  if (targetInfo instanceof ArrayBuffer) {
    return bytesToBase64(new Uint8Array(targetInfo));
  }

  const path = extractPathFromTarget(targetInfo);
  if (path) {
    const proto = await fetchFileInfoProto(path);
    if (proto && typeof proto.serializeBinary === "function") {
      const bytes = proto.serializeBinary();
      const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      return bytesToBase64(arr);
    }
  }

  throw new Error("Unable to resolve file information for link target.");
}

/** Create a .lnk pointing to a serialized FileInfo */
export async function createLink(destDir: string, linkName: string, targetInfo: any): Promise<void> {
  const lnkBytes = await resolveLinkPayload(targetInfo);
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.createLnk.rq);
  if (typeof rq.setPath === 'function') rq.setPath(destDir);
  else rq.path = destDir;
  if (typeof rq.setName === 'function') rq.setName(linkName);
  else rq.name = linkName;

  if (typeof rq.setLnk === 'function') rq.setLnk(lnkBytes);
  else rq.lnk = lnkBytes;

  const method = pickMethod(clientFactory(), SERVICE_METHODS.createLnk.method);
  await unary(clientFactory, method, rq, undefined, md);
  if (CACHE_ENABLED && _cache) _cache.invalidate(destDir);
}

/* ------------------------------ Convenience wrappers (api.js) ------------------------------ */

export async function removeFile(path: string): Promise<void> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.deleteFile.rq);
  if (typeof rq.setPath === 'function') rq.setPath(encodeURI(path || '/'));
  else rq.path = encodeURI(path || '/');
  const method = pickMethod(clientFactory(), SERVICE_METHODS.deleteFile.method);
  await unary(clientFactory, method, rq, undefined, md);
  if (CACHE_ENABLED && _cache) _cache.invalidate(parentOf(path));
}

export async function removeDir(path: string): Promise<void> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.deleteDir.rq);
  if (typeof rq.setPath === 'function') rq.setPath(encodeURI(path || '/'));
  else rq.path = encodeURI(path || '/');
  const method = pickMethod(clientFactory(), SERVICE_METHODS.deleteDir.method);
  await unary(clientFactory, method, rq, undefined, md);
  if (CACHE_ENABLED && _cache) _cache.invalidate(parentOf(path));
}

export async function renameFile(path: string, newName: string, oldName?: string): Promise<void> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.rename.rq);
  if (typeof rq.setPath === 'function') rq.setPath(encodeURI(path || '/'));
  else rq.path = encodeURI(path || '/');
  if (typeof rq.setOldName === 'function') rq.setOldName(oldName ?? basename(path));
  else rq.oldName = oldName ?? basename(path);
  if (typeof rq.setNewName === 'function') rq.setNewName(newName);
  else rq.newName = newName;
  const method = pickMethod(clientFactory(), SERVICE_METHODS.rename.method);
  await unary(clientFactory, method, rq, undefined, md);
  if (CACHE_ENABLED && _cache) {
    const oldParent = path;
    const newPath = path + '/' + newName;
    const newParent = parentOf(newPath);
    _cache.invalidate(oldParent);
    _cache.invalidate(newParent);
  }
}

export async function upload(path: string, files: FileList | File[]): Promise<void> {
  const md = await meta();
  await apiUploadFiles(path, files as any, () => {}, (e: any) => { throw e }, md.token);
}

export async function download(url: string, fileName: string): Promise<void> {
  const md = await meta();
  await apiDownloadFileHttp(url, fileName, () => {}, md.token);
}

async function apiUploadFiles(path: string, files: FileList | File[], onComplete?: () => void, onError?: (err: any) => void, token?: string) {
  return new Promise<void>((resolve, reject) => {
    const fd = new FormData();
    const list: File[] = Array.isArray(files as any) ? (files as any) : Array.from(files as FileList);
    for (const f of list) {
      fd.append('multiplefiles', f, f.name);
      fd.append('path', path);
    }
    const xhr = new XMLHttpRequest();
    xhr.onerror = () => { const err = xhr.responseText || 'upload failed'; onError?.(err); reject(err); };

    const base = getBaseUrl() || window.location.origin;
    const url = base.replace(/\/?$/, '') + '/api/file-upload';
    xhr.open('POST', url, true);
    if (token) xhr.setRequestHeader('token', token);
    xhr.onload = () => { onComplete?.(); resolve(); };
    xhr.send(fd);
  });
}

async function apiDownloadFileHttp(url: string, fileName: string, complete: () => void, token?: string) {
  return new Promise<void>((resolve, reject) => {
    const req = new XMLHttpRequest();
    req.open('GET', url, true);
    if (token) req.setRequestHeader('token', token);
    req.responseType = 'blob';
    req.onload = () => {
      try {
        const blob = req.response;
        const link = document.createElement('a');
        link.href = window.URL.createObjectURL(blob);
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
      } catch {}
      try { complete?.(); } catch {}
      resolve();
    };
    req.onerror = () => reject('download failed');
    req.send();
  });
}

/* ------------------------------ New functions kept ------------------------------ */

export function getFileSizeString(f_size: number | string): string {
  if (typeof f_size === 'string') return f_size;
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let size = f_size;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return `${size.toFixed(2)} ${units[i]}`;
}

export async function getFileSize(url: string): Promise<number> {
  const base = window.location.protocol + '//' + window.location.host;
  const requestUrl = new URL(base + '/file_size');
  requestUrl.searchParams.set('url', url);

  const headers: Record<string, string> = {};
  const md = await meta();
  if (md.token) headers['token'] = md.token;

  const res = await fetch(requestUrl.toString(), {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(10_000)
  });

  if (!res.ok) throw new Error(`Failed to get file size for ${url}: HTTP ${res.status}`);
  const data = await res.json();
  if (typeof data?.size !== 'number') throw new Error('Invalid file size response from server.');
  return data.size;
}

export function copyToClipboard(text: string): void {
  const dummy = document.createElement('textarea');
  document.body.appendChild(dummy);
  dummy.value = text;
  dummy.select();
  document.execCommand('copy');
  document.body.removeChild(dummy);
}

export async function readText(path: string): Promise<string> {
  const chunks: Uint8Array[] = [];
  await readFile(path, (b) => chunks.push(b));
  let len = 0; for (const c of chunks) len += c.byteLength;
  const buf = new Uint8Array(len);
  let o = 0; for (const c of chunks) { buf.set(c, o); o += c.byteLength; }
  return new TextDecoder('utf-8').decode(buf);
}

export async function readBinary(path: string): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  await readFile(path, (b) => chunks.push(b));
  let len = 0; for (const c of chunks) len += c.byteLength;
  const buf = new Uint8Array(len);
  let o = 0; for (const c of chunks) { buf.set(c, o); o += c.byteLength; }
  return buf;
}

export async function getHiddenFiles(path: string, subDirName: string): Promise<DirVM | null> {
  try {
    let basePath = path;
    if (/\.(mp3|mp4|mkv|avi|webm|flac|mov|wav|ogg|aac|flv|wmv|3gp|m4v|mpg|mpeg)$/i.test(basePath)) {
      basePath = basePath.substring(0, basePath.lastIndexOf("."));
    }
    const dir = basePath.substring(0, basePath.lastIndexOf("/") + 1);
    const leaf = basePath.substring(basePath.lastIndexOf("/"));
    const hiddenDirPath = `${dir}.hidden${leaf}/${subDirName}`;
    return await readDirFresh(hiddenDirPath, true).catch(() => null);
  } catch (e) {
    console.warn(`getHiddenFiles failed for ${path}:`, e);
    return null;
  }
}

export function buildFileUrl(rawPath: string): { url: string, headers: Record<string, string> } {
  const base = (getBaseUrl() ?? '').replace(/\/$/, '');
  const parts = rawPath.split('/').filter(Boolean).map(encodeURIComponent);
  const url = `${base}/${parts.join('/')}`;
  const headers: Record<string, string> = {};
  try {
    const t = sessionStorage.getItem('__globular_token__');
    if (t) headers['token'] = t;
  } catch {}
  return { url, headers };
}

export function markAsPublic(node: any): void {
  try { (node as any).__isPublic = true; } catch {}
}

export function markAsShare(node: any): void {
  try { (node as any).__isShared = true; } catch {}
}

export async function listPublicDirs(): Promise<string[]> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.getPublicDirs.rq);
  const method = pickMethod(clientFactory(), SERVICE_METHODS.getPublicDirs.method);
  const rsp: any = await unary(clientFactory, method, rq, undefined, md);
  const list =
    (rsp?.getDirsList && rsp.getDirsList()) ??
    rsp?.dirsList ??
    rsp?.dirs ??
    [];
  if (!Array.isArray(list)) return [];

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const entry of list) {
    if (typeof entry !== "string") continue;
    let path = entry.trim();
    if (!path) continue;
    if (!path.startsWith("/")) path = "/" + path;
    path = path.replace(/\/+/g, "/");
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    if (!seen.has(path)) {
      seen.add(path);
      normalized.push(path);
    }
  }
  return normalized;
}

/** Backward-compatible alias (older code imported getPublicDirs) */
export async function getPublicDirs(): Promise<string[]> {
  return listPublicDirs();
}

/* ------------------------------ NEW RPCs (per proto/Service) ------------------------------ */

export async function getFileMetadata(path: string): Promise<any> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.getMetadata.rq);
  if (typeof rq.setPath === 'function') rq.setPath(path); else rq.path = path;

  const method = pickMethod(clientFactory(), SERVICE_METHODS.getMetadata.method);
  const rsp: any = await unary(clientFactory, method, rq, undefined, md);
  return (rsp?.getResult?.() ?? rsp?.result ?? {}) || {};
}

export async function copyFiles(destPath: string, files: string[]): Promise<void> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.copy.rq);
  rq.setPath?.(destPath); rq.path ??= destPath;
  rq.setFilesList?.(files ?? []); if (!rq.setFilesList) rq.files = files ?? [];

  const method = pickMethod(clientFactory(), SERVICE_METHODS.copy.method);
  await unary(clientFactory, method, rq, undefined, md);
  if (CACHE_ENABLED && _cache) _cache.invalidate(destPath);
}

export async function moveFiles(destPath: string, files: string[]): Promise<void> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.move.rq);
  rq.setPath?.(destPath); rq.path ??= destPath;
  rq.setFilesList?.(files ?? []); if (!rq.setFilesList) rq.files = files ?? [];

  const method = pickMethod(clientFactory(), SERVICE_METHODS.move.method);
  await unary(clientFactory, method, rq, undefined, md);
  if (CACHE_ENABLED && _cache) _cache.invalidate(destPath);
}

/** RPC: create the archive on the server and return its server path (e.g., "/tmp/_uuid.tar.gz"). */
export async function createArchive(paths: string[], name: string): Promise<string> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.createArchive.rq);
  rq.setPathsList?.(paths ?? []); if (!rq.setPathsList) rq.paths = paths ?? [];
  if (typeof rq.setName === 'function') rq.setName(name); else rq.name = name;

  const method = pickMethod(clientFactory(), SERVICE_METHODS.createArchive.method);
  const rsp: any = await unary(clientFactory, method, rq, undefined, md);
  return String(rsp?.getResult?.() ?? rsp?.result ?? "");
}

/**
 * Helper: end-to-end archive download without `globule`.
 * - Creates an archive from `paths`
 * - Downloads it as `${downloadName||uuid}.tar.gz` via XHR (token in header)
 * - Removes the temporary archive on the server
 */
export async function downloadAsArchive(paths: string[], downloadName?: string): Promise<void> {
  if (!paths || paths.length === 0) return;

  const safeName = (downloadName || "").trim();
  const uuid = "_" + (
    (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
      ? crypto.randomUUID()
      : (Date.now().toString(16) + Math.random().toString(16).slice(2))
  ).replace(/[-@]/g, "_");

  const archiveName = safeName || uuid;
  const md = await meta();

  // 1) Create archive on server
  const archivePath = await createArchive(paths, archiveName);

  // 2) Build an HTTP URL to that path (token in header; avoids leaking it in query string)
  const { url } = buildFileUrl(archivePath);

  // 3) Download blob via XHR with token header (so browsers treat it as a download)
  await apiDownloadFileHttp(url, `${archiveName}.tar.gz`, () => {}, md.token);

  // 4) Cleanup the temporary archive
  try { await removeFile(archivePath); } catch { /* ignore cleanup failure */ }
}

/**
 * This RPC can still stream binary thumbnail data when requested, but our VM stays proto-faithful
 * by only exposing the single `thumbnail` string on FileVM. Callers that need timeline sprites
 * or preview sheets should consume this stream directly.
 */
export async function getThumbnails(
  path: string,
  opts: { recursive?: boolean; thumbnailWidth?: number; thumbnailHeight?: number } = {},
  onChunk?: (c: { data: Uint8Array; text?: string }) => void
): Promise<void> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.getThumbnails.rq);
  rq.setPath?.(path); rq.path ??= path;
  rq.setRecursive?.(!!opts.recursive);
  ;(rq.setThumbnailwidth?.(opts.thumbnailWidth ?? 0) ?? (rq.thumbnailWidth = opts.thumbnailWidth ?? 0));
  ;(rq.setThumbnailheight?.(opts.thumbnailHeight ?? 0) ?? (rq.thumbnailHeight = opts.thumbnailHeight ?? 0));

  const client = clientFactory();
  const method = pickMethod(client, SERVICE_METHODS.getThumbnails.method);
  await stream(() => client, method, rq, (msg: any) => {
    const raw = msg?.getData?.() ?? msg?.data;
    const data = raw instanceof Uint8Array ? raw : new Uint8Array(raw ?? []);
    let text: string | undefined;
    try { text = new TextDecoder().decode(data); } catch {}
    onChunk?.({ data, text });
  }, "file.FileService", md as any);
}

export async function uploadFileFromUrl(
  params: { url: string; dest: string; name: string; domain?: string; isDir?: boolean },
  onProgress?: (p: { uploaded: number; total: number; info?: string }) => void
): Promise<void> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.uploadFile.rq);
  rq.setUrl?.(params.url);   rq.url ??= params.url;
  rq.setDest?.(params.dest); rq.dest ??= params.dest;
  rq.setName?.(params.name); rq.name ??= params.name;
  if (params.domain) rq.setDomain?.(params.domain);
  if (typeof rq.setIsdir === 'function') rq.setIsdir(!!params.isDir)
  else if (typeof rq.setIsDir === 'function') rq.setIsDir(!!params.isDir)
  else rq.isDir = !!params.isDir;

  const client = clientFactory();
  const method = pickMethod(client, SERVICE_METHODS.uploadFile.method);
  await stream(() => client, method, rq, (msg: any) => {
    const uploaded = Number(msg?.getUploaded?.() ?? msg?.uploaded ?? 0);
    const total    = Number(msg?.getTotal?.()    ?? msg?.total ?? 0);
    const info     = String(msg?.getInfo?.()     ?? msg?.info ?? "");
    onProgress?.({ uploaded, total, info });
  }, "file.FileService", md as any);
}

export async function removePublicDir(path: string): Promise<void> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.removePublicDir.rq);
  rq.setPath?.(path); rq.path ??= path;

  const method = pickMethod(clientFactory(), SERVICE_METHODS.removePublicDir.method);
  await unary(clientFactory, method, rq, undefined, md);
  if (CACHE_ENABLED && _cache) _cache.invalidate(path);
}

export async function writeExcelFile(path: string, dataJson: string): Promise<boolean> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.writeExcel.rq);
  rq.setPath?.(path); rq.path ??= path;
  rq.setData?.(dataJson); rq.data ??= dataJson;

  const method = pickMethod(clientFactory(), SERVICE_METHODS.writeExcel.method);
  const rsp: any = await unary(clientFactory, method, rq, undefined, md);
  return Boolean(rsp?.getResult?.() ?? rsp?.result ?? false);
}

export async function htmlToPdf(html: string): Promise<Uint8Array> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.htmlToPdf.rq);
  rq.setHtml?.(html); rq.html ??= html;

  const method = pickMethod(clientFactory(), SERVICE_METHODS.htmlToPdf.method);
  const rsp: any = await unary(clientFactory, method, rq, undefined, md);
  const bytes = rsp?.getPdf?.() ?? rsp?.pdf;
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? []);
}

export async function stopFileService(): Promise<void> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.stop.rq);
  const method = pickMethod(clientFactory(), SERVICE_METHODS.stop.method);
  await unary(clientFactory, method, rq, undefined, md);
}

/* ------------------------------ Utilities ------------------------------ */

export function formatSize(bytes?: number): string {
  if (bytes == null) return "";
  const KB = 1024, MB = KB * 1024, GB = MB * 1024;
  if (bytes >= GB) return (bytes / GB).toFixed(2) + ' GB';
  if (bytes >= MB) return (bytes / MB).toFixed(2) + ' MB';
  if (bytes >= KB) return (bytes / KB).toFixed(2) + ' KB';
  return String(bytes) + ' bytes';
}

function strOrNumUndef(
  obj: any,
  getters: string[]
): string | number | undefined {
  for (const g of getters) {
    const v = tryCall(obj, g);
    if (typeof v === "string") return v === "" ? undefined : v;
    if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  }
  return undefined;
}

/**
 * FIXED: getImages now relies on the URL API and does not double-encode '@' etc.
 * It attaches the token as a query param only if present.
 */
export async function getImages(
  files: Array<{ path?: string; getPath?: () => string }>
): Promise<HTMLImageElement[]> {
  const md = await meta(); // gives us token & domain
  const base = getBaseUrl() ?? '';
  const baseURL = new URL(base, typeof window !== 'undefined' ? window.location.href : 'http://localhost/');

  const imgs: HTMLImageElement[] = [];

  for (const f of files || []) {
    const p = typeof f?.getPath === 'function' ? f.getPath() : f?.path;
    if (!p) continue;

    // Build a fresh URL per image to avoid mutation bleed
    const u = new URL(baseURL.toString());

    // If p might contain a query, preserve it
    const [rawPath, rawQs] = p.split('?', 2);

    // Let the URL API handle encoding of the path. Do NOT call encodeURI here.
    // rawPath should be the *unencoded* path like "/users/sa@globular.io/file.jpg"
    u.pathname = rawPath;

    // Preserve any existing query from p
    if (rawQs) {
      const qs = new URLSearchParams(rawQs);
      qs.forEach((v, k) => u.searchParams.append(k, v));
    }

    // Append token if present
    if (md?.token) {
      u.searchParams.set('token', md.token);
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.name = p;
    img.src = u.toString(); // <- no encodeURI()

    await new Promise<void>((resolve) => {
      img.onload = () => resolve();
      img.onerror = () => resolve();
    });

    imgs.push(img);
  }

  return imgs;
}
