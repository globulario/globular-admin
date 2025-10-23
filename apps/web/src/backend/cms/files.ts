// src/backend/files.ts
// Unified, typed backend wrapper for the File service — styled like accounts.ts
// - Provides a FileVM facade (avoid direct use of file_pb types in the app)
// - Exposes simple helpers: readDir, getFile, readFile (stream), saveFile, createDir, addPublicDir,
//   createLink, deleteFile, deleteDir, renameFile, uploadFiles, downloadFileHttp
// - Internally tolerates minor grpc-web naming differences using pickMethod/newRq like accounts.ts

import { getBaseUrl } from "../core/endpoints"
import { unary, stream } from "../core/rpc"

// ---- Generated stubs (adjust paths if needed) ----
import { FileServiceClient } from "globular-web-client/file/file_grpc_web_pb"
import * as filepb from "globular-web-client/file/file_pb"
import { FilesCache } from "./files_cache"

/* ------------------------------------------------------------------
 * Constants (from the provided snippet)
 * ------------------------------------------------------------------ */
export const THUMBNAIL_PREVIEW_DIR = "/__preview__"
export const SUBTITLES_DIR = "/__subtitles__"
export const TIMELINE_THUMBNAILS_DIR = "/__timeline__"
export const DEFAULT_AVATAR_PATH = "https://www.w3schools.com/howto/img_avatar.png"
export const LOCAL_MEDIA_PROTOCOL = "local-media://"

/* ------------------------------------------------------------------
 * View-Model facade (avoid leaking proto types to the UI)
 * ------------------------------------------------------------------ */
export class FileVM {
  // Core
  id?: string
  path: string
  name: string
  isDir: boolean
  size?: number
  mime?: string
  ext?: string

  // Ownership / perms
  owner?: string | number
  group?: string | number
  permissions?: number // octal-like (e.g., 0o755) if provided
  mode?: number
  hidden?: boolean

  // Times
  mtime?: Date
  ctime?: Date
  atime?: Date

  // Links / previews
  linkTarget?: string
  thumbnails?: string[]

  // Optional rich-media infos (if your proto exposes them)
  titles?: any[]
  videos?: any[]
  audios?: any[]

  // Misc
  hash?: string
  width?: number
  height?: number
  childrenCount?: number

  constructor(init: Partial<FileVM>) {
    this.id = init.id
    this.path = init.path ?? ""
    this.name = init.name ?? ""
    this.isDir = !!init.isDir
    this.size = init.size
    this.mime = init.mime
    this.ext = init.ext
    this.owner = init.owner
    this.group = init.group
    this.permissions = init.permissions
    this.mode = init.mode
    this.hidden = init.hidden
    this.mtime = init.mtime
    this.ctime = init.ctime
    this.atime = init.atime
    this.linkTarget = init.linkTarget
    this.thumbnails = init.thumbnails
    this.titles = init.titles
    this.videos = init.videos
    this.audios = init.audios
    this.hash = init.hash
    this.width = init.width
    this.height = init.height
    this.childrenCount = init.childrenCount
  }

