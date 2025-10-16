import { metadata } from "./auth"
import { serviceHost, serviceUrl } from "./endpoints"
import { normalizeError } from "./errors"
import * as grpcWeb from "grpc-web";

export interface UnaryOpts { timeoutMs?: number, base?: string }
export interface StreamOpts { base?: string }

/**
 * Call a unary grpc-web method.
 * - Forces withCredentials: false (when the client method supports per-call options).
 * - Falls back to the 3-arg signature if your generator doesn't support options.
 */
export function unary<RQ, RS>(
  factory: () => any,
  method: string,                 // e.g. "authenticate"
  request: RQ,
  _serviceFullName?: string,      // unused here, but kept for your existing calls
  md: Record<string, string> = {}
): Promise<RS> {
  const client = factory() as any;
  const fn = client[method];      // generated method (camelCase)

  if (typeof fn !== "function") {
    return Promise.reject(new Error(`RPC method not found on client: ${method}`));
  }

  return new Promise<RS>((resolve, reject) => {
    const callback = (err: grpcWeb.RpcError | null, resp?: RS) => {
      if (err) return reject(err);
      if (resp === undefined || resp === null) {
        return reject(new Error("empty response"));
      }
      resolve(resp);
    };

    try {
      // Some generators: (req, md, opts, cb)
      // Others:          (req, md, cb)
      if (fn.length >= 4) {
        fn.call(client, request, md, { withCredentials: false }, callback);
      } else {
        fn.call(client, request, md, callback);
      }
    } catch (e) {
      reject(e);
    }
  });
}

export async function stream<TReq, TMsg>(
  clientFactory: (addr: string) => any,
  methodName: string,
  req: TReq,
  onMsg: (m: TMsg) => void,
  serviceId: string,
  opts?: StreamOpts
): Promise<void> {
  const addr = serviceUrl(serviceId, opts?.base)
  const client = clientFactory(addr)
  const md = metadata()
  const call = client[methodName](req,  md )
  return new Promise<void>((resolve, reject) => {
    call.on('data', (m: TMsg) => onMsg(m))
    call.on('end', () => resolve())
    call.on('error', (e: any) => reject(normalizeError(e)))
  })
}
