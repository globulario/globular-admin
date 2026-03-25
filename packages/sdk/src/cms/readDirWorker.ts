/// <reference lib="webworker" />

interface EntryPayload {
  path: string;
  name?: string;
  isDir?: boolean;
  files?: unknown[];
  [key: string]: unknown;
}

interface NodeEntry extends EntryPayload {
  path: string;
  name: string;
  isDir: boolean;
  files: NodeEntry[];
}

const nodes = new Map<string, NodeEntry>();
let root: NodeEntry | null = null;
let requestedPath = "/";
let normalizedRootPath = "/";
let cancelled = false;
let rootSent = false;
let updateCounter = 0;
const ROOT_UPDATE_INTERVAL = 50;

const normalizePath = (p: string) => (p || "/").replace(/\/+/g, "/");
const basename = (p: string) => {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
};
const parentOf = (p: string) => {
  if (!p) return "/";
  const i = p.lastIndexOf("/");
  return i > 0 ? p.slice(0, i) || "/" : "/";
};

const createPlaceholder = () => ({
  path: normalizedRootPath,
  name: basename(normalizedRootPath),
  isDir: true,
  files: [] as NodeEntry[],
});

const ensureNode = (entry: EntryPayload): NodeEntry => {
  const path = normalizePath(entry.path);
  let node = nodes.get(path);
  if (!node) {
    node = {
      path,
      name: entry.name || basename(path),
      isDir: !!entry.isDir,
      files: [] as NodeEntry[],
    };
    nodes.set(path, node);
  }

  if (entry.name) {
    node.name = entry.name;
  } else if (!node.name) {
    node.name = basename(path);
  }

  if (entry.isDir !== undefined) {
    node.isDir = !!entry.isDir;
  }

  if (!Array.isArray(node.files)) node.files = [];

  Object.keys(entry).forEach((key) => {
    if (key === "path" || key === "name" || key === "isDir" || key === "files") return;
    (node as any)[key] = (entry as any)[key];
  });

  return node;
};

const notifyUpdate = (entry: NodeEntry | null, forceRoot = false) => {
  const payload: any = { type: "update", entry };
  const shouldSendRoot = forceRoot || (!rootSent && !!root) || ((++updateCounter % ROOT_UPDATE_INTERVAL === 0) && !!root);
  if (shouldSendRoot) {
    payload.root = root;
    rootSent = true;
  }
  self.postMessage(payload);
};

const processEntry = (entry: EntryPayload) => {
  if (!entry?.path) return;
  const vmPath = normalizePath(entry.path);
  const node = ensureNode({ ...entry, path: vmPath });

  if (!root && vmPath === normalizePath(requestedPath)) {
    node.isDir = true;
    root = node;
    notifyUpdate(node, true);
    return;
  }

  const currentRootPath = root ? root.path : normalizedRootPath;
  if (!normalizePath(vmPath).startsWith(currentRootPath.endsWith("/") ? currentRootPath : `${currentRootPath}/`)) {
    // entry outside requested scope
    return;
  }

  const parentPath = parentOf(vmPath);
  if (normalizePath(parentPath).startsWith(currentRootPath)) {
    const parentNode = ensureNode({ path: parentPath, isDir: true });
    readDirAddChild(parentNode, node);
  }

  notifyUpdate(node);
};

const readDirAddChild = (parent: NodeEntry, child: NodeEntry) => {
  if (!Array.isArray(parent.files)) parent.files = [];
  if (!parent.files.find((f) => f.path === child.path)) parent.files.push(child);
};

const finalize = () => {
  const finalRoot = root ? root : createPlaceholder();
  notifyUpdate(finalRoot, true);
  self.postMessage({ type: "done", root: finalRoot });
};

const resetState = (path: string) => {
  nodes.clear();
  root = null;
  cancelled = false;
  requestedPath = path || "/";
  normalizedRootPath = normalizePath(requestedPath);
  rootSent = false;
  updateCounter = 0;
};

self.addEventListener("message", (event) => {
  const { type, path, entry } = event.data || {};
  if (type === "init") {
    resetState(path ?? "/");
    notifyUpdate(null);
  } else if (type === "entry") {
    if (cancelled) return;
    processEntry(entry as EntryPayload);
  } else if (type === "done") {
    if (cancelled) return;
    finalize();
  } else if (type === "cancel") {
    cancelled = true;
  }
});
