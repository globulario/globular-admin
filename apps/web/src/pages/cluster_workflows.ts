// src/pages/cluster_workflows.ts
// Cluster Workflows — horizontal swimlane blueprint from YAML definitions + runtime overlay.

import {
  listWorkflowRuns,
  getWorkflowRun,
  diagnoseWorkflowRun,
  retryWorkflowRun,
  acknowledgeWorkflowRun,
  runStatusLabel,
  runStatusColor,
  type WorkflowRun,
  type WorkflowStep,
  type DiagnoseResult,
} from '@globular/sdk'

function triggerReasonLabel(t: number): string {
  const labels: Record<number, string> = { 0: 'UNKNOWN', 1: 'DESIRED_DRIFT', 2: 'BOOTSTRAP', 3: 'RETRY', 4: 'MANUAL', 5: 'DEPENDENCY_UNBLOCKED', 6: 'UPGRADE', 7: 'REPAIR' }
  return labels[t] ?? 'UNKNOWN'
}
function triggerReasonColor(t: number): string {
  switch (t) { case 2: return '#8b5cf6'; case 7: return '#f59e0b'; case 1: return '#3b82f6'; case 6: return '#10b981'; case 3: return '#f97316'; default: return 'var(--secondary-text-color)' }
}

import { type WorkflowDef, type StepDef } from './workflow_defs'
import { listWorkflowDefinitions, getWorkflowDefinition } from '@globular/sdk'
import { parseWorkflowYaml } from './workflow_yaml_parser'

// ─── Actor colors ───────────────────────────────────────────────────────────

const ACTOR_COLORS: Record<string, string> = {
  'cluster-controller': '#6366f1', 'repository': '#8b5cf6', 'node-agent': '#3b82f6',
  'installer': '#10b981', 'runtime': '#f59e0b', 'operator': '#ec4899',
  'workflow-service': '#a855f7', 'ai-diagnoser': '#14b8a6', 'ai-executor': '#f97316',
}
function actorColor(a: string): string { return ACTOR_COLORS[a] ?? '#6b7280' }

// ─── Horizontal DAG layout ─────────────────────────────────────────────────
// Pools = horizontal rows (one per actor). Steps flow left-to-right.
// Level = column position (assigned by topological BFS on dependsOn).

function assignLevels(steps: StepDef[]): Map<string, number> {
  const byId = new Map<string, StepDef>()
  for (const s of steps) byId.set(s.id, s)
  const inDeg = new Map<string, number>()
  for (const s of steps) inDeg.set(s.id, 0)
  for (const s of steps) for (const d of s.dependsOn ?? []) if (byId.has(d)) inDeg.set(s.id, (inDeg.get(s.id) ?? 0) + 1)
  const level = new Map<string, number>()
  const q: string[] = []
  for (const s of steps) if ((inDeg.get(s.id) ?? 0) === 0) { q.push(s.id); level.set(s.id, 0) }
  while (q.length) {
    const c = q.shift()!; const cl = level.get(c)!
    for (const s of steps) if (s.dependsOn?.includes(c)) {
      level.set(s.id, Math.max(level.get(s.id) ?? 0, cl + 1))
      inDeg.set(s.id, (inDeg.get(s.id) ?? 1) - 1)
      if (inDeg.get(s.id) === 0) q.push(s.id)
    }
  }
  return level
}

// ─── SVG constants ──────────────────────────────────────────────────────────

const BOX_W = 164, BOX_H = 44, BOX_R = 7
const COL_GAP = 24, STACK_GAP = 6
const POOL_LABEL_W = 120, PAD = 12
const CIRCLE_R = 14

interface Pos { id: string; x: number; y: number; cx: number; cy: number; w: number; h: number }

// ─── Build horizontal SVG ───────────────────────────────────────────────────

/** Flatten definition steps in execution order (top-level, then nested foreach steps). */
function flattenDefSteps(def: WorkflowDef): StepDef[] {
  const result: StepDef[] = []
  for (const s of def.steps) {
    result.push(s)
    if (s.steps) for (const ns of s.steps) result.push(ns)
  }
  return result
}

/**
 * Build runtime map keyed by definition step ID.
 * Strategy: index by stepKey, title, AND seq-based positional match.
 * The seq match handles legacy runs where stepKey differs from YAML IDs.
 *
 * When no runtime steps are returned (e.g. step recording was unavailable),
 * synthesize step status from the overall run status so the diagram still
 * shows green/red coloring.
 */
function buildRtMap(rtSteps: WorkflowStep[], def: WorkflowDef, runStatus?: number): Map<string, WorkflowStep> {
  const map = new Map<string, WorkflowStep>()

  if (rtSteps.length === 0 && runStatus !== undefined && runStatus >= 8) {
    // No step data available — infer from run status.
    // RunStatus: 8=SUCCEEDED, 9=FAILED, 10=CANCELED, 11=ROLLED_BACK
    const syntheticStepStatus = runStatus === 8 ? 3 : 4 // StepStatus: 3=SUCCEEDED, 4=FAILED
    const defFlat = flattenDefSteps(def)
    for (const ds of defFlat) {
      const synth: WorkflowStep = {
        runId: '', seq: 0, stepKey: ds.id, title: ds.title,
        actor: 0, phase: 0, status: syntheticStepStatus, attempt: 1,
        sourceActor: 0, targetActor: 0, startedAt: '', finishedAt: '',
        durationMs: 0, message: '', errorCode: '', errorMessage: '',
        retryable: false, operatorActionRequired: false, actionHint: '', detailsJson: '',
      }
      map.set(ds.id, synth)
      if (ds.title !== ds.id) map.set(ds.title, synth)
    }
    return map
  }

  // Primary: key by stepKey and title
  for (const s of rtSteps) {
    map.set(s.stepKey, s)
    if (s.title && s.title !== s.stepKey) map.set(s.title, s)
  }
  // Seq-based positional match: sort runtime by seq, match to flattened def order
  const defFlat = flattenDefSteps(def)
  const rtSorted = [...rtSteps].sort((a, b) => a.seq - b.seq)
  // StepStatus enum: 1=PENDING, 2=RUNNING, 3=SUCCEEDED, 4=FAILED, 5=SKIPPED
  // Handler steps use status=5 (SKIPPED)
  const rtReal = rtSorted.filter(s => s.status !== 5)
  const rtHandler = rtSorted.find(s => s.status === 5 && (s.errorCode || s.errorMessage))
  const matchCount = Math.min(defFlat.length, rtReal.length)

  // Propagate handler error details to the last failed step (if not already present)
  for (let i = 0; i < matchCount; i++) {
    const defStep = defFlat[i]
    let rtStep = rtReal[i]

    // If this is a failed step and we have handler error details, propagate them
    if (rtStep.status === 4 && rtHandler) {
      rtStep = { ...rtStep }
      if (!rtStep.errorCode && rtHandler.errorCode) rtStep.errorCode = rtHandler.errorCode
      if (!rtStep.errorMessage && rtHandler.errorMessage) rtStep.errorMessage = rtHandler.errorMessage
      if (!rtStep.message && rtHandler.message) rtStep.message = rtHandler.message
      if (!rtStep.actionHint && rtHandler.actionHint) rtStep.actionHint = rtHandler.actionHint
    }

    if (!map.has(defStep.id)) map.set(defStep.id, rtStep)
    if (!map.has(defStep.title)) map.set(defStep.title, rtStep)
  }
  return map
}

