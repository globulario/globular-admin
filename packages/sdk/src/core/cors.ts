/**
 * cors.ts — CORS policy management for Globular services and the gateway.
 *
 * v2 (structured): GET/POST /api/cors-policy, /api/services-cors-policy, etc.
 * v1 (legacy):     GET /api/services-cors, POST /api/service-cors — kept for compat.
 */

import { requireBaseUrl } from './endpoints'

// ── Structured CORS types (v2) ──────────────────────────────────────────────

export interface CorsPolicy {
  enabled: boolean
  mode: string                // "gateway" | "inherit" | "override" | "disabled"
  allow_all_origins: boolean
  allowed_origins: string[]
  allow_credentials: boolean
  allowed_methods: string[]
  allowed_headers: string[]
  exposed_headers: string[]
  max_age_seconds: number
  allow_private_network: boolean
  grpc_web_enabled: boolean
}

export interface ServiceCorsPolicySummary {
  id: string
  name: string
  service: CorsPolicy
  effective: CorsPolicy
}

// ── v2 Gateway CORS ─────────────────────────────────────────────────────────

/** GET /api/cors-policy — structured gateway CORS policy. */
export async function fetchStructuredGatewayCorsPolicy(): Promise<CorsPolicy> {
  const base = requireBaseUrl()
  const res = await fetch(`${base}/api/cors-policy`)
  if (!res.ok) throw new Error(`GET /api/cors-policy failed: ${res.status}`)
  return res.json() as Promise<CorsPolicy>
}

/** POST /api/set-cors-policy — save structured gateway CORS policy. */
export async function saveStructuredGatewayCorsPolicy(policy: CorsPolicy): Promise<{ saved?: boolean; warnings?: string[] }> {
  const base = requireBaseUrl()
  const token = sessionStorage.getItem('__globular_token__') ?? ''
  const res = await fetch(`${base}/api/set-cors-policy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token },
    body: JSON.stringify(policy),
  })
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText)
    throw new Error(`POST /api/set-cors-policy failed (${res.status}): ${msg}`)
  }
  // 204 = success, 200 = success with warnings
  if (res.status === 200) {
    return res.json()
  }
  return {}
}

// ── v2 Per-service CORS ─────────────────────────────────────────────────────

/** GET /api/services-cors-policy — all services with effective policies. */
export async function fetchStructuredServicesCorsPolicy(): Promise<ServiceCorsPolicySummary[]> {
  const base = requireBaseUrl()
  const res = await fetch(`${base}/api/services-cors-policy`)
  if (!res.ok) throw new Error(`GET /api/services-cors-policy failed: ${res.status}`)
  return res.json() as Promise<ServiceCorsPolicySummary[]>
}

/** POST /api/set-service-cors-policy?id=... — save per-service CORS policy. */
export async function saveStructuredServiceCorsPolicy(id: string, policy: CorsPolicy): Promise<void> {
  const base = requireBaseUrl()
  const token = sessionStorage.getItem('__globular_token__') ?? ''
  const res = await fetch(`${base}/api/set-service-cors-policy?id=${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token },
    body: JSON.stringify(policy),
  })
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText)
    throw new Error(`POST /api/set-service-cors-policy failed (${res.status}): ${msg}`)
  }
}

// ── CORS Diagnostics ─────────────────────────────────────────────────────────

export interface CorsDiagResult {
  origin: string
  service_id: string
  allowed: boolean
  effective_policy: CorsPolicy
  enforcement_layer: string  // "gateway+envoy" | "service" | "disabled"
  warnings: string[]
  curl_example: string
}

/** GET /api/cors-diagnostics?origin=...&service=...&method=... */
export async function fetchCorsDiagnostics(origin: string, serviceId?: string, method?: string): Promise<CorsDiagResult> {
  const base = requireBaseUrl()
  const params = new URLSearchParams()
  if (origin) params.set('origin', origin)
  if (serviceId) params.set('service', serviceId)
  if (method) params.set('method', method)
  const res = await fetch(`${base}/api/cors-diagnostics?${params}`)
  if (!res.ok) throw new Error(`GET /api/cors-diagnostics failed: ${res.status}`)
  return res.json() as Promise<CorsDiagResult>
}

// ── Legacy types (v1) — kept for backward compatibility ─────────────────────

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
