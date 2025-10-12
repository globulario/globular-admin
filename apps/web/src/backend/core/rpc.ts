import { metadata } from "./auth"
import { serviceUrl } from "./endpoints"
import { normalizeError } from "./errors"

export interface UnaryOpts { timeoutMs?: number, base?: string }
export interface StreamOpts { base?: string }

export async function unary<TReq, TRsp>(
  clientFactory: (addr: string) => any,
  methodName: string,
  req: TReq,
  serviceId: string,
  opts?: UnaryOpts
): Promise<TRsp> {
  const addr = serviceUrl(serviceId, opts?.base)
  const client = clientFactory(addr)
  return new Promise<TRsp>((resolve, reject) => {
    const md = metadata()
    const deadline = opts?.timeoutMs ? Date.now() + opts.timeoutMs : undefined
    const callOpts: any = { 'customHeaders': md }
    if (deadline) callOpts.deadline = deadline
    client[methodName](req, callOpts, (err: any, res: TRsp) => {
      if (err) return reject(normalizeError(err))
      resolve(res)
    })
  })
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
  const call = client[methodName](req, { 'customHeaders': md })
  return new Promise<void>((resolve, reject) => {
    call.on('data', (m: TMsg) => onMsg(m))
    call.on('end', () => resolve())
    call.on('error', (e: any) => reject(normalizeError(e)))
  })
}