/** Look up runtime step by id, then fallback to title */
function rtLookup(rtMap: Map<string, WorkflowStep>, step: StepDef): WorkflowStep | undefined {
  return rtMap.get(step.id) ?? rtMap.get(step.title)
}

function buildHorizontalSvg(
  def: WorkflowDef,
  rtMap: Map<string, WorkflowStep>,
  selectedId: string,
): { svg: string; width: number; height: number } {

  _channelCount.clear()

  const actors: string[] = []
  function collectActors(steps: StepDef[]) {
    for (const s of steps) { if (!actors.includes(s.actor)) actors.push(s.actor); if (s.steps) collectActors(s.steps) }
  }
  collectActors(def.steps)
  if (def.onFailure && !actors.includes(def.onFailure.actor)) actors.push(def.onFailure.actor)
  if (def.onSuccess && !actors.includes(def.onSuccess.actor)) actors.push(def.onSuccess.actor)

  const levels = assignLevels(def.steps)
  const maxLevel = Math.max(0, ...Array.from(levels.values()))

  // Foreach expansion tracking
  const colExpansion = new Map<number, { feStep: StepDef; nestedLevels: Map<string, number>; maxNested: number }>()
  for (const s of def.steps) {
    if (s.foreach && s.steps?.length) {
      const lv = levels.get(s.id) ?? 0
      const nl = assignLevels(s.steps); const mn = Math.max(0, ...Array.from(nl.values()))
      colExpansion.set(lv, { feStep: s, nestedLevels: nl, maxNested: mn })
    }
  }

  let totalCols = 0
  const colStart = new Map<number, number>()
  for (let lv = 0; lv <= maxLevel; lv++) {
    colStart.set(lv, totalCols)
    const fe = colExpansion.get(lv); totalCols += fe ? (fe.maxNested + 1) : 1
  }
  totalCols += 1 // terminal circles

  // Compute stacking: count how many top-level steps share (level, actor)
  const cellCount = new Map<string, number>() // "level:actor" → count
  for (const s of def.steps) {
    const lv = levels.get(s.id) ?? 0
    const key = `${lv}:${s.actor}`
    cellCount.set(key, (cellCount.get(key) ?? 0) + 1)
  }
  // Max stack per actor pool
  const actorMaxStack = new Map<string, number>()
  for (const a of actors) actorMaxStack.set(a, 1)
  for (const [key, count] of cellCount) {
    const actor = key.split(':')[1]
    actorMaxStack.set(actor, Math.max(actorMaxStack.get(actor) ?? 1, count))
  }
  // Also account for foreach nested stacking
  for (const [, fe] of colExpansion) {
    const nestedCellCount = new Map<string, number>()
    for (const ns of fe.feStep.steps ?? []) {
      const nlv = fe.nestedLevels.get(ns.id) ?? 0
      const key = `${nlv}:${ns.actor}`
      nestedCellCount.set(key, (nestedCellCount.get(key) ?? 0) + 1)
    }
    for (const [key, count] of nestedCellCount) {
      const actor = key.split(':')[1]
      actorMaxStack.set(actor, Math.max(actorMaxStack.get(actor) ?? 1, count))
    }
  }

  // Compute row heights and Y offsets
  const rowHeight = new Map<string, number>()
  const rowY0 = new Map<string, number>()
  let curPoolY = PAD
  for (const a of actors) {
    const stack = actorMaxStack.get(a) ?? 1
    const h = stack * BOX_H + (stack - 1) * STACK_GAP + 20
    rowHeight.set(a, h)
    rowY0.set(a, curPoolY)
    curPoolY += h
  }

  const contentW = totalCols * (BOX_W + COL_GAP)
  const totalW = POOL_LABEL_W + contentW + PAD * 2 + 40
  const totalH = curPoolY + PAD

  const parts: string[] = []
  const positions: Pos[] = []

  parts.push(`<defs>
    <marker id="a" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6 Z" fill="#555"/></marker>
    <marker id="a-ok" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6 Z" fill="#10b981"/></marker>
    <marker id="a-err" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6 Z" fill="#ef4444"/></marker>
  </defs>`)

  // Pool rows
  for (let i = 0; i < actors.length; i++) {
    const a = actors[i]
    const py = rowY0.get(a)!; const rh = rowHeight.get(a)!
    const poolEven = i % 2 === 0
    parts.push(`<rect x="0" y="${py}" width="${totalW}" height="${rh}" fill="${poolEven ? 'var(--md-surface-container-lowest,#ffffff03)' : 'var(--md-surface-container-low,#ffffff06)'}"/>`)
    if (i > 0) parts.push(`<line x1="0" y1="${py}" x2="${totalW}" y2="${py}" stroke="var(--border-subtle-color,#ffffff10)" stroke-width="1"/>`)
    const color = actorColor(a)
    parts.push(`<rect x="${PAD}" y="${py + 6}" width="${POOL_LABEL_W - 20}" height="${rh - 12}" rx="6" fill="${color}20" stroke="${color}" stroke-width="1"/>`)
    parts.push(`<text x="${PAD + (POOL_LABEL_W - 20) / 2}" y="${py + rh / 2 + 4}" text-anchor="middle" fill="${color}" font-size="10" font-weight="700" font-family="system-ui">${a}</text>`)
  }

  function colX(col: number): number { return POOL_LABEL_W + PAD + col * (BOX_W + COL_GAP) }

  // Track stacking index per cell for top-level steps
  const cellIdx = new Map<string, number>()
  function nextCellY(actor: string, lv: number): number {
    const key = `${lv}:${actor}`
    const idx = cellIdx.get(key) ?? 0
    cellIdx.set(key, idx + 1)
    const py = rowY0.get(actor)! + 10 // padding inside pool
    return py + idx * (BOX_H + STACK_GAP)
  }

  // Place top-level steps
  for (const s of def.steps) {
    const lv = levels.get(s.id) ?? 0
    const col = colStart.get(lv)!

    if (s.foreach && s.steps?.length) {
      const fe = colExpansion.get(lv)!
      const nestedActors = new Set<string>()
      for (const ns of s.steps) nestedActors.add(ns.actor)
      const feMinActor = actors.filter(a => nestedActors.has(a))[0]
      const feMaxActor = actors.filter(a => nestedActors.has(a)).at(-1)!
      const feX = colX(col) - 6
      const feY = rowY0.get(feMinActor)! + 2
      const feW = (fe.maxNested + 1) * (BOX_W + COL_GAP) + 4
      const feBottom = rowY0.get(feMaxActor)! + rowHeight.get(feMaxActor)! - 2
      const feH = feBottom - feY
      const strategy = s.foreach?.strategy
      const loopLabel = strategy?.mode === 'parallel'
        ? `foreach ∥ ${strategy.concurrency ? 'max=' + strategy.concurrency : ''}`
        : 'foreach →'

      // Expand foreach container: 16px top for label, 6px padding on sides
      const feLabelH = 18
      parts.push(`<rect x="${feX - 4}" y="${feY - feLabelH}" width="${feW + 8}" height="${feH + feLabelH + 4}" rx="10" fill="none" stroke="#666" stroke-width="1" stroke-dasharray="5,3"/>`)
      parts.push(`<text x="${feX + 4}" y="${feY - 5}" fill="#999" font-size="9" font-weight="600" font-family="system-ui">${loopLabel} ${s.title}</text>`)

      // Place nested steps (with own stacking tracker)
      const nestedCellIdx = new Map<string, number>()
      for (const ns of s.steps) {
        const nsLv = fe.nestedLevels.get(ns.id) ?? 0
        const nsCol = col + nsLv
        const nx = colX(nsCol)
        const nKey = `${nsLv}:${ns.actor}`
        const nIdx = nestedCellIdx.get(nKey) ?? 0
        nestedCellIdx.set(nKey, nIdx + 1)
        const ny = rowY0.get(ns.actor)! + 10 + nIdx * (BOX_H + STACK_GAP)
        placeStep(parts, positions, ns, nx, ny, rtLookup(rtMap, ns), selectedId)
      }
      for (const ns of s.steps) {
        for (const dep of ns.dependsOn ?? []) {
          const src = positions.find(p => p.id === dep); const tgt = positions.find(p => p.id === ns.id)
          if (src && tgt) { const depStep = s.steps!.find(x => x.id === dep); drawHArrow(parts, src, tgt, depStep ? rtLookup(rtMap, depStep)?.status : undefined) }
        }
      }

      if (s.onFailure) {
        const cfx = feX + feW + 22; const cfy = feY + feH / 2
        parts.push(`<circle cx="${cfx}" cy="${cfy}" r="9" fill="#ef444430" stroke="#ef4444" stroke-width="1.5"/>`)
        parts.push(`<text x="${cfx}" y="${cfy + 3}" text-anchor="middle" fill="#ef4444" font-size="9" font-weight="700" font-family="system-ui">✕</text>`)
        parts.push(`<line x1="${feX + feW + 4}" y1="${cfy}" x2="${cfx - 9}" y2="${cfy}" stroke="#ef4444" stroke-width="1" stroke-dasharray="3,2" marker-end="url(#a-err)"/>`)
      }

      positions.push({ id: s.id, x: feX - 4, y: feY - feLabelH, cx: feX + feW / 2, cy: feY + feH / 2, w: feW + 8, h: feH + feLabelH + 4 })

    } else {
      const x = colX(col)
      const y = nextCellY(s.actor, lv)
      placeStep(parts, positions, s, x, y, rtLookup(rtMap, s), selectedId)
    }
  }

  // ── BPMN-style arrows with merge bars for fan-in/fan-out ──────────────
  // Group edges by (depSet → target) to detect fan-in merge points
  // and by (source → targetSet) to detect fan-out points

  // Build edge list with transitive reduction
  // Remove redundant edges: if A→C exists but A→B→...→C also exists, drop A→C
  type Edge = { srcId: string; tgtId: string }
  const rawEdges: Edge[] = []
  for (const s of def.steps) {
    for (const dep of s.dependsOn ?? []) rawEdges.push({ srcId: dep, tgtId: s.id })
  }

  // Build adjacency for reachability check
  const adj = new Map<string, Set<string>>()
  for (const e of rawEdges) {
    if (!adj.has(e.srcId)) adj.set(e.srcId, new Set())
    adj.get(e.srcId)!.add(e.tgtId)
  }

  function canReach(from: string, to: string, skip: string): boolean {
    // BFS: can we reach 'to' from 'from' without using the direct edge from→skip→...→to?
    const visited = new Set<string>()
    const queue = [from]
    visited.add(from)
    while (queue.length > 0) {
      const cur = queue.shift()!
      for (const next of adj.get(cur) ?? []) {
        if (cur === from && next === to) continue // skip the direct edge
        if (next === to) return true
        if (!visited.has(next)) { visited.add(next); queue.push(next) }
      }
    }
    return false
  }

  // Keep only edges where no alternative path exists
  const edges: Edge[] = rawEdges.filter(e => !canReach(e.srcId, e.tgtId, e.tgtId))

  // Detect merge groups: multiple sources → same target(s)
  // Key = sorted list of sources, Value = list of targets sharing those exact sources
  // Use reduced edges, not raw dependsOn
  const tgtDeps = new Map<string, string[]>() // targetId → sorted deps (reduced)
  for (const e of edges) {
    if (!tgtDeps.has(e.tgtId)) tgtDeps.set(e.tgtId, [])
    const arr = tgtDeps.get(e.tgtId)!
    if (!arr.includes(e.srcId)) arr.push(e.srcId)
  }
  for (const [k, v] of tgtDeps) tgtDeps.set(k, v.sort())

  // Group targets that share the exact same dependency set
  const mergeGroups = new Map<string, { deps: string[]; targets: string[] }>()
  for (const [tgtId, deps] of tgtDeps) {
    const key = deps.join(',')
    if (!mergeGroups.has(key)) mergeGroups.set(key, { deps, targets: [] })
    mergeGroups.get(key)!.targets.push(tgtId)
  }

  const drawnEdges = new Set<string>() // "src→tgt" to avoid duplicates

  for (const [, group] of mergeGroups) {
    const { deps, targets } = group
    const srcPositions = deps.map(d => positions.find(p => p.id === d)).filter(Boolean) as Pos[]
    const tgtPositions = targets.map(t => positions.find(p => p.id === t)).filter(Boolean) as Pos[]
    if (srcPositions.length === 0 || tgtPositions.length === 0) continue

    if (deps.length > 1) {
      // T-junction join/fork with thin L-shaped lines (like CI pipeline viz)
      const rightmostSrc = srcPositions.reduce((a, b) => (a.x + a.w > b.x + b.w ? a : b))
      const leftmostTgt = tgtPositions.reduce((a, b) => a.x < b.x ? a : b)
      const srcYs = srcPositions.map(p => p.cy)
      const tgtYs = tgtPositions.map(p => p.cy)
      const SW = 1.2

      // Join: vertical line collecting source outputs
      const joinX = rightmostSrc.x + rightmostSrc.w + 12
      parts.push(`<line x1="${joinX}" y1="${Math.min(...srcYs)}" x2="${joinX}" y2="${Math.max(...srcYs)}" stroke="#555" stroke-width="${SW}"/>`)
      // L-bends from each source to join vertical (no arrowhead on join)
      for (const sp of srcPositions) {
        parts.push(`<line x1="${sp.x + sp.w}" y1="${sp.cy}" x2="${joinX}" y2="${sp.cy}" stroke="#555" stroke-width="${SW}"/>`)
      }

      // Fork: vertical line distributing to targets
      const forkX = leftmostTgt.x - 12
      parts.push(`<line x1="${forkX}" y1="${Math.min(...tgtYs)}" x2="${forkX}" y2="${Math.max(...tgtYs)}" stroke="#555" stroke-width="${SW}"/>`)
      // L-bends from fork vertical to each target (arrowhead on target entry)
      for (const tp of tgtPositions) {
        parts.push(`<line x1="${forkX}" y1="${tp.cy}" x2="${tp.x}" y2="${tp.cy}" stroke="#555" stroke-width="${SW}" marker-end="url(#a)"/>`)
      }

      // Connector: join midpoint → fork midpoint (orthogonal L)
      const joinMidY = (Math.min(...srcYs) + Math.max(...srcYs)) / 2
      const forkMidY = (Math.min(...tgtYs) + Math.max(...tgtYs)) / 2
      if (Math.abs(joinMidY - forkMidY) < 3) {
        parts.push(`<line x1="${joinX}" y1="${joinMidY}" x2="${forkX}" y2="${forkMidY}" stroke="#555" stroke-width="${SW}"/>`)
      } else {
        const mx = joinX + (forkX - joinX) / 2
        parts.push(`<path d="M${joinX},${joinMidY} L${mx},${joinMidY} L${mx},${forkMidY} L${forkX},${forkMidY}" fill="none" stroke="#555" stroke-width="${SW}"/>`)
      }

      for (const d of deps) for (const t of targets) drawnEdges.add(`${d}→${t}`)
    } else {
      // Single dependency — draw directly, but merge if multiple targets share it
      const sp = srcPositions[0]
      if (tgtPositions.length > 1) {
        // Fan-out: T-junction from source to multiple targets
        const depStep = def.steps.find(x => x.id === sp.id)
        const rtS = depStep ? rtLookup(rtMap, depStep)?.status : undefined
        const color = rtS === 3 ? '#10b981' : rtS === 4 ? '#ef4444' : '#555'
        const mid = rtS === 3 ? 'a-ok' : rtS === 4 ? 'a-err' : 'a'
        const tys = tgtPositions.map(p => p.cy)
        const forkX2 = sp.x + sp.w + 12

        // Horizontal from source to fork point
        parts.push(`<line x1="${sp.x + sp.w}" y1="${sp.cy}" x2="${forkX2}" y2="${sp.cy}" stroke="${color}" stroke-width="1.2"/>`)
        // Vertical connecting all target Y levels
        parts.push(`<line x1="${forkX2}" y1="${Math.min(...tys, sp.cy)}" x2="${forkX2}" y2="${Math.max(...tys, sp.cy)}" stroke="${color}" stroke-width="1.2"/>`)
        // Horizontal from fork to each target (with arrowhead)
        for (const tp of tgtPositions) {
          parts.push(`<line x1="${forkX2}" y1="${tp.cy}" x2="${tp.x}" y2="${tp.cy}" stroke="${color}" stroke-width="1.2" marker-end="url(#${mid})"/>`)
          drawnEdges.add(`${sp.id}→${tp.id}`)
        }
      }
    }
  }

  // Draw remaining edges that weren't part of merge groups
  for (const e of edges) {
    if (drawnEdges.has(`${e.srcId}→${e.tgtId}`)) continue
    const src = positions.find(p => p.id === e.srcId)
    const tgt = positions.find(p => p.id === e.tgtId)
    if (src && tgt) {
      const depStep = def.steps.find(x => x.id === e.srcId)
      drawHArrow(parts, src, tgt, depStep ? rtLookup(rtMap, depStep)?.status : undefined)
    }
  }

  // ── onSuccess: ✓ circle after the rightmost terminal step ─────────────
  if (def.onSuccess) {
    const terminalSteps = def.steps.filter(s => !def.steps.some(o => o.dependsOn?.includes(s.id)))
    let rightmostTerminal: Pos | null = null
    for (const ts of terminalSteps) {
      const p = positions.find(pos => pos.id === ts.id)
      if (p && (!rightmostTerminal || (p.x + p.w) > (rightmostTerminal.x + rightmostTerminal.w))) rightmostTerminal = p
    }
    if (rightmostTerminal) {
      const scx = rightmostTerminal.x + rightmostTerminal.w + 22 + CIRCLE_R
      const scy = rightmostTerminal.cy
      parts.push(`<circle cx="${scx}" cy="${scy}" r="${CIRCLE_R}" fill="#10b98125" stroke="#10b981" stroke-width="2"/>`)
      parts.push(`<text x="${scx}" y="${scy + 4}" text-anchor="middle" fill="#10b981" font-size="11" font-weight="700" font-family="system-ui">✓</text>`)
      parts.push(`<line x1="${rightmostTerminal.x + rightmostTerminal.w}" y1="${scy}" x2="${scx - CIRCLE_R}" y2="${scy}" stroke="#10b981" stroke-width="1.2" marker-end="url(#a-ok)"/>`)
    }
  }

  return { svg: parts.join('\n'), width: totalW, height: totalH }
}