  /** Build a FileVM from a generated proto object (or plain JS with similar getters). */
  static fromProto(info: any): FileVM {
    if (!info) return new FileVM({ path: "", name: "", isDir: false })

    // --- aliases for common field names/getters across versions ---
    const id = getStr(info, ["getId", "id"]) || undefined
    const path = getStr(info, ["getPath", "path"], "")
    const name = getStr(info, ["getName", "name"], path.substring(path.lastIndexOf('/') + 1))
    const isDir = getBool(info, ["getIsDir", "getIsdir", "isDir", "isdir"], false)
    const size = getNum(info, ["getSize", "size"]) || undefined
    const mime = getStr(info, ["getMimeType", "getMime", "mime", "mimetype"]) || undefined
    const ext = getStr(info, ["getExt", "ext"]) || (name.includes('.') ? name.split('.').pop()!.toLowerCase() : undefined)

    const owner = ((): any => {
      const u = getStr(info, ["getOwner", "owner", "getUser", "user"]) || getNum(info, ["getUid", "uid"]) || undefined
      return u === '' ? undefined : u
    })()
    const group = ((): any => {
      const g = getStr(info, ["getGroup", "group"]) || getNum(info, ["getGid", "gid"]) || undefined
      return g === '' ? undefined : g
    })()
    const permissions = getNum(info, ["getPermissions", "permissions"]) || undefined
    const mode = getNum(info, ["getMode", "mode"]) || undefined

    const mtimeMs = getNum(info, ["getMtime", "getMTime", "getModTime", "mtime", "modTime"]) || 0
    const ctimeMs = getNum(info, ["getCtime", "getCTime", "ctime"]) || 0
    const atimeMs = getNum(info, ["getAtime", "getATime", "atime"]) || 0

    const mtime = mtimeMs ? new Date(Number(mtimeMs)) : undefined
    const ctime = ctimeMs ? new Date(Number(ctimeMs)) : undefined
    const atime = atimeMs ? new Date(Number(atimeMs)) : undefined

    const linkTarget = getStr(info, ["getLinkTarget", "getLink", "linkTarget", "link"]) || undefined
    const hidden = getBool(info, ["getHidden", "hidden"]) || undefined

    const hash = getStr(info, ["getHash", "getMd5", "hash", "md5"]) || undefined

    // Optional media lists
    const titles = callList(info, ["getTitlesList", "getTitleList", "titlesList", "titles"]) || undefined
    const videos = callList(info, ["getVideosList", "videosList", "videos"]) || undefined
    const audios = callList(info, ["getAudiosList", "audiosList", "audios"]) || undefined

    const width = getNum(info, ["getWidth", "width"]) || undefined
    const height = getNum(info, ["getHeight", "height"]) || undefined

    const thumbnails = callList(info, ["getThumbnailsList", "thumbnailsList", "thumbnails"]) || undefined

    const childrenCount = getNum(info, ["getChildrenCount", "childrenCount"]) || undefined

    return new FileVM({
      id, path, name, isDir, size, mime, ext,
      owner, group, permissions, mode, hidden,
      mtime, ctime, atime,
      linkTarget, thumbnails,
      titles, videos, audios,
      hash, width, height,
      childrenCount,
    })
  }
}

export type DirVM = { path: string, files: FileVM[] }

// ---- Cache controls -------------------------------------------------------
let CACHE_ENABLED = true
let _cache: FilesCache | null = new FilesCache({ max: 200, ttlMs: 15000, multiTab: true })

export function useFilesCache(enable: boolean) { CACHE_ENABLED = enable }
export function setFilesCacheOptions(opts: { max?: number; ttlMs?: number; multiTab?: boolean }) {
  _cache = new FilesCache(opts)
}
export function getFilesCache(): FilesCache | null { return _cache }

/* ------------------------------ helpers ------------------------------ */
function clientFactory(): FileServiceClient {
  const base = getBaseUrl() ?? ''
  return new FileServiceClient(base, null, { withCredentials: true })
}

async function meta(): Promise<Record<string, string>> {
  try {
    const t = sessionStorage.getItem('__globular_token__')
    return t ? { token: t } : {}
  } catch {
    return {}
  }
}

/** Pick a method name from candidates that exists on the client */
function pickMethod(client: any, candidates: ReadonlyArray<string>): string {
  for (const m of candidates) if (typeof (client as any)[m] === 'function') return m
  // fall back to the first; unary() will throw a helpful error if missing
  return candidates[0]
}

/** Construct a request using the first constructor name that exists */
function newRq(names: readonly string[]): any {
  for (const n of names) {
    const Ctor: any = (filepb as any)[n]
    if (Ctor) return new Ctor()
  }
  // Create a plain object if we truly can’t find the ctor (keeps dev moving)
  return {}
}

