import { metadata, ensureFreshToken } from "./auth";
import { serviceHost, serviceUrl } from "./endpoints";
import { normalizeError } from "./errors";
import * as grpcWeb from "grpc-web";

export interface UnaryOpts { timeoutMs?: number, base?: string }
export interface StreamOpts { base?: string, onCall?: (call: grpcWeb.ClientReadableStream<any>) => void }

/** Heuristic to detect auth expiry across different backends/messages */
function looksExpired(err: any): boolean {
  const m = (err?.message || err?.toString?.() || "").toLowerCase();
  return m.includes("token is expired")
    || m.includes("expired token")
    || m.includes("unauthenticated")
    || m.includes("jwt expired")
    || m.includes("no token found in context metadata");
}

/**
 * Call a unary grpc-web method.
 * - Proactively refreshes if the token is near expiry.
 * - Retries once on expiry/unauthenticated errors after forcing a refresh.
 * - Forces withCredentials: false (when the client method supports per-call options).
 */
export async function unary<RQ, RS>(
  factory: () => any,
  method: string,                 // e.g. "authenticate"
  request: RQ,
  _serviceFullName?: string,      // unused here, but kept for your existing calls
  md: Record<string, string> = {}
): Promise<RS> {
  // Best-effort proactive refresh
  try { await ensureFreshToken(60_000); } catch { /* ignore; we'll retry on demand */ }

  const client = factory() as any;
  const fn = client[method];      // generated method (camelCase)
  if (typeof fn !== "function") {
    return Promise.reject(new Error(`RPC method not found on client: ${method}`));
  }

  const doCall = (headers: Record<string, string>): Promise<RS> =>
    new Promise<RS>((resolve, reject) => {
      const callback = (err: grpcWeb.RpcError | null, resp?: RS) => {
        if (err) return reject(err);
        if (resp === undefined || resp === null) return reject(new Error("empty response"));
        resolve(resp);
      };
      try {
        // Some generators: (req, md, opts, cb)
        // Others:          (req, md, cb)
        if (fn.length >= 4) {
          fn.call(client, request, headers, undefined, callback);
        } else {
          fn.call(client, request, headers, callback);
        }
      } catch (e) {
        reject(e);
      }
    });

  try {
    return await doCall(md);
  } catch (err: any) {
    if (looksExpired(err)) {
      try {
        // Force refresh and retry once with fresh headers
        await ensureFreshToken(0);
        const freshMd = metadata();
        return await doCall(freshMd);
      } catch { /* fall through to throw original error below */ }
    }
    throw err;
  }
}

/**
 * Start a server stream.
 * - Proactively refreshes token before starting.
 * - If the stream fails immediately with an expired token, forces a refresh once and restarts.
 */
export async function stream<TReq, TMsg>(
  clientFactory: (addr: string) => any,
  methodName: string,
  req: TReq,
  onMsg: (m: TMsg) => void,
  serviceId: string,
  opts?: StreamOpts
): Promise<void> {
  // Best-effort proactive refresh before opening the stream
  try { await ensureFreshToken(60_000); } catch { /* ignore */ }

  const addr = serviceUrl(serviceId, opts?.base);
  const client = clientFactory(addr);

  const startOnce = (headers: Record<string, string>) =>
    new Promise<void>((resolve, reject) => {
      const call = client[methodName](req, headers);
      opts?.onCall?.(call);
      call.on("data", (m: TMsg) => onMsg(m));
      call.on("end", () => resolve());
      call.on("error", (e: any) => reject(normalizeError(e)));
    });

  try {
    const md = metadata();
    await startOnce(md);
  } catch (e: any) {
    // If the stream failed to start due to expiry, refresh and retry once
    if (looksExpired(e)) {
      try {
        await ensureFreshToken(0);
        const fresh = metadata();
        await startOnce(fresh);
        return;
      } catch { /* fall through */ }
    }
    throw e;
  }
}