function placeStep(
  parts: string[], positions: Pos[], step: StepDef,
  x: number, y: number, rt: WorkflowStep | undefined, selectedId: string,
) {
  const hasRt = !!rt
  const isSelected = step.id === selectedId
  // Border color: green if succeeded, red if failed, blue if running, default gray
  const borderColor = hasRt
    ? (rt!.status === 3 ? '#10b981' : rt!.status === 4 ? '#ef4444' : rt!.status === 2 ? '#3b82f6' : '#4b5563')
    : '#4b5563'
  const fillColor = hasRt
    ? (rt!.status === 3 ? '#10b98130' : rt!.status === 4 ? '#ef444430' : rt!.status === 2 ? '#3b82f630' : 'var(--md-surface-container-low, #6b728010)')
    : 'var(--md-surface-container-low, #6b728010)'
  const sw = isSelected ? 2.5 : hasRt ? 2 : 1

  const hasWhen = !!step.when
  const hasRetry = !!step.retry
  const color = actorColor(step.actor)
  const durStr = rt && rt.durationMs > 0 ? (rt.durationMs < 1000 ? `${rt.durationMs}ms` : `${(rt.durationMs / 1000).toFixed(1)}s`) : ''
  const statusIcon = rt ? (rt.status === 3 ? '✓' : rt.status === 4 ? '✕' : rt.status === 2 ? '⟳' : '') : ''

  parts.push(`<g class="wf-step-g" data-step-id="${step.id}" style="cursor:pointer">`)
  parts.push(`<rect x="${x}" y="${y}" width="${BOX_W}" height="${BOX_H}" rx="${BOX_R}" fill="${fillColor}" stroke="${borderColor}" stroke-width="${sw}"/>`)
  if (isSelected) parts.push(`<rect x="${x - 3}" y="${y - 3}" width="${BOX_W + 6}" height="${BOX_H + 6}" rx="${BOX_R + 2}" fill="none" stroke="#6366f1" stroke-width="1.5" stroke-dasharray="4,2"/>`)

  parts.push(`<foreignObject x="${x}" y="${y}" width="${BOX_W}" height="${BOX_H}">
    <div xmlns="http://www.w3.org/1999/xhtml" style="padding:5px 8px;height:${BOX_H}px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;font-family:system-ui;overflow:hidden">
      <div style="font-size:10px;font-weight:600;color:var(--on-surface-color,#e0e0e0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3">${step.title}</div>
      <div style="font-size:8px;color:var(--secondary-text-color,#999);margin-top:2px;display:flex;gap:4px;align-items:center;white-space:nowrap;overflow:hidden">
        ${hasWhen ? '<span style="color:#f59e0b" title="conditional">◇</span>' : ''}
        ${hasRetry ? '<span title="retryable">↻' + step.retry!.maxAttempts + '</span>' : ''}
        ${durStr ? `<span>${durStr}</span>` : ''}
        ${statusIcon ? `<span style="color:${borderColor};font-weight:700">${statusIcon}</span>` : ''}
      </div>
    </div>
  </foreignObject>`)
  parts.push('</g>')

  positions.push({ id: step.id, x, y, cx: x + BOX_W / 2, cy: y + BOX_H / 2, w: BOX_W, h: BOX_H })
}

