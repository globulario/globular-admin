// globular: enforces ui.grpc_web_errors_must_surface_to_operator (normalizes errors for UI display)
export type GrpcWebError = Error & { code?: number; metadata?: any }
export function normalizeError(err: unknown): Error {
  const e = err as GrpcWebError
  if (e?.code !== undefined) {
    const msg = e.message || ''
    // Detect token/signature errors and return a user-friendly message.
    if (isTokenError(msg)) {
      const ne = new Error("Your session token is no longer valid. Please log out, log back in, and try again.")
      ;(ne as any).code = e.code
      return ne
    }
    const formatted = `[gRPC ${e.code}] ${msg}`
    const ne = new Error(formatted)
    ;(ne as any).code = e.code
    return ne
  }
  return e instanceof Error ? e : new Error(String(err))
}

/** Detect token/signature errors that mean the user needs to re-login. */
function isTokenError(msg: string): boolean {
  const m = msg.toLowerCase()
  return m.includes("signature is invalid")
    || m.includes("ed25519")
    || m.includes("invalid token")
    || (m.includes("401") && m.includes("token"))
}
