import { getBaseUrl } from "../core/endpoints";
import { unary, stream } from "../core/rpc";

import { PersistenceServiceClient } from "globular-web-client/persistence/persistence_grpc_web_pb";
import * as persistencepb from "globular-web-client/persistence/persistence_pb";

const SERVICE_NAME = "persistence.PersistenceService";
type ByteArray = Uint8Array<ArrayBufferLike>;

function clientFactory(base?: string): PersistenceServiceClient {
  const url = base ?? getBaseUrl() ?? "";
  return new PersistenceServiceClient(url, null, { withCredentials: true });
}

async function meta(): Promise<Record<string, string>> {
  try {
    const token = sessionStorage.getItem("__globular_token__");
    return token ? { token } : {};
  } catch {
    return {};
  }
}

function newRq(names: readonly string[]): any {
  for (const n of names) {
    const Ctor: any = (persistencepb as any)[n];
    if (typeof Ctor === "function") return new Ctor();
  }
  return {};
}

function concatBytes(a: ByteArray, b: ByteArray): ByteArray {
  if (!a || a.length === 0) return b;
  if (!b || b.length === 0) return a;
  const out = new Uint8Array(a.length + b.length) as ByteArray;
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export interface PersistenceBaseInput {
  connectionId: string;
  database: string;
  collection: string;
}

export interface FindDocumentsOptions extends PersistenceBaseInput {
  query?: string;
  options?: string;
}

export interface ReplaceOneOptions extends PersistenceBaseInput {
  query: string;
  value: string;
  options?: string;
}

export interface DeleteOneOptions extends PersistenceBaseInput {
  query: string;
  options?: string;
}

export async function findDocuments<T = any>(opts: FindDocumentsOptions): Promise<T[]> {
  const rq = newRq(["FindRqst"]) as persistencepb.FindRqst;
  rq.setId(opts.connectionId);
  rq.setDatabase(opts.database);
  rq.setCollection(opts.collection);
  rq.setQuery(opts.query ?? "{}");
  if (opts.options) rq.setOptions(opts.options);

  let buffer = new Uint8Array() as ByteArray;

  await stream(
    clientFactory as unknown as (addr: string) => any,
    "find",
    rq,
    (resp: persistencepb.FindResp) => {
      const chunk = extractData(resp);
      if (chunk.length > 0) {
        buffer = concatBytes(buffer, chunk);
      }
    },
    SERVICE_NAME
  );

  if (!buffer.length) return [];

  const decoded = new TextDecoder().decode(buffer);
  if (!decoded) return [];

  try {
    const data = JSON.parse(decoded);
    return Array.isArray(data) ? data : [];
  } catch (err: any) {
    throw new Error(`Failed to parse persistence results: ${err?.message || err}`);
  }
}

function extractData(resp?: persistencepb.FindResp): ByteArray {
  if (!resp) return new Uint8Array() as ByteArray;
  if (typeof resp.getData_asU8 === "function") {
    const arr = resp.getData_asU8();
    return arr ? (arr as unknown as ByteArray) : (new Uint8Array() as ByteArray);
  }
  const raw: any = typeof resp.getData === "function" ? resp.getData() : undefined;
  if (!raw) return new Uint8Array() as ByteArray;
  if (raw instanceof Uint8Array) return raw as unknown as ByteArray;
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw) as ByteArray;
  if (ArrayBuffer.isView(raw)) {
    const view = raw as ArrayBufferView;
    return new Uint8Array(view.buffer as ArrayBuffer, view.byteOffset, view.byteLength) as ByteArray;
  }
  if (Array.isArray(raw)) return new Uint8Array(raw) as ByteArray;
  if (typeof raw === "string") return new TextEncoder().encode(raw) as ByteArray;
  return new Uint8Array() as ByteArray;
}

export async function replaceOneDocument(opts: ReplaceOneOptions): Promise<void> {
  const md = await meta();
  const rq = newRq(["ReplaceOneRqst"]) as persistencepb.ReplaceOneRqst;
  rq.setId(opts.connectionId);
  rq.setDatabase(opts.database);
  rq.setCollection(opts.collection);
  rq.setQuery(opts.query);
  rq.setValue(opts.value);
  if (opts.options) rq.setOptions(opts.options);

  await unary(() => clientFactory(), "replaceOne", rq, undefined, md);
}

export async function deleteOneDocument(opts: DeleteOneOptions): Promise<void> {
  const md = await meta();
  const rq = newRq(["DeleteOneRqst"]) as persistencepb.DeleteOneRqst;
  rq.setId(opts.connectionId);
  rq.setDatabase(opts.database);
  rq.setCollection(opts.collection);
  rq.setQuery(opts.query);
  if (opts.options) rq.setOptions(opts.options);

  await unary(() => clientFactory(), "deleteOne", rq, undefined, md);
}