function getStr(obj: any, getters: string[], dflt = ''): string {
  for (const g of getters) {
    const v = tryCall(obj, g)
    if (typeof v === 'string') return v
  }
  return dflt
}
function getNum(obj: any, getters: string[], dflt = 0): number {
  for (const g of getters) {
    const v = tryCall(obj, g)
    if (typeof v === 'number') return v
  }
  return dflt
}
function getBool(obj: any, getters: string[], dflt = false): boolean {
  for (const g of getters) {
    const v = tryCall(obj, g)
    if (typeof v === 'boolean') return v
  }
  return dflt
}
function tryCall(obj: any, method: string): any {
  try {
    if (obj && typeof obj[method] === 'function') return obj[method]()
  } catch {}
  return undefined
}

function callList(obj: any, methods: string[]): any[] | undefined {
  for (const m of methods) {
    try {
      const fn = obj && (obj as any)[m]
      if (typeof fn === 'function') {
        const v = fn.call(obj)
        if (Array.isArray(v)) return v
      } else if (Array.isArray((obj as any)[m])) {
        return (obj as any)[m]
      }
    } catch {}
  }
  return undefined
}

/* ------------------------------ method map ------------------------------ */
const SERVICE_METHODS = {
  getInfo:     { method: ['getFileInfo'], rq: ['GetFileInfoRequest'] },
  read:        { method: ['readFile', 'readfile'], rq: ['ReadFileRequest'] },
  save:        { method: ['saveFile'], rq: ['SaveFileRequest'] },
  createDir:   { method: ['createDir', 'createDirectory'], rq: ['CreateDirRequest'] },
  addPublicDir:{ method: ['addPublicDir'], rq: ['AddPublicDirRequest'] },
  createLnk:   { method: ['createLnk', 'createLink'], rq: ['CreateLnkRequest'] },
  deleteFile:  { method: ['deleteFile'], rq: ['DeleteFileRequest'] },
  deleteDir:   { method: ['deleteDir'], rq: ['DeleteDirRequest'] },
  rename:      { method: ['rename'], rq: ['RenameRequest'] },

  // ⬇️ newly added
  getPublicDirs:{ method: ['getPublicDirs'], rq: ['GetPublicDirsRequest'] },
} as const;

/* ------------------------------ API ------------------------------ */

/** List a directory using the higher-level api helper; returns FileVMs */
export async function readDir(path: string, includeHidden = false): Promise<DirVM> {
  if (CACHE_ENABLED && _cache) {
    return _cache.getDir(path, /*swr*/ true)
  }
  return readDirFresh(path, includeHidden)
}

export async function readDirFresh(path: string, includeHidden = false): Promise<DirVM> {
  // Stream ReadDir directly (mirrors api.js behavior but with our rpc helpers)
  const md = await meta()
  const rq: any = newRq(['ReadDirRequest'])
  if (typeof rq.setPath === 'function') rq.setPath(encodeURI(path || '/'))
  if (typeof rq.setRecursive === 'function') rq.setRecursive(false)
  if (typeof rq.setThumbnailheight === 'function') rq.setThumbnailheight(80)
  if (typeof rq.setThumbnailwidth === 'function') rq.setThumbnailwidth(80)

  const client = clientFactory()
  const method = 'readDir' in (client as any) ? 'readDir' : 'readdir'

  const filesProto: any[] = []
  await stream(() => client, method, rq, (chunk: Uint8Array | any) => {
    // our stream helper should deliver message objects; accept bytes too
    const msg: any = (chunk && typeof (chunk as any).getInfo === 'function') ? chunk : undefined
    if (msg) {
      const f = msg.getInfo()
      if (f) filesProto.push(f)
    }
  }, "file.FileService", md)

  const data: DirVM = { path, files: filesProto.map(f => FileVM.fromProto(f)) }
  if (CACHE_ENABLED && _cache) {
    try { (_cache as any).put?.(path, data) } catch {}
  }
  return data
}