// Track how many arrows use each vertical channel so we can offset them
const _channelCount = new Map<number, number>()


function drawHArrowDashed(parts: string[], src: Pos, tgt: Pos, color: string, markerId: string) {
  const fx = src.x + src.w, fy = src.cy, tx = tgt.x, ty = tgt.cy
  if (Math.abs(fy - ty) < 3) {
    parts.push(`<line x1="${fx}" y1="${fy}" x2="${tx}" y2="${ty}" stroke="${color}" stroke-width="1" stroke-dasharray="4,3" marker-end="url(#${markerId})"/>`)
  } else {
    const channelBase = Math.round(fx + 8)
    const idx = _channelCount.get(channelBase) ?? 0
    _channelCount.set(channelBase, idx + 1)
    const cx = channelBase + idx * 4
    parts.push(`<path d="M${fx},${fy} L${cx},${fy} L${cx},${ty} L${tx},${ty}" fill="none" stroke="${color}" stroke-width="1" stroke-dasharray="4,3" marker-end="url(#${markerId})"/>`)
  }
}

function drawHArrow(parts: string[], src: Pos, tgt: Pos, srcStatus?: number) {
  const color = srcStatus === 3 ? '#10b981' : srcStatus === 4 ? '#ef4444' : '#555'
  const mid = srcStatus === 3 ? 'a-ok' : srcStatus === 4 ? 'a-err' : 'a'
  const fx = src.x + src.w
  const fy = src.cy
  const tx = tgt.x
  const ty = tgt.cy

  if (Math.abs(fy - ty) < 3) {
    // Same row — straight horizontal
    parts.push(`<line x1="${fx}" y1="${fy}" x2="${tx}" y2="${ty}" stroke="${color}" stroke-width="1.2" marker-end="url(#${mid})"/>`)
  } else {
    // Cross-pool: route through a vertical channel at the right edge of source column
    // Use a small offset from the right edge of the source box to avoid overlapping the box
    const channelBase = Math.round(fx + 8) // base x for vertical channel
    const channelKey = channelBase
    const idx = _channelCount.get(channelKey) ?? 0
    _channelCount.set(channelKey, idx + 1)
    const channelX = channelBase + idx * 4 // 4px spacing between parallel verticals

    parts.push(`<path d="M${fx},${fy} L${channelX},${fy} L${channelX},${ty} L${tx},${ty}" fill="none" stroke="${color}" stroke-width="1.2" marker-end="url(#${mid})"/>`)
  }
}

