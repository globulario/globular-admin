// packages/backend/src/core/upgrades.ts
//
// TypeScript types + fetch functions for the /admin/upgrades/* endpoints.

// ─── Response types ─────────────────────────────────────────────────────────

export interface UpgradesStatusResponse {
  now_unix_ms: number
  node: string
  platform: string
  services: ServiceUpgradeInfo[]
  summary: UpgradesSummary
  repository_status: string // ok | unreachable | empty
}

export interface ServiceUpgradeInfo {
  name: string
  display_name: string
  category: string
  installed_version: string
  installed_build_number?: number
  latest_version: string
  latest_build_number?: number
  update_available: boolean
  state: string
  derived_status: string // healthy | degraded | critical | unknown
  port: number
}

export interface UpgradesSummary {
  total_installed: number
  updates_available: number
  up_to_date: number
  unknown: number
}

// ─── Plan / Apply / Job types ───────────────────────────────────────────────

export interface UpgradePlanRequest {
  services: string[]
}

export interface UpgradePlanResponse {
  plan: UpgradePlanItem[]
}

export interface UpgradePlanItem {
  service: string
  from: string
  from_build_number?: number
  to: string
  to_build_number?: number
  package: string
  restart_required: boolean
  impacts?: string[]
}

export interface UpgradeApplyRequest {
  services: string[]
}

export interface UpgradeApplyResponse {
  ok: boolean
  operation_id: string
  message: string
  node_statuses?: NodeUpgradeStatus[] // per-node results for cluster-wide upgrades
}

export interface NodeUpgradeStatus {
  node_id: string
  status: string  // pending | running | success | failed
  operation_id: string
  error?: string
}

export interface UpgradeJobResponse {
  operation_id: string
  status: string // pending | running | success | failed | rolling_back | rolled_back
  steps: UpgradeJobStep[]
  progress: number // 0-100
  error?: string
}

export interface UpgradeJobStep {
  id: string
  state: string // pending | running | ok | failed | skipped
  message?: string
}

// ─── Fetch functions ────────────────────────────────────────────────────────

import { getBaseUrl } from "./endpoints"

function base_(b?: string): string { return b ?? getBaseUrl() ?? '' }

export async function fetchUpgradesStatus(base?: string): Promise<UpgradesStatusResponse> {
  const resp = await fetch(`${base_(base)}/admin/upgrades/status`)
  if (!resp.ok) throw new Error(`admin/upgrades/status: HTTP ${resp.status}`)
  return resp.json()
}

export async function fetchUpgradePlan(services: string[], base?: string): Promise<UpgradePlanResponse> {
  const resp = await fetch(`${base_(base)}/admin/upgrades/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ services } as UpgradePlanRequest),
  })
  if (!resp.ok) throw new Error(`admin/upgrades/plan: HTTP ${resp.status}`)
  return resp.json()
}

export async function applyUpgrades(services: string[], base?: string): Promise<UpgradeApplyResponse> {
  const resp = await fetch(`${base_(base)}/admin/upgrades/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ services } as UpgradeApplyRequest),
  })
  if (!resp.ok) throw new Error(`admin/upgrades/apply: HTTP ${resp.status}`)
  return resp.json()
}

export async function fetchUpgradeJobStatus(operationId: string, base?: string): Promise<UpgradeJobResponse> {
  const resp = await fetch(`${base_(base)}/admin/upgrades/jobs?id=${encodeURIComponent(operationId)}`)
  if (!resp.ok) throw new Error(`admin/upgrades/jobs: HTTP ${resp.status}`)
  return resp.json()
}

// ─── History types ──────────────────────────────────────────────────────────

export interface UpgradeHistoryResponse {
  jobs: UpgradeJobRecord[]
}

export interface UpgradeJobRecord {
  operation_id: string
  started_at: number  // unix ms
  finished_at: number // unix ms, 0 if still running
  status: string      // running | success | failed | rolled_back
  services: UpgradeJobRecordService[]
  error?: string
  issued_by: string
}

export interface UpgradeJobRecordService {
  name: string
  from: string
  from_build_number?: number
  to: string
  to_build_number?: number
}

export async function fetchUpgradeHistory(limit = 50, base?: string): Promise<UpgradeHistoryResponse> {
  const resp = await fetch(`${base_(base)}/admin/upgrades/history?limit=${limit}`)
  if (!resp.ok) throw new Error(`admin/upgrades/history: HTTP ${resp.status}`)
  return resp.json()
}