/** Fetch a single file’s info */
export async function getFile(path: string): Promise<FileVM | null> {
  const md = await meta()
  const rq = newRq(SERVICE_METHODS.getInfo.rq)
  if (typeof rq.setPath === 'function') rq.setPath(path)
  else rq.path = path

  const method = pickMethod(clientFactory(), SERVICE_METHODS.getInfo.method)
  const rsp: any = await unary(clientFactory, method, rq, undefined, md)
  const info = rsp && (rsp.getInfo?.() ?? rsp.getFileinfo?.() ?? rsp.info)
  const vm = info ? FileVM.fromProto(info) : null
  if (vm && CACHE_ENABLED && _cache) _cache.upsertFile(vm)
  return vm
}

/** Stream a file’s bytes. onChunk receives raw Uint8Array chunks */
export async function readFile(path: string, onChunk: (b: Uint8Array) => void): Promise<void> {
  const md = await meta()
  const rq = newRq(SERVICE_METHODS.read.rq)
  if (typeof rq.setPath === 'function') rq.setPath(path)
  else rq.path = path

  const method = pickMethod(clientFactory(), SERVICE_METHODS.read.method)
  await stream(clientFactory, method, rq, onChunk, "file.FileService", md)
}

/** Save a complete file (overwrite) */
export async function saveFile(path: string, data: Uint8Array): Promise<void> {
  const md = await meta()
  const rq = newRq(SERVICE_METHODS.save.rq)
  if (typeof rq.setPath === 'function') rq.setPath(path)
  else rq.path = path
  if (typeof rq.setData === 'function') rq.setData(data)
  else rq.data = data

  const method = pickMethod(clientFactory(), SERVICE_METHODS.save.method)
  await unary(clientFactory, method, rq, undefined, md)
  if (CACHE_ENABLED && _cache) _cache.invalidate(parentOf(path))
}

/** Create a directory under `parentPath` with `name` */
export async function createDir(parentPath: string, name: string): Promise<void> {
  const md = await meta()
  const rq = newRq(SERVICE_METHODS.createDir.rq)
  if (typeof rq.setPath === 'function') rq.setPath(parentPath)
  else rq.path = parentPath
  if (typeof rq.setName === 'function') rq.setName(name)
  else rq.name = name

  const method = pickMethod(clientFactory(), SERVICE_METHODS.createDir.method)
  await unary(clientFactory, method, rq, undefined, md)
  if (CACHE_ENABLED && _cache) _cache.invalidate(parentPath)
}

/** Add a public directory (FileService domain-wide) */
export async function addPublicDir(path: string): Promise<void> {
  const md = await meta()
  const rq = newRq(SERVICE_METHODS.addPublicDir.rq)
  if (typeof rq.setPath === 'function') rq.setPath(path)
  else rq.path = path
  const method = pickMethod(clientFactory(), SERVICE_METHODS.addPublicDir.method)
  await unary(clientFactory, method, rq, undefined, md)
  if (CACHE_ENABLED && _cache) _cache.invalidate(path)
}

/** Create a .lnk pointing to a serialized FileInfo */
export async function createLink(destDir: string, linkName: string, targetInfo: any): Promise<void> {
  const md = await meta()
  const rq = newRq(SERVICE_METHODS.createLnk.rq)
  if (typeof rq.setPath === 'function') rq.setPath(destDir)
  else rq.path = destDir
  if (typeof rq.setName === 'function') rq.setName(linkName)
  else rq.name = linkName

  const lnkBytes = typeof targetInfo?.serializeBinary === 'function' ? targetInfo.serializeBinary() : targetInfo
  if (typeof rq.setLnk === 'function') rq.setLnk(lnkBytes)
  else rq.lnk = lnkBytes

  const method = pickMethod(clientFactory(), SERVICE_METHODS.createLnk.method)
  await unary(clientFactory, method, rq, undefined, md)
  if (CACHE_ENABLED && _cache) _cache.invalidate(destDir)
}

