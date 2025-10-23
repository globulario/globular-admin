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
 * Core API
 * ------------------------------------------------------------------ */

const SERVICE_METHODS = {
  searchDocuments: { method: ["searchDocuments"], rq: ["SearchDocumentsRequest"] },
} as const;

/**
 * Stream search results. You get each chunk as soon as it arrives.
 * Returns a function to cancel/close the stream.
 */
export async function searchDocumentsStream(
  opts: SearchQueryOptions,
  onBatch: (batch: SearchDocumentVM[]) => void,
  onEnd?: () => void,
  onError?: (err: any) => void
): Promise<() => void> {
  const md = await meta();

  const rq: any = newRq(SERVICE_METHODS.searchDocuments.rq);
  if (typeof rq.setPathsList === "function") rq.setPathsList(opts.paths ?? []);
  if (typeof rq.setLanguage === "function") rq.setLanguage(opts.language ?? "en");
  if (typeof rq.setFieldsList === "function") rq.setFieldsList(opts.fields ?? ["Text"]);
  if (typeof rq.setOffset === "function") rq.setOffset(opts.offset ?? 0);
  if (typeof rq.setPagesize === "function") rq.setPagesize(opts.pageSize ?? 100);
  if (typeof rq.setQuery === "function") rq.setQuery(opts.query ?? "");

  // Some gateways require forwarding an application header for routing
  const mdWithApp = {
    ...md,
    ...(opts.application ? { application: opts.application } : {}),
  };

  // We rely on stream() helper to manage the gRPC-web stream.
  const cancel = await stream(
    clientFactory,
    SERVICE_METHODS.searchDocuments.method[0],
    rq,
    (msg: any) => {
      // The protobuf response typically contains a Results message:
      // rsp.getResults().getResultsList()
      const resultsContainer =
        tryCall<any>(msg, "getResults") ?? (msg?.results ?? undefined);

      const list =
        (resultsContainer &&
          (tryCall<any[]>(resultsContainer, "getResultsList") ??
            resultsContainer.resultsList ??
            resultsContainer.results)) ||
        [];

      if (!Array.isArray(list) || list.length === 0) {
        onBatch([]);
        return;
      }

      const batch: SearchDocumentVM[] = list.map((it: any) => {
        const rank = Number(
          tryCall<number>(it, "getRank") ?? it?.rank ?? 0
        );
        const dataJson =
          tryCall<string>(it, "getData") ?? it?.data ?? "{}";
        const snippetJson =
          tryCall<string>(it, "getSnippet") ?? it?.snippet ?? "{}";
        let doc: any | undefined;
        let snippet: SearchDocumentSnippetVM | undefined;
        try {
          doc = JSON.parse(dataJson);
        } catch {}
        try {
          snippet = JSON.parse(snippetJson);
        } catch {}
        return { rank, dataJson, snippetJson, doc, snippet };
      });

      onBatch(batch);
    },
    "search.SearchService",
    mdWithApp,
    onEnd,
    onError
  );

  return cancel;
}

/**
 * Convenience helper: collect all streamed results and return them as a single array.
 */
export async function searchDocuments(opts: SearchQueryOptions): Promise<SearchDocumentVM[]> {
  return new Promise<SearchDocumentVM[]>(async (resolve, reject) => {
    const all: SearchDocumentVM[] = [];
    let cancel: (() => void) | null = null;

    try {
      cancel = await searchDocumentsStream(
        opts,
        (batch) => {
          if (Array.isArray(batch) && batch.length) all.push(...batch);
        },
        () => resolve(all),
        (err) => reject(err)
      );
    } catch (e) {
      reject(e);
    }

    // Optional: return a cancel handle somehow if you want external cancel; for now
    // the promise resolves on stream end.
  });
}