function fmtDateTime(iso: string): string {
  if (!iso) return '—'
  try { const d = new Date(iso); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) } catch { return '—' }
}
function runDuration(run: WorkflowRun): string {
  if (!run.startedAt) return '—'
  const s = new Date(run.startedAt).getTime(), e = run.finishedAt ? new Date(run.finishedAt).getTime() : Date.now(), ms = e - s
  if (ms < 1000) return `${ms}ms`; if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
}

// ─── Module-level cache ───────────────────────────────────────────────────────
// Cache the runs list — defs are already memoized in the per-instance _defCache Map.
const _cache: { data: WorkflowRun[] | null; fetchedAt: number } = { data: null, fetchedAt: 0 }

// ─── Component ──────────────────────────────────────────────────────────────

class PageClusterWorkflows extends HTMLElement {
  private _defs: WorkflowDef[] = []
  private _defCache = new Map<string, WorkflowDef>()
  private _def: WorkflowDef | null = null
  private _runs: WorkflowRun[] = []
  private _run: WorkflowRun | null = null
  private _rtMap = new Map<string, WorkflowStep>()
  private _selStepId = ''
  private _selStepDef: StepDef | null = null
  private _selStepRt: WorkflowStep | null = null
  private _diag: DiagnoseResult | null = null
  private _loading = true
  private _loadingRun = false
  private _error = ''
  private _pollT: number | null = null
  private _listT: number | null = null

  connectedCallback() {
    this.style.display = 'block'
    // Show stale runs immediately on remount — zero loading flicker for the table
    if (_cache.data !== null) {
      this._runs = _cache.data
      this._loading = false
    }
    this.render()
    this.loadDefinitions()
    this._listT = window.setInterval(() => this.silentLoad(), 30_000)
  }
  disconnectedCallback() { if (this._pollT) clearInterval(this._pollT); if (this._listT) clearInterval(this._listT) }