/* ------------------------------ Convenience wrappers (api.js) ------------------------------ */

export async function removeFile(path: string): Promise<void> {
  const md = await meta()
  const rq = newRq(SERVICE_METHODS.deleteFile.rq)
  if (typeof rq.setPath === 'function') rq.setPath(encodeURI(path || '/'))
  else rq.path = encodeURI(path || '/')
  const method = pickMethod(clientFactory(), SERVICE_METHODS.deleteFile.method)
  await unary(clientFactory, method, rq, undefined, md)
  if (CACHE_ENABLED && _cache) _cache.invalidate(parentOf(path))
}

export async function removeDir(path: string): Promise<void> {
  const md = await meta()
  const rq = newRq(SERVICE_METHODS.deleteDir.rq)
  if (typeof rq.setPath === 'function') rq.setPath(encodeURI(path || '/'))
  else rq.path = encodeURI(path || '/')
  const method = pickMethod(clientFactory(), SERVICE_METHODS.deleteDir.method)
  await unary(clientFactory, method, rq, undefined, md)
  if (CACHE_ENABLED && _cache) _cache.invalidate(parentOf(path))
}

// Example of a rename function (if needed)
export async function renameFile(path: string, newName: string, oldName?: string): Promise<void> {
  const md = await meta()
  const parent = parentOf(path)
  const rq = newRq(SERVICE_METHODS.rename.rq)
  if (typeof rq.setPath === 'function') rq.setPath(encodeURI(parent || '/'))
  else rq.path = encodeURI(parent || '/')
  if (typeof rq.setOldName === 'function') rq.setOldName(oldName ?? basename(path))
  else rq.oldName = oldName ?? basename(path)
  if (typeof rq.setNewName === 'function') rq.setNewName(newName)
  else rq.newName = newName
  const method = pickMethod(clientFactory(), SERVICE_METHODS.rename.method)
  await unary(clientFactory, method, rq, undefined, md)
  if (CACHE_ENABLED && _cache) {
    const oldParent = parent
    const newPath = parent + '/' + newName
    const newParent = parentOf(newPath)
    _cache.invalidate(oldParent)
    _cache.invalidate(newParent)
  }
}

export async function upload(path: string, files: FileList | File[]): Promise<void> {
  const md = await meta()
  await apiUploadFiles(path, files as any, () => {}, (e: any) => { throw e }, md.token)
}

export async function download(url: string, fileName: string): Promise<void> {
  const md = await meta()
  await apiDownloadFileHttp(url, fileName, () => {}, md.token)
}

// If you need a direct API for uploading files (not used above)
async function apiUploadFiles(path: string, files: FileList | File[], onComplete?: () => void, onError?: (err: any) => void, token?: string) {
  return new Promise<void>((resolve, reject) => {
    const fd = new FormData()
    const list: File[] = Array.isArray(files as any) ? (files as any) : Array.from(files as FileList)
    for (const f of list) {
      fd.append('multiplefiles', f, f.name)
      fd.append('path', path)
    }
    const xhr = new XMLHttpRequest()
    xhr.onerror = () => { const err = xhr.responseText || 'upload failed'; onError?.(err); reject(err) }

    const base = getBaseUrl() || window.location.origin
    const url = base.replace(/\/?$/, '') + '/uploads'
    xhr.open('POST', url, true)
    if (token) xhr.setRequestHeader('token', token)
    xhr.onload = () => { onComplete?.(); resolve(); }
    xhr.send(fd)
  })
}

async function apiDownloadFileHttp(url: string, fileName: string, complete: () => void, token?: string) {
  return new Promise<void>((resolve, reject) => {
    const req = new XMLHttpRequest()
    req.open('GET', url, true)
    if (token) req.setRequestHeader('token', token)
    req.responseType = 'blob'
    req.onload = () => {
      const blob = req.response
      const link = document.createElement('a')
      link.href = window.URL.createObjectURL(blob)
      link.download = fileName
      link.click()
      try { complete?.() } catch {}
      resolve()
    }
    req.onerror = () => reject('download failed')
    req.send()
  })
}

