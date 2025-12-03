// src/backend/search_document.ts
// Typed, resilient wrapper around the Search service (gRPC-web),
// following the same structure/pattern as accounts.ts / files.ts.

import { getBaseUrl } from "../core/endpoints";
import { unary, stream } from "../core/rpc";

// ---- Generated stubs (adjust paths if needed) ----
import { SearchServiceClient } from "globular-web-client/search/search_grpc_web_pb";
import * as searchpb from "globular-web-client/search/search_pb";

/* ------------------------------------------------------------------
 * Small helpers (mirrors files.ts style)
 * ------------------------------------------------------------------ */

function clientFactory(): SearchServiceClient {
  const base = getBaseUrl() ?? "";
  return new SearchServiceClient(base, null, { withCredentials: true });
}

async function meta(): Promise<Record<string, string>> {
  try {
    const t = sessionStorage.getItem("__globular_token__");
    return t ? { token: t } : {};
  } catch {
    return {};
  }
}

/** Construct a request instance using the first constructor name that exists. */
function newRq(names: readonly string[]): any {
  for (const n of names) {
    const Ctor: any = (searchpb as any)[n];
    if (Ctor) return new Ctor();
  }
  return {};
}

function tryCall<T = any>(obj: any, method: string): T | undefined {
  try {
    if (obj && typeof obj[method] === "function") return obj[method]();
  } catch {}
  return undefined;
}

/* ------------------------------------------------------------------
 * View models
 * ------------------------------------------------------------------ */

export interface SearchQueryOptions {
  /** Absolute paths to index roots (filesystem paths) */
  paths: string[];
  /** Language code, e.g. "en" */
  language?: string;
  /** Indexed field names, e.g. ["Text"] */
  fields?: string[];
  /** Pagination offset (default 0) */
  offset?: number;
  /** Page size (default 100) */
  pageSize?: number;
  /** Lucene-like query (e.g. "Text:hello") */
  query: string;
  /** Optional application name to forward (if your gateway expects it) */
  application?: string;
  /** Snippet length (default 0 = no snippets) */
  snippetLength?: number;
}

export interface SearchDocumentSnippetVM {
  /** Field name -> array of HTML snippets (highlighted) */
  [field: string]: string[];
}

export interface SearchDocumentVM {
  /** Rank/score as a number (service-dependent scale) */
  rank: number;
  /** Raw JSON string from service (doc metadata) */
  dataJson: string;
  /** Raw JSON string snippets from service */
  snippetJson: string;
  /** Parsed doc (best-effort) */
  doc?: any;
  /** Parsed snippet (best-effort) */
  snippet?: SearchDocumentSnippetVM;
}

/* ------------------------------------------------------------------
 * Core API map
 * ------------------------------------------------------------------ */

const SERVICE_METHODS = {
  searchDocuments:   { method: ["searchDocuments"], rq: ["SearchDocumentsRequest"] },
  getEngineVersion:  { method: ["getEngineVersion"], rq: ["GetEngineVersionRequest"] },
  indexJsonObject:   { method: ["indexJsonObject"], rq: ["IndexJsonObjectRequest"] },
  count:             { method: ["count"], rq: ["CountRequest"] },
  deleteDocument:    { method: ["deleteDocument"], rq: ["DeleteDocumentRequest"] },
  stop:              { method: ["stop"], rq: ["StopRequest"] },
} as const;

/* ------------------------------------------------------------------
 * Streaming Search
 * ------------------------------------------------------------------ */

/**
 * Stream search results. You get each chunk as soon as it arrives.
 * Returns a function to cancel/close the stream (no-op with current rpc helper).
 */
export async function searchDocumentsStream(
  opts: SearchQueryOptions,
  onBatch: (batch: SearchDocumentVM[]) => void,
  onEnd?: () => void,
  onError?: (err: any) => void
): Promise<() => void> {
  // Build request
  const rq: any = newRq(SERVICE_METHODS.searchDocuments.rq);
  if (typeof rq.setPathsList === "function") rq.setPathsList(opts.paths ?? []);
  if (typeof rq.setQuery === "function") rq.setQuery(opts.query ?? "");
  if (typeof rq.setLanguage === "function") rq.setLanguage(opts.language ?? "en");
  if (typeof rq.setFieldsList === "function") rq.setFieldsList(opts.fields ?? ["Text"]);
  if (typeof rq.setOffset === "function") rq.setOffset(opts.offset ?? 0);
  if (typeof rq.setPagesize === "function") rq.setPagesize(opts.pageSize ?? 100);
  // snippetLength can be named two ways depending on TS codegen
  if (typeof rq.setSnippetlength === "function") rq.setSnippetlength(opts.snippetLength ?? 0);
  else if (typeof rq.setSnippetLength === "function") rq.setSnippetLength(opts.snippetLength ?? 0);

  // Message handler
  const onMessage = (msg: any) => {
    const resultsContainer =
      tryCall<any>(msg, "getResults") ?? (msg?.results ?? undefined);

    const list =
      (resultsContainer &&
        (tryCall<any[]>(resultsContainer, "getResultsList") ??
          (resultsContainer as any).resultsList ??
          (resultsContainer as any).results)) ||
      [];

    if (!Array.isArray(list) || list.length === 0) {
      onBatch([]);
      return;
    }

    const batch: SearchDocumentVM[] = list.map((it: any) => {
      const rank = Number(tryCall<number>(it, "getRank") ?? it?.rank ?? 0);
      const dataJson = tryCall<string>(it, "getData") ?? it?.data ?? "{}";
      const snippetJson = tryCall<string>(it, "getSnippet") ?? it?.snippet ?? "{}";

      let doc: any | undefined;
      let snippet: SearchDocumentSnippetVM | undefined;
      try { doc = JSON.parse(dataJson); } catch {}
      try { snippet = JSON.parse(snippetJson); } catch {}

      return { rank, dataJson, snippetJson, doc, snippet };
    });

    onBatch(batch);
  };

  // Kick off the stream (signature: cf, methodName, req, onMsg, serviceId, opts?)
  const p = stream(
    clientFactory as unknown as (addr: string) => any, // compatible; ignores addr
    SERVICE_METHODS.searchDocuments.method[0],
    rq,
    onMessage,
    "search.SearchService"
    // no 6th arg since you don't have opts.base and your helper doesn't need it
  );

  // Wire end/error callbacks
  p.then(() => { onEnd && onEnd(); })
   .catch(err => { onError && onError(err); });

  // stream() exposes no real cancel; return a no-op to satisfy the return type
  return () => {};
}