  /** Fetch workflow definitions from MinIO (single source of truth) */
  private async loadDefinitions() {
    try {
      const summaries = await listWorkflowDefinitions()
      // Load full YAML for each definition and parse it
      const defs: WorkflowDef[] = []
      for (const s of summaries.sort((a, b) => a.name.localeCompare(b.name))) {
        const cached = this._defCache.get(s.name)
        if (cached) { defs.push(cached); continue }
        try {
          const yaml = await getWorkflowDefinition(s.name)
          const def = parseWorkflowYaml(yaml)
          if (def) { this._defCache.set(s.name, def); defs.push(def) }
        } catch (e) {
          console.error(`load definition ${s.name}:`, e)
        }
      }
      this._defs = defs
      if (defs.length > 0 && !this._def) this._def = defs[0]
      this._error = ''
    } catch (e: any) {
      this._error = `Failed to load workflow definitions: ${e?.message || e}`
    }
    this._loading = false
    // Always load runs — definition is only needed for the SVG diagram, not the table
    this.loadRuns()
    // Auto-retry transient "not initialized" / "unavailable" errors
    if (this._error && (this._error.includes('not initialized') || this._error.includes('unavailable'))) {
      setTimeout(() => {
        if (!this._def) this.loadDefinitions()
      }, 5000)
    }
  }

  /** Client-side filter: match runs by workflowName or fall back to runFilter heuristics */
  private matchesDef(r: WorkflowRun): boolean {
    // Exact workflow_name match (set by new engine)
    if (!this._def) return true // no definition loaded — show all runs
    if (r.workflowName) return r.workflowName === this._def.name
    // Legacy runs without workflow_name: use heuristic runFilter
    const f = this._def.runFilter
    if (!f) return false // no filter = only match by exact workflow_name
    if (f.correlationPrefix && !r.correlationId?.startsWith(f.correlationPrefix)) return false
    if (f.releaseKind && r.context?.releaseKind !== f.releaseKind) return false
    if (f.triggerReason !== undefined && r.triggerReason !== f.triggerReason) return false
    return true
  }

  private async loadRuns() {
    try {
      const all = await listWorkflowRuns('globular.internal', { limit: 50 })
      // Client-side filter as fallback for old servers / legacy runs
      this._runs = all.filter(r => this.matchesDef(r))
      _cache.data = this._runs
      _cache.fetchedAt = Date.now()
      this._error = ''
    }
    catch (e: any) {
      this._error = e?.message || 'Workflow service unreachable'
      // Preserve stale runs on error so the table stays populated
      if (_cache.data !== null) this._runs = _cache.data
      else this._runs = []
    }
    this._loading = false; this.render()
  }
  private async silentLoad() {
    try {
      const all = await listWorkflowRuns('globular.internal', { limit: 50 })
      const newRuns = all.filter(r => this.matchesDef(r))
      // Only re-render if the run list actually changed (avoid resetting UI state)
      const changed = newRuns.length !== this._runs.length ||
        newRuns.some((r, i) => r.id !== this._runs[i]?.id || r.status !== this._runs[i]?.status)
      this._runs = newRuns
      _cache.data = newRuns
      _cache.fetchedAt = Date.now()
      if (!this._runs.some(r => this.isActive(r.status)) && this._listT) { clearInterval(this._listT); this._listT = window.setInterval(() => this.silentLoad(), 30_000) }
      if (changed) this.updateTable()
    } catch {}
  }
  /** Update just the table body rows without rebuilding the entire page */
  private updateTable() {
    const tbody = this.querySelector<HTMLElement>('tbody[data-bind="tbl-body"]')
    if (!tbody) return
    tbody.innerHTML = this._buildTableRows()
    // Re-bind table row clicks
    this.querySelectorAll<HTMLElement>('[data-rid]').forEach(r => r.addEventListener('click', () => { const run = this._runs.find(x => x.id === r.dataset.rid); if (run) this.selectRun(run) }))
  }
  private async selectRun(run: WorkflowRun) {
    this._run = run; this._selStepId = ''; this._selStepDef = null; this._selStepRt = null; this._diag = null; this._loadingRun = true; this.render()
    try {
      const d = await getWorkflowRun('globular.internal', run.id)
      this._run = d.run; this._rtMap = buildRtMap(d.steps, this._def!, d.run.status)
      if (d.run.status === 9 || d.run.status === 11) { try { this._diag = await diagnoseWorkflowRun('globular.internal', run.id) } catch {} }
      this.stopPoll()
      if (d.run && this.isActive(d.run.status)) {
        this._pollT = window.setInterval(() => this.refreshRun(), 3000)
        if (this._listT) clearInterval(this._listT); this._listT = window.setInterval(() => this.silentLoad(), 3000)
      }
    } catch { this._rtMap = new Map() }
    this._loadingRun = false; this.render()
  }
  private async refreshRun() {
    if (!this._run) return
    try {
      const d = await getWorkflowRun('globular.internal', this._run.id); this._run = d.run
      this._rtMap = this._def ? buildRtMap(d.steps, this._def, d.run.status) : new Map()
      if (d.run && !this.isActive(d.run.status)) {
        this.stopPoll()
        if (d.run.status === 9 || d.run.status === 11) { try { this._diag = await diagnoseWorkflowRun('globular.internal', d.run.id) } catch {} }
        if (this._listT) clearInterval(this._listT); this._listT = window.setInterval(() => this.silentLoad(), 30_000)
      }
      this._patchRunView()
    } catch {}
  }

