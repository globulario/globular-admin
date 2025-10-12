export type GrpcWebError = Error & { code?: number; metadata?: any }
export function normalizeError(err: unknown): Error {
  const e = err as GrpcWebError
  if (e?.code !== undefined) {
    const msg = `[gRPC ${e.code}] ${e.message}`
    const ne = new Error(msg)
    ;(ne as any).code = e.code
    return ne
  }
  return e instanceof Error ? e : new Error(String(err))
}