/* ------------------------------ New functions ported/adapted ------------------------------ */

/** Formats file size with automatic unit selection (bytes, KB, MB, GB, TB). */
export function getFileSizeString(f_size: number | string): string {
  if (typeof f_size === 'string') return f_size
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let size = f_size
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++ }
  return `${size.toFixed(2)} ${units[i]}`
}

/**
 * Ask the backend for the size of a remote URL (expects a /file_size endpoint).
 * Returns the size in bytes.
 */
export async function getFileSize(url: string): Promise<number> {
  const base = window.location.protocol + '//' + window.location.host
  const requestUrl = new URL(base + '/file_size')
  requestUrl.searchParams.set('url', url)

  const headers: Record<string, string> = {}
  const md = await meta()
  if (md.token) headers['token'] = md.token

  const res = await fetch(requestUrl.toString(), {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(10_000)
  })

  if (!res.ok) throw new Error(`Failed to get file size for ${url}: HTTP ${res.status}`)
  const data = await res.json()
  if (typeof data?.size !== 'number') throw new Error('Invalid file size response from server.')
  return data.size
}

/** Copy text to clipboard (simple textarea trick, no permission prompt). */
export function copyToClipboard(text: string): void {
  const dummy = document.createElement('textarea')
  document.body.appendChild(dummy)
  dummy.value = text
  dummy.select()
  document.execCommand('copy')
  document.body.removeChild(dummy)
}

/**
 * Read a whole file as TEXT (utf-8). Uses the existing streaming readFile().
 */
export async function readText(path: string): Promise<string> {
  const chunks: Uint8Array[] = []
  await readFile(path, (b) => chunks.push(b))
  // Concatenate
  let len = 0; for (const c of chunks) len += c.byteLength
  const buf = new Uint8Array(len)
  let o = 0; for (const c of chunks) { buf.set(c, o); o += c.byteLength }
  return new TextDecoder('utf-8').decode(buf)
}

/**
 * Read a whole file as binary (Uint8Array). Uses the existing streaming readFile().
 */
export async function readBinary(path: string): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  await readFile(path, (b) => chunks.push(b))
  let len = 0; for (const c of chunks) len += c.byteLength
  const buf = new Uint8Array(len)
  let o = 0; for (const c of chunks) { buf.set(c, o); o += c.byteLength }
  return buf
}

/**
 * Get associated hidden files directory under `.hidden/<basename>/<subDirName>`.
 * Returns a DirVM or null if not found/error.
 */
export async function getHiddenFiles(path: string, subDirName: string): Promise<DirVM | null> {
  try {
    let basePath = path
    if (/\.(mp3|mp4|mkv|avi|webm|flac|mov|wav|ogg|aac|flv|wmv|3gp|m4v|mpg|mpeg)$/i.test(basePath)) {
      basePath = basePath.substring(0, basePath.lastIndexOf("."))
    }
    const dir = basePath.substring(0, basePath.lastIndexOf("/") + 1)
    const leaf = basePath.substring(basePath.lastIndexOf("/"))
    const hiddenDirPath = `${dir}.hidden${leaf}/${subDirName}`
    return await readDir(hiddenDirPath).catch(() => null)
  } catch (e) {
    console.warn(`getHiddenFiles failed for ${path}:`, e)
    return null
  }
}

/**
 * Build a direct URL to a file path served by the backend, optionally appending token as header.
 * We keep headers for auth rather than query params to avoid leaking in URL history.
 */
function buildFileUrl(rawPath: string): { url: string, headers: Record<string, string> } {
  const base = (getBaseUrl() ?? '').replace(/\/$/, '')
  const parts = rawPath.split('/').filter(Boolean).map(encodeURIComponent)
  const url = `${base}/${parts.join('/')}`
  const headers: Record<string, string> = {}
  // attach token header if present
  try {
    const t = sessionStorage.getItem('__globular_token__')
    if (t) headers['token'] = t
  } catch {}
  return { url, headers }
}