  /** Patch only the run-specific slots without rebuilding the full shell. */
  private _patchRunView() {
    const run = this._run

    // Patch SVG header [data-bind="svg-hdr"]
    const hdr = this.querySelector<HTMLElement>('[data-bind="svg-hdr"]')
    if (hdr) {
      if (run) {
        hdr.style.display = ''
        hdr.innerHTML = `
          <strong style="font-weight:700">${run.context?.componentName || '—'}</strong>
          <span class="cw-badge" style="background:${runStatusColor(run.status)}">${runStatusLabel(run.status)}</span>
          <span style="color:var(--secondary-text-color);font-size:.7rem">${run.context?.nodeHostname || ''} · ${runDuration(run)} · <code style="font-size:.66rem">${run.id?.slice(0, 8)}</code></span>`
      } else {
        hdr.style.display = 'none'
        hdr.innerHTML = ''
      }
    }

    // Patch SVG [data-bind="svg-wrap"]
    const svgWrap = this.querySelector<HTMLElement>('[data-bind="svg-wrap"]')
    if (svgWrap && this._def) {
      const { svg, width, height } = buildHorizontalSvg(this._def, this._rtMap, this._selStepId)
      svgWrap.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${svg}</svg>`
      // Re-bind step click handlers on new SVG elements
      svgWrap.querySelectorAll<HTMLElement>('[data-step-id]').forEach(el => el.addEventListener('click', (e) => {
        e.stopPropagation(); const id = el.dataset.stepId ?? ''
        this._selStepId = id; this._selStepDef = this.findStep(id); this._selStepRt = this._rtMap.get(id) ?? (this._selStepDef ? this._rtMap.get(this._selStepDef.title) : null) ?? null
        this._patchStepBar()
        // Re-highlight selection in SVG
        this._patchRunView()
      }))
    }

    // Patch step bar [data-bind="step-bar"]
    this._patchStepBar()

    // Also refresh table row status badges
    this.updateTable()
  }

  private _patchStepBar() {
    const wrapper = this.querySelector<HTMLElement>('[data-bind="step-bar"]')
    if (!wrapper) return
    wrapper.innerHTML = this.renderStepBar()
    this._bindStepBarButtons()
  }

  private _bindStepBarButtons() {
    this.querySelector('#btnRetry')?.addEventListener('click', async () => { if (!this._run) return; try { const r = await retryWorkflowRun('globular.internal', this._run.id); this.selectRun(r); this.loadRuns() } catch (e: any) { this._error = `Retry: ${e?.message}`; this.render() } })
    this.querySelector('#btnAck')?.addEventListener('click', async () => { if (!this._run) return; try { await acknowledgeWorkflowRun('globular.internal', this._run.id, 'admin-ui'); this._run.acknowledged = true; this._patchStepBar() } catch (e: any) { this._error = `Ack: ${e?.message}`; this.render() } })
    this.querySelector('#btnDiag')?.addEventListener('click', async () => { if (!this._run) return; try { this._diag = await diagnoseWorkflowRun('globular.internal', this._run.id); this.render() } catch (e: any) { this._error = `Diag: ${e?.message}`; this.render() } })
  }
  private isActive(s: number) { return s >= 1 && s <= 7 }
  private stopPoll() { if (this._pollT) { clearInterval(this._pollT); this._pollT = null } }
  private findStep(id: string, steps?: StepDef[]): StepDef | null {
    for (const s of steps ?? this._def?.steps ?? []) { if (s.id === id) return s; if (s.steps) { const f = this.findStep(id, s.steps); if (f) return f } }
    return null
  }

  private render() {
    const run = this._run
    const { svg, width, height } = this._def
      ? buildHorizontalSvg(this._def, this._rtMap, this._selStepId)
      : { svg: '', width: 100, height: 100 }

    this.innerHTML = `
      <style>
        .cw { padding:12px; height:calc(100vh - 64px); display:flex; flex-direction:column; overflow:hidden }
        .cw-bar { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:8px; flex-shrink:0 }
        .cw-bar h2 { margin:0; font:var(--md-typescale-headline-small) }
        .cw-bar select { background:var(--md-surface-container-low); border:1px solid var(--border-subtle-color); border-radius:var(--md-shape-sm); color:var(--on-surface-color); padding:4px 8px; font-size:.82rem; font-family:inherit }
        .cw-bar select:focus { outline:1px solid var(--accent-color) }
        .cw-lbl { font-size:.7rem; font-weight:600; color:var(--secondary-text-color) }
        .cw-chip { padding:2px 8px; border-radius:10px; font-size:.68rem; font-weight:600 }
        .cw-ref { border:1px solid var(--border-subtle-color); background:0; color:var(--on-surface-color); border-radius:var(--md-shape-sm); padding:4px 10px; cursor:pointer; font-size:.76rem; margin-left:auto }
        .cw-ref:hover { background:var(--md-state-hover) }
        .cw-desc { margin:0 0 6px; font-size:.78rem; color:var(--secondary-text-color); flex-shrink:0 }

        .cw-body { flex:1; display:flex; flex-direction:column; min-height:0; border:1px solid var(--border-subtle-color); border-radius:var(--md-shape-md); overflow:hidden }

        /* SVG area */
        .cw-svg { overflow:auto; background:var(--md-surface-container-lowest,#111); flex:0 1 auto; max-height:50%; min-height:140px }
        .cw-svg svg { display:block }
        .cw-svg svg .wf-step-g:hover rect:first-child { filter:brightness(1.3) }
        .cw-svg-hdr { display:flex; align-items:center; gap:8px; padding:5px 10px; background:var(--md-surface-container); border-bottom:1px solid var(--border-subtle-color); font-size:.76rem; flex-shrink:0 }
        .cw-badge { padding:2px 7px; border-radius:4px; font-size:.62rem; font-weight:700; text-transform:uppercase; color:#fff }

        /* Step detail bar (replaces sidebar) */
        .cw-step-bar { display:flex; gap:12px; padding:6px 10px; font-size:.75rem; background:var(--md-surface-container); border-bottom:1px solid var(--border-subtle-color); flex-shrink:0; flex-wrap:wrap; align-items:center; min-height:28px }
        .cw-step-bar .k { font-weight:600; color:var(--secondary-text-color); font-size:.68rem }
        .cw-step-bar .v { font-size:.75rem }
        .cw-step-bar .err { color:var(--error-color) }
        .cw-act-btn { padding:3px 8px; border-radius:4px; font-size:.68rem; font-weight:600; cursor:pointer; border:0 }
        .cw-act-btn:hover { filter:brightness(1.15) }

        /* Table */
        .cw-tbl-wrap { flex:1; overflow:auto }
        .cw-tbl { width:100%; border-collapse:collapse; font-size:.78rem }
        .cw-tbl thead { position:sticky; top:0; z-index:1 }
        .cw-tbl th { background:var(--md-surface-container); border-bottom:1px solid var(--border-subtle-color); padding:6px 8px; text-align:left; font-size:.68rem; font-weight:700; text-transform:uppercase; letter-spacing:.04em; color:var(--secondary-text-color); white-space:nowrap }
        .cw-tbl td { padding:5px 8px; border-bottom:1px solid var(--border-subtle-color,#222); white-space:nowrap }
        .cw-tbl tbody tr { cursor:pointer; transition:background .1s }
        .cw-tbl tbody tr:hover { background:var(--md-state-hover) }
        .cw-tbl tbody tr.sel { background:rgba(99,102,241,.12) }
        .cw-m { font-family:monospace; font-size:.72rem }
        .cw-pulse { animation:cwp 1.5s ease-in-out infinite }
        @keyframes cwp { 0%,100%{opacity:1} 50%{opacity:.5} }
        .cw-empty { padding:20px; text-align:center; color:var(--secondary-text-color); font-size:.82rem }
        .cw-err { padding:12px; color:var(--error-color); font-size:.82rem }
      </style>

      <div class="cw">
        <div class="cw-bar">
          <h2>Workflows</h2>
          <span class="cw-lbl">Definition</span>
          <select id="selDef">${this._defs.map(d => `<option value="${d.name}" ${d.name === this._def?.name ? 'selected' : ''}>${d.displayName}</option>`).join('')}</select>
          <button class="cw-ref" id="btnR">↻</button>
        </div>
        <p class="cw-desc">${this._def?.description ?? (this._error ? '' : this._loading ? 'Loading workflow definitions…' : 'No workflow definitions found')}</p>

        ${this._loading ? '<div class="cw-empty">Loading…</div>' : ''}

        ${!this._loading ? `
        <div class="cw-body">
          ${this._error ? `<div class="cw-err" style="flex-shrink:0">${this._error} — showing all run history</div>` : ''}
          <div class="cw-svg-hdr" data-bind="svg-hdr"${run ? '' : ' style="display:none"'}>
            ${run ? `
            <strong style="font-weight:700">${run.context?.componentName || '—'}</strong>
            <span class="cw-badge" style="background:${runStatusColor(run.status)}">${runStatusLabel(run.status)}</span>
            <span style="color:var(--secondary-text-color);font-size:.7rem">${run.context?.nodeHostname || ''} · ${runDuration(run)} · <code style="font-size:.66rem">${run.id?.slice(0, 8)}</code></span>
            ` : ''}
          </div>
          <div class="cw-svg" ${this._loadingRun ? 'style="opacity:.5"' : ''}>
            <div data-bind="svg-wrap">
              ${this._def ? `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${svg}</svg>` : '<div class="cw-empty" style="font-style:italic">Workflow diagram unavailable — run history is shown below</div>'}
            </div>
          </div>
          <div data-bind="step-bar">${this.renderStepBar()}</div>
          <div class="cw-tbl-wrap">${this.renderTable()}</div>
        </div>
        ` : ''}
      </div>`
    this.bindEvents()
  }

  private renderStepBar(): string {
    const s = this._selStepDef
    const rt = this._selStepRt
    const run = this._run
    if (!s && !run) return '<div class="cw-step-bar"><span style="color:var(--secondary-text-color);font-style:italic;font-size:.72rem">Select a run, then click a step</span></div>'
    if (!s && run) return `<div class="cw-step-bar"><span style="font-style:italic;font-size:.72rem;color:var(--secondary-text-color)">Click a step in the diagram</span>
      <span style="margin-left:auto;display:flex;gap:6px">
        ${run.status === 9 || run.status === 11 ? '<button class="cw-act-btn" id="btnRetry" style="background:#10b981;color:#fff">↻ Retry</button>' : ''}
        ${!run.acknowledged ? '<button class="cw-act-btn" id="btnAck" style="background:#3b82f6;color:#fff">✓ Ack</button>' : ''}
        <button class="cw-act-btn" id="btnDiag" style="background:#8b5cf6;color:#fff">Diagnose</button>
      </span>
    </div>`

    const pairs: string[] = []
    pairs.push(`<span class="k">Step</span><span class="v">${s!.title}</span>`)
    pairs.push(`<span class="k">Action</span><span class="v cw-m">${s!.action || 'foreach'}</span>`)
    if (s!.when?.expr) pairs.push(`<span class="k">When</span><span class="v">${s!.when.expr}</span>`)
    if (s!.retry) pairs.push(`<span class="k">Retry</span><span class="v">${s!.retry.maxAttempts}×/${s!.retry.backoff}</span>`)
    if (rt) {
      pairs.push(`<span class="k">Status</span><span class="v">${runStatusLabel(rt.status)}</span>`)
      if (rt.durationMs > 0) pairs.push(`<span class="k">Dur</span><span class="v">${rt.durationMs < 1000 ? rt.durationMs + 'ms' : (rt.durationMs / 1000).toFixed(1) + 's'}</span>`)
      if (rt.errorMessage) pairs.push(`<span class="k">Error</span><span class="v err">${rt.errorMessage}</span>`)
    }
    if (run) {
      pairs.push(`<span style="margin-left:auto;display:flex;gap:6px">
        ${run.status === 9 || run.status === 11 ? '<button class="cw-act-btn" id="btnRetry" style="background:#10b981;color:#fff">↻ Retry</button>' : ''}
        ${!run.acknowledged ? '<button class="cw-act-btn" id="btnAck" style="background:#3b82f6;color:#fff">✓ Ack</button>' : ''}
        <button class="cw-act-btn" id="btnDiag" style="background:#8b5cf6;color:#fff">Diagnose</button>
      </span>`)
    }
    return `<div class="cw-step-bar">${pairs.join('')}</div>`
  }

  private _buildTableRows(): string {
    return this._runs.map(r => {
      const c = r.context, sel = this._run?.id === r.id, act = this.isActive(r.status)
      return `<tr class="${sel ? 'sel' : ''}" data-rid="${r.id}">
        <td><span class="cw-badge ${act ? 'cw-pulse' : ''}" style="background:${runStatusColor(r.status)}">${runStatusLabel(r.status)}</span></td>
        <td class="cw-m">${c?.componentName || '—'}</td>
        <td>${c?.nodeHostname || c?.nodeId?.slice(0, 8) || '—'}</td>
        <td style="color:${triggerReasonColor(r.triggerReason)};font-size:.72rem">${triggerReasonLabel(r.triggerReason)}</td>
        <td style="font-size:.72rem">${fmtDateTime(r.startedAt)}</td>
        <td style="font-size:.72rem">${runDuration(r)}</td>
        <td class="cw-m" style="font-size:.66rem;color:var(--secondary-text-color)">${r.id?.slice(0, 8)}</td>
      </tr>`
    }).join('')
  }

  private renderTable(): string {
    if (this._runs.length === 0) return '<div class="cw-empty">No workflow runs</div>'
    return `<table class="cw-tbl"><thead><tr>
      <th>Status</th><th>Service</th><th>Node</th><th>Trigger</th><th>Started</th><th>Duration</th><th>ID</th>
    </tr></thead><tbody data-bind="tbl-body">
      ${this._buildTableRows()}
    </tbody></table>`
  }

  private bindEvents() {
    this.querySelector('#selDef')?.addEventListener('change', (e) => {
      const d = this._defs.find(w => w.name === (e.target as HTMLSelectElement).value)
      if (d) { this._def = d; this._run = null; this._rtMap = new Map(); this._selStepId = ''; this._selStepDef = null; this._selStepRt = null; this._loading = true; this.render(); this.loadRuns() }
    })
    this.querySelector('#btnR')?.addEventListener('click', () => { this._loading = true; this.render(); this.loadRuns() })
    this.querySelectorAll<HTMLElement>('[data-rid]').forEach(r => r.addEventListener('click', () => { const run = this._runs.find(x => x.id === r.dataset.rid); if (run) this.selectRun(run) }))
    this.querySelectorAll<HTMLElement>('[data-step-id]').forEach(el => el.addEventListener('click', (e) => {
      e.stopPropagation(); const id = el.dataset.stepId ?? ''
      this._selStepId = id; this._selStepDef = this.findStep(id); this._selStepRt = this._rtMap.get(id) ?? (this._selStepDef ? this._rtMap.get(this._selStepDef.title) : null) ?? null
      this._patchStepBar()
      this._patchRunView()
    }))
    this._bindStepBarButtons()
  }
}

customElements.define('page-cluster-workflows', PageClusterWorkflows)
