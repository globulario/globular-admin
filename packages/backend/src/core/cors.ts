/**
 * cors.ts — CORS policy management for Globular services and the gateway.
 *
 * Per-service CORS: uses plain HTTP — GET /api/services-cors to read,
 *                   POST /api/service-cors to write. No gRPC / no ScyllaDB needed.
 * Gateway CORS:     uses plain HTTP — GET /config to read, POST /api/save-config to write.
 *
 * The gateway stores AllowedOrigins as a []string (not comma-separated).
 * ["*"] is normalised to allowAllOrigins:true; saving allowAllOrigins:true writes ["*"].
 */

import { requireBaseUrl } from './endpoints'

export interface ServiceCorsPolicy {
  id: string
  name: string
  allowAllOrigins: boolean
  allowedOrigins: string // comma-separated list
}

export interface GatewayCorsPolicy {
  allowAllOrigins: boolean
  allowedOrigins: string // comma-separated list
}

/**
 * Retrieve the CORS policy for every registered Globular service.
 * Uses GET /api/services-cors (no auth required).
 */
export async function fetchCorsPolicies(): Promise<ServiceCorsPolicy[]> {
  const base = requireBaseUrl()
  const res = await fetch(`${base}/api/services-cors`)
  if (!res.ok) throw new Error(`GET /api/services-cors failed: ${res.status}`)
  return res.json() as Promise<ServiceCorsPolicy[]>
}

/**
 * Persist a new CORS policy for a single service.
 * Uses POST /api/service-cors with JWT token header (no ScyllaDB dependency).
 * The service auto-reloads from etcd — no restart required.
 */
export async function saveServiceCorsPolicy(
  id: string,
  allowAllOrigins: boolean,
  allowedOrigins: string
): Promise<void> {
  const base = requireBaseUrl()
  const token = sessionStorage.getItem('__globular_token__') ?? ''
  const res = await fetch(`${base}/api/service-cors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token },
    body: JSON.stringify({ id, allowAllOrigins, allowedOrigins }),
  })
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText)
    throw new Error(`POST /api/service-cors failed (${res.status}): ${msg}`)
  }
}

// ── Gateway CORS (plain HTTP) ─────────────────────────────────────────────────

/**
 * Read the gateway's CORS policy from GET /config.
 * AllowedOrigins is a []string on the gateway; ["*"] means allow-all.
 */
export async function fetchGatewayCorsPolicy(): Promise<GatewayCorsPolicy> {
  const base = requireBaseUrl()
  const res = await fetch(`${base}/config`)
  if (!res.ok) throw new Error(`GET /config failed: ${res.status}`)
  const cfg = await res.json() as Record<string, unknown>

  const raw = cfg['AllowedOrigins']
  const origins: string[] = Array.isArray(raw) ? raw.map(String) : []
  const allowAll = origins.length === 0 || origins.includes('*')
  const allowedOrigins = allowAll ? '' : origins.join(',')

  return { allowAllOrigins: allowAll, allowedOrigins }
}

/**
 * Persist gateway CORS via POST /api/save-config.
 * Requires the session token in the "token" header.
 */
export async function saveGatewayCorsPolicy(
  allowAllOrigins: boolean,
  allowedOrigins: string
): Promise<void> {
  const base = requireBaseUrl()
  const token = sessionStorage.getItem('__globular_token__') ?? ''

  const origins: string[] = allowAllOrigins
    ? ['*']
    : allowedOrigins.split(',').map(s => s.trim()).filter(Boolean)

  const res = await fetch(`${base}/api/save-config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token },
    body: JSON.stringify({ AllowedOrigins: origins }),
  })
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText)
    throw new Error(`POST /api/save-config failed (${res.status}): ${msg}`)
  }
}
