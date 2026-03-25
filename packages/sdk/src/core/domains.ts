/**
 * domains.ts — External domains and DNS provider management.
 *
 * CRUD operations for:
 *   - DNS providers    (GET/POST/DELETE /api/domains/providers)
 *   - Domain specs     (GET/POST/DELETE /api/domains/specs)
 */

import { requireBaseUrl } from './endpoints'

// ── Types ───────────────────────────────────────────────────────────────────

export interface DNSProviderConfig {
  name?: string       // etcd key, e.g. "cloudflare-app" (returned by server, optional on save)
  type: string        // "cloudflare" | "godaddy" | "route53" | "manual"
  zone: string
  credentials: Record<string, string>
  default_ttl: number
  timeout?: string    // Go duration, e.g. "30s" (optional)
}

export interface ACMEConfig {
  enabled: boolean
  email: string
  ca_url: string
  challenge_type: string  // "dns-01" | "http-01"
}

export interface IngressConfig {
  gateway_port_http: number
  gateway_port_https: number
}

export interface DomainCondition {
  type: string
  status: string   // "True" | "False" | "Unknown"
  reason: string
  message: string
  last_transition: string  // RFC3339
}

export interface ExternalDomainStatus {
  phase: string
  message: string
  current_ip: string
  cert_expiry: string
  conditions: DomainCondition[]
  last_reconcile: string
}

export interface ExternalDomainSpec {
  fqdn: string
  zone: string
  node_id: string
  target_ip: string
  provider_ref: string
  publish_external: boolean
  use_wildcard_cert: boolean
  ttl: number
  acme: ACMEConfig
  ingress: IngressConfig
}

export interface DomainSpecWithStatus extends ExternalDomainSpec {
  status?: ExternalDomainStatus
}

// ── Provider CRUD ───────────────────────────────────────────────────────────

/** GET /api/domains/providers — list all providers (credentials masked). */
export async function fetchProviders(): Promise<DNSProviderConfig[]> {
  const base = requireBaseUrl()
  const res = await fetch(`${base}/api/domains/providers`)
  if (!res.ok) throw new Error(`GET /api/domains/providers failed: ${res.status}`)
  return res.json() as Promise<DNSProviderConfig[]>
}

/** GET /api/domains/providers?name=<ref> — single provider (credentials masked). */
export async function fetchProvider(name: string): Promise<DNSProviderConfig> {
  const base = requireBaseUrl()
  const res = await fetch(`${base}/api/domains/providers?name=${encodeURIComponent(name)}`)
  if (!res.ok) throw new Error(`GET /api/domains/providers?name=${name} failed: ${res.status}`)
  return res.json() as Promise<DNSProviderConfig>
}

/** POST /api/domains/providers — create or update a provider. */
export async function saveProvider(cfg: DNSProviderConfig): Promise<{ ok: boolean; name: string }> {
  const base = requireBaseUrl()
  const res = await fetch(`${base}/api/domains/providers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as any).error || `POST /api/domains/providers failed: ${res.status}`)
  }
  return res.json() as Promise<{ ok: boolean; name: string }>
}

/** DELETE /api/domains/providers?name=<ref> — remove a provider. */
export async function deleteProvider(name: string): Promise<void> {
  const base = requireBaseUrl()
  const res = await fetch(`${base}/api/domains/providers?name=${encodeURIComponent(name)}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error(`DELETE /api/domains/providers failed: ${res.status}`)
}

// ── Domain spec CRUD ────────────────────────────────────────────────────────

/** GET /api/domains/specs — list all domain specs with status. */
export async function fetchDomainSpecs(): Promise<DomainSpecWithStatus[]> {
  const base = requireBaseUrl()
  const res = await fetch(`${base}/api/domains/specs`)
  if (!res.ok) throw new Error(`GET /api/domains/specs failed: ${res.status}`)
  return res.json() as Promise<DomainSpecWithStatus[]>
}

/** GET /api/domains/specs?fqdn=<fqdn> — single domain spec + status. */
export async function fetchDomainSpec(fqdn: string): Promise<{ spec: ExternalDomainSpec; status?: ExternalDomainStatus }> {
  const base = requireBaseUrl()
  const res = await fetch(`${base}/api/domains/specs?fqdn=${encodeURIComponent(fqdn)}`)
  if (!res.ok) throw new Error(`GET /api/domains/specs?fqdn=${fqdn} failed: ${res.status}`)
  return res.json() as Promise<{ spec: ExternalDomainSpec; status?: ExternalDomainStatus }>
}

/** POST /api/domains/specs — create or update a domain spec. */
export async function saveDomainSpec(spec: ExternalDomainSpec): Promise<{ ok: boolean; fqdn: string }> {
  const base = requireBaseUrl()
  const res = await fetch(`${base}/api/domains/specs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(spec),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as any).error || `POST /api/domains/specs failed: ${res.status}`)
  }
  return res.json() as Promise<{ ok: boolean; fqdn: string }>
}

/** DELETE /api/domains/specs?fqdn=<fqdn> — remove a domain spec. */
export async function deleteDomainSpec(fqdn: string): Promise<void> {
  const base = requireBaseUrl()
  const res = await fetch(`${base}/api/domains/specs?fqdn=${encodeURIComponent(fqdn)}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error(`DELETE /api/domains/specs failed: ${res.status}`)
}