/**
 * Load images for a list of FileVMs (assumes each FileVM.path is fetchable as binary).
 * Returns HTMLImageElement[] (data URLs), one per successfully fetched image.
 */
export async function getImages(files: FileVM[]): Promise<HTMLImageElement[]> {
  const imgs: HTMLImageElement[] = []
  for (const f of files) {
    if (!f?.path) continue
    const { url, headers } = buildFileUrl(f.path)
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.timeout = 10_000
        xhr.open('GET', url, true)
        Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v))
        xhr.responseType = 'blob'
        xhr.onload = () => (xhr.status === 200 ? resolve(xhr.response as Blob) : reject(new Error(`HTTP ${xhr.status}`)))
        xhr.onerror = () => reject(new Error('Network error'))
        xhr.ontimeout = () => reject(new Error('Timeout'))
        xhr.send()
      })
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(reader.error || new Error('FileReader error'))
        reader.readAsDataURL(blob)
      })
      const img = document.createElement('img')
      img.src = base64
      imgs.push(img)
    } catch (e) {
      console.warn(`Failed to load image for ${f.path}:`, e)
    }
  }
  return imgs
}

// ⬇️ add these helpers somewhere below your existing exports

/** Returns true if the given node is a directory (works with FileVM or proto). */
export function validateDirAccess(dir: any): boolean {
  if (!dir) return false;

  // FileVM
  if (typeof dir.isDir === "boolean") return dir.isDir;

  // Proto / plain object with getters
  try {
    const fns = ["getIsDir", "getIsdir", "isDir", "isdir"];
    for (const fn of fns) {
      if (typeof dir[fn] === "function") {
        const v = dir[fn]();
        if (typeof v === "boolean") return v;
      }
    }
  } catch {}
  return false;
}

/** Soft-flag a node as public (non-destructive; works on FileVM or proto). */
export function markAsPublic(node: any): void {
  try { (node as any).__isPublic = true; } catch {}
}

/** Soft-flag a node as shared (non-destructive; works on FileVM or proto). */
export function markAsShare(node: any): void {
  try { (node as any).__isShared = true; } catch {}
}

/**
 * List public directory paths from the File service.
 * Uses GetPublicDirsRequest and returns string[] of absolute paths.
 */
export async function listPublicDirs(): Promise<string[]> {
  const md = await meta();

  // Build request (supports multiple generated names)
  const rq = newRq(SERVICE_METHODS.getPublicDirs.rq);
  // no params on rq

  const method = pickMethod(clientFactory(), SERVICE_METHODS.getPublicDirs.method);
  const rsp: any = await unary(clientFactory, method, rq, undefined, md);

  // Accept several shape variants from grpc-web
  const list =
    (rsp?.getDirsList && rsp.getDirsList()) ??
    rsp?.dirsList ??
    rsp?.dirs ??
    [];

  return Array.isArray(list) ? list : [];
}

/* ------------------------------ Utilities ------------------------------ */

export function formatSize(bytes?: number): string {
  if (bytes == null) return ""
  const KB = 1024, MB = KB * 1024, GB = MB * 1024
  if (bytes >= GB) return (bytes / GB).toFixed(2) + ' GB'
  if (bytes >= MB) return (bytes / MB).toFixed(2) + ' MB'
  if (bytes >= KB) return (bytes / KB).toFixed(2) + ' KB'
  return String(bytes) + ' bytes'
}

function parentOf(p: string): string {
  if (!p || p === "/") return "/"
  const i = p.lastIndexOf("/")
  return i > 0 ? p.slice(0, i) || "/" : "/"
}

function basename(p: string): string { const i = p.lastIndexOf('/'); return i >= 0 ? p.slice(i+1) : p }