/**
 * Convenience helper: collect all streamed results and return them as a single array.
 */
export async function searchDocuments(opts: SearchQueryOptions): Promise<SearchDocumentVM[]> {
  return new Promise<SearchDocumentVM[]>(async (resolve, reject) => {
    const all: SearchDocumentVM[] = [];
    try {
      await searchDocumentsStream(
        opts,
        (batch) => { if (Array.isArray(batch) && batch.length) all.push(...batch); },
        () => resolve(all),
        (err) => reject(err)
      );
    } catch (e) {
      reject(e);
    }
  });
}

/* ------------------------------------------------------------------
 * Additional RPCs from the proto (unary helpers)
 * ------------------------------------------------------------------ */

/** Get the search engine version message. */
export async function getEngineVersion(): Promise<string> {
  const md = await meta();
  const rq: any = newRq(SERVICE_METHODS.getEngineVersion.rq);
  const method = SERVICE_METHODS.getEngineVersion.method[0];
  const rsp: any = await unary(() => clientFactory(), method, rq, undefined, md);
  // Accept both accessor and plain field
  const msg = tryCall<string>(rsp, "getMessage") ?? (rsp?.message ?? "");
  return String(msg || "");
}

export interface IndexJsonObjectOptions {
  path?: string;         // if empty in backend, in-memory DB
  jsonStr: string;       // JSON string or JSON.stringify(obj)
  language?: string;     // e.g. "en"
  id?: string;           // ID of the object
  indexs?: string[];     // fields to index (proto uses 'indexs')
  data?: string;         // extra data (e.g., access path)
}

/** Index a JSON object (or array) into a given path/database. */
export async function indexJsonObject(opts: IndexJsonObjectOptions): Promise<void> {
  const md = await meta();
  const rq: any = newRq(SERVICE_METHODS.indexJsonObject.rq);

  // tolerant setters to codegen variants
  if (typeof rq.setPath === "function") rq.setPath(opts.path ?? "");
  else rq.path = opts.path ?? "";

  // jsonStr may be set as setJsonstr or setJsonStr depending on generator
  if (typeof rq.setJsonstr === "function") rq.setJsonstr(opts.jsonStr);
  else if (typeof rq.setJsonStr === "function") rq.setJsonStr(opts.jsonStr);
  else rq.jsonStr = opts.jsonStr;

  if (typeof rq.setLanguage === "function") rq.setLanguage(opts.language ?? "en");
  else rq.language = opts.language ?? "en";

  if (opts.id != null) {
    if (typeof rq.setId === "function") rq.setId(opts.id);
    else rq.id = opts.id;
  }

  if (Array.isArray(opts.indexs)) {
    if (typeof rq.setIndexsList === "function") rq.setIndexsList(opts.indexs);
    else rq.indexsList = opts.indexs;
  }

  if (opts.data != null) {
    if (typeof rq.setData === "function") rq.setData(opts.data);
    else rq.data = opts.data;
  }

  const method = SERVICE_METHODS.indexJsonObject.method[0];
  await unary(() => clientFactory(), method, rq, undefined, md);
}

/** Count documents in a given database/path. */
export async function count(path: string): Promise<number> {
  const md = await meta();
  const rq: any = newRq(SERVICE_METHODS.count.rq);
  if (typeof rq.setPath === "function") rq.setPath(path);
  else rq.path = path;

  const method = SERVICE_METHODS.count.method[0];
  const rsp: any = await unary(() => clientFactory(), method, rq, undefined, md);

  const result = tryCall<number>(rsp, "getResult") ?? (rsp?.result ?? 0);
  return Number(result || 0);
}

/** Delete a document by (path, id). */
export async function deleteDocument(path: string, id: string): Promise<void> {
  const md = await meta();
  const rq: any = newRq(SERVICE_METHODS.deleteDocument.rq);

  if (typeof rq.setPath === "function") rq.setPath(path);
  else rq.path = path;

  if (typeof rq.setId === "function") rq.setId(id);
  else rq.id = id;

  const method = SERVICE_METHODS.deleteDocument.method[0];
  await unary(() => clientFactory(), method, rq, undefined, md);
}

/** Ask the service to stop (admin/debug). */
export async function stop(): Promise<void> {
  const md = await meta();
  const rq: any = newRq(SERVICE_METHODS.stop.rq);
  const method = SERVICE_METHODS.stop.method[0];
  await unary(() => clientFactory(), method, rq, undefined, md);
}
