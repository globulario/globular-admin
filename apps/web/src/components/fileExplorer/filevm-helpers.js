// filevm-helpers.js
// Generic helpers for File VM / proto-like objects (FileInfo-compatible)

export function pathOf(v) {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (typeof v.getPath === "function") return v.getPath() || "";
  return v.path || "";
}

export function nameOf(v) {
  if (!v) return "";
  if (typeof v.getName === "function") return v.getName() || "";
  if (v.name) return v.name;
  const p = pathOf(v);
  if (!p) return "";
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.substring(i + 1) : p;
}

export function mimeOf(v) {
  if (!v) return "";
  if (typeof v.getMime === "function") return v.getMime() || "";
  if (typeof v.getMimeType === "function") return v.getMimeType() || "";
  return v.mime || "";
}

export function mimeRootOf(v) {
  return (mimeOf(v) || "").split("/")[0] || "";
}

export function isDir(v) {
  if (!v) return false;
  if (typeof v.getIsDir === "function") return !!v.getIsDir();
  if (typeof v.isDir === "boolean") return v.isDir;
  const m = mimeOf(v);
  return m === "inode/directory" || m === "directory" || Array.isArray(v.files);
}

export function sizeOf(v) {
  if (!v) return 0;
  if (typeof v.getSize === "function") return v.getSize() || 0;
  return typeof v.size === "number" ? v.size : 0;
}

export function filesOf(v) {
  if (!v) return [];
  if (typeof v.getFilesList === "function") return v.getFilesList() || [];
  return Array.isArray(v.files) ? v.files : [];
}

export function thumbOf(v) {
  if (!v) return "";
  if (typeof v.getThumbnail === "function") return v.getThumbnail() || "";
  return v.thumbnail || "";
}

export function modTimeOf(v) {
  return v.modeTime
}

export function modTimeSecOf(v) {
  if (!v) return 0;
  if (typeof v.getModeTime === "function") return v.getModeTime() || 0; // seconds (proto field)
  if (typeof v.mode_time === "number") return v.mode_time || 0;
  return v.modTimeSec || 0;
}

/** Convenience alias so old code that called extractPath keeps working */
/** Helper to extract a path from a DirVM/FileVM/String */
export function extractPath(v) {
  if (!v) return "";

  // Simple string
  if (typeof v === "string") return v;

  // Plain JS objects with .path
  if (typeof v.path === "string") return v.path;

  // Proto-style objects with getPath()
  if (typeof v.getPath === "function") return v.getPath();

  // Some events might wrap the file/dir
  if (v.file) return extractPath(v.file);
  if (v.dir) return extractPath(v.dir);

  return "";
}

/**
 * Adapt a FileVM (from backend/files) to an object that looks like a FileInfo (proto-like).
 * Single-thumbnail only (proto has `thumbnail`), no `thumbnailsList`.
 */
export function adaptFileVM(vm) {
  const f = vm || {};
  const obj = {
    __vm: vm,
    getPath: () => f.path || "",
    getName: () =>
      f.name || (f.path ? f.path.substring(f.path.lastIndexOf("/") + 1) : ""),
    getIsDir: () => !!f.isDir,
    getMime: () => f.mime || "",
    getSize: () => (typeof f.size === "number" ? f.size : 0),
    getThumbnail: () => f.thumbnail || "",
    modeTime: f.mode_time || 0,
    // direct fields sometimes accessed by views
    titles: f.titles,
    videos: f.videos,
    audios: f.audios,
    modeTime: f.modeTime || 0
  };

  // mirror common fields directly as well
  obj.path = f.path || "";
  obj.name = obj.getName();
  obj.isDir = obj.getIsDir();
  obj.mime = obj.getMime();
  obj.size = obj.getSize();
  obj.thumbnail = obj.getThumbnail();

  return obj;
}

/** Adapt a DirVM to something with getPath() and getFilesList() */
export function adaptDirVM(dirVM) {
  const d = dirVM || { path: "", files: [] };
  const filesList = (Array.isArray(d.files) ? d.files : []).map(adaptFileVM);
  const obj = {
    __vm: d,
    getPath: () => d.path || "",
    getFilesList: () => filesList,

    // direct mirrors
    path: d.path || "",
    files: filesList
  };
  return obj;
}
