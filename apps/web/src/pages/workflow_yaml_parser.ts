// src/pages/workflow_yaml_parser.ts
// Parses Globular workflow YAML files into typed WorkflowDef objects.
// Used to load definitions from MinIO (via workflow service) at runtime
// instead of hardcoding them.

import { load as yamlLoad } from 'js-yaml'
import type { WorkflowDef, StepDef, HandlerDef, RunFilter } from './workflow_defs'

interface RawYaml {
  metadata?: {
    name?: string
    displayName?: string
    description?: string
  }
  spec?: {
    steps?: any[]
    onFailure?: any
    onSuccess?: any
  }
}

export function parseWorkflowYaml(yamlText: string): WorkflowDef | null {
  if (!yamlText.trim()) return null
  let raw: RawYaml
  try {
    raw = yamlLoad(yamlText) as RawYaml
  } catch (e) {
    console.error('parseWorkflowYaml: invalid YAML', e)
    return null
  }
  if (!raw?.metadata?.name) return null

  const def: WorkflowDef = {
    name: raw.metadata.name,
    displayName: raw.metadata.displayName ?? raw.metadata.name,
    description: (raw.metadata.description ?? '').trim().replace(/\s+/g, ' '),
    steps: (raw.spec?.steps ?? []).map(parseStep),
    onFailure: parseHandler(raw.spec?.onFailure),
    onSuccess: parseHandler(raw.spec?.onSuccess),
    runFilter: inferRunFilter(raw.metadata.name),
  }
  return def
}

function parseStep(raw: any): StepDef {
  const s: StepDef = {
    id: raw.id ?? '',
    title: raw.title ?? raw.id ?? '',
    actor: raw.actor ?? '',
    action: raw.action ?? '',
  }
  if (raw.dependsOn) {
    s.dependsOn = Array.isArray(raw.dependsOn) ? raw.dependsOn : [raw.dependsOn]
  }
  if (raw.when) {
    s.when = {}
    if (typeof raw.when.expr === 'string') s.when.expr = raw.when.expr
    if (Array.isArray(raw.when.anyOf)) {
      s.when.anyOf = raw.when.anyOf.map((c: any) => typeof c === 'string' ? c : (c.expr ?? ''))
    }
  }
  if (raw.foreach) {
    s.foreach = {
      collection: typeof raw.foreach === 'string' ? raw.foreach : (raw.foreach.collection ?? ''),
      itemName: raw.itemName ?? 'item',
    }
    if (raw.strategy) {
      s.foreach.strategy = {
        mode: raw.strategy.mode ?? 'sequential',
        concurrency: raw.strategy.concurrency ? String(raw.strategy.concurrency) : undefined,
      }
    }
  }
  if (raw.steps) s.steps = raw.steps.map(parseStep)
  if (raw.retry) {
    s.retry = {
      maxAttempts: Number(raw.retry.maxAttempts ?? 1),
      backoff: String(raw.retry.backoff ?? '1s'),
    }
  }
  if (raw.timeout) s.timeout = String(raw.timeout)
  if (raw.export) s.export = String(raw.export)
  if (raw.onFailure) s.onFailure = parseHandler(raw.onFailure)
  return s
}

function parseHandler(raw: any): HandlerDef | undefined {
  if (!raw) return undefined
  return {
    actor: raw.actor ?? '',
    action: raw.action ?? '',
    title: raw.title,
  }
}

/** Infer a runFilter for legacy runs based on the workflow name. */
function inferRunFilter(name: string): RunFilter | undefined {
  switch (name) {
    case 'node.bootstrap':
      return { correlationPrefix: 'bootstrap/', triggerReason: 2 }
    case 'node.join':
      return { correlationPrefix: 'join/' }
    case 'node.repair':
      return { correlationPrefix: 'repair/' }
    case 'release.apply.package':
      return { releaseKind: 'ServiceRelease' }
    case 'release.apply.infrastructure':
      return { releaseKind: 'InfrastructureRelease' }
    case 'release.remove.package':
      return { correlationPrefix: 'remove/' }
    case 'cluster.reconcile':
      return { correlationPrefix: 'reconcile/' }
    // day0.bootstrap: no runFilter — only match by exact workflow_name
    default:
      return undefined
  }
}
