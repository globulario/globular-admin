// src/pages/admin_backups.ts
import {
  listBackupJobs, getBackupJob, listBackups, getBackup, deleteBackup,
  validateBackup, runBackup, cancelBackupJob, deleteBackupJob, preflightCheck, runRetention,
  displayMessage, displayError,
  getRetentionStatus, promoteBackup, demoteBackup, restorePlan, restoreBackup,
  listMinioBuckets, createMinioBucket, deleteMinioBucket,
  getConfig, saveServiceConfig, getUsername,
  type BackupJob, type BackupArtifact, type ProviderResult, type ToolCheckResult,
  type RetentionStatus, type BackupValidationIssue, type RestoreStep,
  type MinioBucketInfo,
} from '@globular/backend'

// ─── Constants ────────────────────────────────────────────────────────────────

const JOB_POLL_MS = 3000

const JOB_STATE: Record<number, string> = {
  0: 'Unknown', 1: 'Queued', 2: 'Running', 3: 'Succeeded', 4: 'Failed', 5: 'Canceled',
}
const JOB_TYPE: Record<number, string> = {
  0: 'Unknown', 1: 'Backup', 2: 'Restore', 3: 'Retention',
}
const PROVIDER_TYPE: Record<number, string> = {
  0: 'Unknown', 1: 'etcd', 2: 'restic', 3: 'minio', 4: 'scylla',
}
const QUALITY: Record<number, string> = {
  0: 'Unknown', 1: 'Unverified', 2: 'Validated', 3: 'Restore-tested', 4: 'Promoted',
}
const BACKUP_MODE: Record<number, string> = {
  0: 'Unknown', 1: 'Service', 2: 'Cluster',
}
const SEV: Record<number, string> = {
  0: 'Unknown', 1: 'Info', 2: 'Warn', 3: 'Error',
}

type Tab = 'overview' | 'jobs' | 'backups' | 'restore' | 'settings'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function esc(s: string): string {
  const d = document.createElement('div')
  d.textContent = s
  return d.innerHTML
}

function fmtMs(ms: number): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function fmtDuration(startMs: number, endMs: number): string {
  if (!startMs || !endMs) return '—'
  const sec = Math.round((endMs - startMs) / 1000)
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
}

function fmtElapsed(startMs: number): string {
  if (!startMs) return '—'
  const sec = Math.round((Date.now() - startMs) / 1000)
  if (sec < 60) return `${sec}s (running)`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s (running)`
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m (running)`
}

function fmtBytes(b: number): string {
  if (!b) return '0 B'
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function stateColor(s: number): string {
  if (s === 3) return 'var(--success-color)'
  if (s === 4) return 'var(--error-color)'
  if (s === 2) return '#3b82f6'
  if (s === 1) return '#f59e0b'
  if (s === 5) return 'var(--secondary-text-color)'
  return 'var(--secondary-text-color)'
}

function qualityColor(q: number): string {
  if (q === 4) return '#8b5cf6'
  if (q === 3) return 'var(--success-color)'
  if (q === 2) return '#3b82f6'
  if (q === 1) return '#f59e0b'
  return 'var(--secondary-text-color)'
}

function badge(label: string, color: string): string {
  return `<span class="bk-badge" style="--badge-color:${color}">${label}</span>`
}

function providerBadges(results: ProviderResult[]): string {
  return results.map(r => {
    const name = PROVIDER_TYPE[r.type] ?? 'unknown'
    const color = stateColor(r.state)
    return badge(name, color)
  }).join(' ')
}

// ─── Component ────────────────────────────────────────────────────────────────

class PageAdminBackups extends HTMLElement {
  private _tab: Tab = 'overview'
  private _jobPollTimer: number | null = null

  // Jobs tab state
  private _jobs: BackupJob[] = []
  private _jobsTotal = 0
  private _selectedJob: BackupJob | null = null

  // Backups tab state
  private _backups: BackupArtifact[] = []
  private _backupsTotal = 0
  private _selectedBackup: BackupArtifact | null = null
  private _validateResult: { valid: boolean; issues: BackupValidationIssue[] } | null = null

  // Overview state
  private _latestBackup: BackupArtifact | null = null
  private _recentJobs: BackupJob[] = []
  private _retention: RetentionStatus | null = null

  // Restore wizard state
  private _restoreStep = 0
  private _restoreBackupId = ''
  private _restoreOpts = { includeEtcd: true, includeConfig: true, includeMinio: true, includeScylla: true }
  private _restorePlan: { steps: RestoreStep[]; warnings: BackupValidationIssue[]; confirmationToken: string } | null = null
  private _restoreResult: { jobId: string; dryRun: boolean; steps: RestoreStep[]; warnings: BackupValidationIssue[] } | null = null

  // Settings tab state
  private _preflight: { tools: ToolCheckResult[]; allOk: boolean } | null = null
  private _serviceConfig: any = null
  private _serviceId = ''
  private _destinations: { Name: string; Type: string; Path: string; Options: Record<string, string>; Primary: boolean }[] = []
  private _providerConfig: {
    ScyllaCluster: string; ScyllaLocation: string; ScyllaManagerAPI: string;
    RcloneRemote: string; RcloneSource: string;
    EtcdEndpoints: string; ResticRepo: string; ResticPaths: string;
  } = { ScyllaCluster: '', ScyllaLocation: '', ScyllaManagerAPI: 'http://127.0.0.1:5080', RcloneRemote: '', RcloneSource: '', EtcdEndpoints: '127.0.0.1:2379', ResticRepo: '/var/lib/globular/backups/restic', ResticPaths: '/var/lib/globular' }

  private _minioBuckets: MinioBucketInfo[] = []
  private _minioEndpoint = ''
  private _minioConfig = { MinioEndpoint: '127.0.0.1:9000', MinioAccessKey: '', MinioSecretKey: '', MinioSecure: true }

  private _loading = false
  private _error = ''

  connectedCallback() {
    this.style.display = 'block'
    this.render()
    this.loadTab()
  }

  disconnectedCallback() {
    this.stopJobPoll()
  }

  private render() {
    this.innerHTML = `
      <style>
        .bk-tabs {
          display: flex; gap: 0; border-bottom: 2px solid var(--border-subtle-color);
          margin-bottom: 16px;
        }
        .bk-tab {
          padding: 8px 18px; cursor: pointer; font-size: .85rem; font-weight: 600;
          border: none; background: transparent; color: var(--secondary-text-color);
          border-bottom: 2px solid transparent; margin-bottom: -2px;
          transition: color .15s, border-color .15s;
        }
        .bk-tab:hover { color: var(--on-surface-color); }
        .bk-tab.active {
          color: var(--accent-color);
          border-bottom-color: var(--accent-color);
        }
        .bk-badge {
          display: inline-block; font-size: .72rem; font-weight: 700;
          padding: 1px 7px; border-radius: 10px;
          background: color-mix(in srgb, var(--badge-color) 15%, transparent);
          color: var(--badge-color); text-transform: uppercase; letter-spacing: .04em;
        }
        .bk-card {
          background: var(--md-surface-container-low);
          border: 1px solid var(--border-subtle-color);
          border-radius: var(--md-shape-md);
          box-shadow: var(--md-elevation-1);
          padding: 14px 18px;
        }
        .bk-card-label {
          font-size: .72rem; font-weight: 700;
          text-transform: uppercase; letter-spacing: .06em;
          color: var(--secondary-text-color); margin-bottom: 4px;
        }
        .bk-card-value { font-size: 1.6rem; font-weight: 800; line-height: 1; margin-bottom: 2px; }
        .bk-card-sub { font-size: .75rem; color: var(--secondary-text-color); margin-top: 2px; }
        .bk-summary {
          display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px;
        }
        @media(max-width:700px) { .bk-summary { grid-template-columns: 1fr 1fr; } }
        .bk-btn {
          border: 1px solid var(--border-subtle-color);
          background: transparent; color: var(--on-surface-color);
          border-radius: var(--md-shape-sm);
          padding: 4px 12px; cursor: pointer; font-size: .8rem;
        }
        .bk-btn:hover { background: var(--md-state-hover); }
        .bk-btn:disabled { opacity: .5; cursor: not-allowed; }
        .bk-btn-primary {
          border: 1px solid var(--accent-color);
          background: color-mix(in srgb, var(--accent-color) 10%, transparent);
          color: var(--accent-color);
          border-radius: var(--md-shape-sm);
          padding: 4px 12px; cursor: pointer; font-size: .8rem;
        }
        .bk-btn-primary:hover { background: color-mix(in srgb, var(--accent-color) 20%, transparent); }
        .bk-btn-danger {
          border: 1px solid var(--error-color);
          background: color-mix(in srgb, var(--error-color) 8%, transparent);
          color: var(--error-color);
          border-radius: var(--md-shape-sm);
          padding: 4px 12px; cursor: pointer; font-size: .8rem;
        }
        .bk-btn-danger:hover { background: color-mix(in srgb, var(--error-color) 16%, transparent); }
        select, select option {
          background: var(--md-surface-container-low);
          color: var(--on-surface-color);
        }
        .bk-table { width: 100%; border-collapse: collapse; font-size: .85rem; }
        .bk-table th, .bk-table td { padding: 7px 10px; text-align: left; }
        .bk-table th {
          font-size: .72rem; font-weight: 700; text-transform: uppercase;
          letter-spacing: .06em; color: var(--secondary-text-color);
          border-bottom: 1px solid var(--border-subtle-color);
        }
        .bk-table td { border-bottom: 1px solid color-mix(in srgb, var(--border-subtle-color) 50%, transparent); }
        .bk-table tr.clickable { cursor: pointer; transition: background .12s; }
        .bk-table tr.clickable:hover { background: var(--md-state-hover); }
        .bk-empty {
          padding: 20px; font-size: .85rem; font-style: italic;
          color: var(--secondary-text-color); text-align: center;
        }
        .bk-panel {
          background: var(--md-surface-container-low);
          border: 1px solid var(--border-subtle-color);
          border-radius: var(--md-shape-md);
          box-shadow: var(--md-elevation-1);
          overflow: hidden; margin-bottom: 16px;
        }
        .bk-panel-header {
          padding: 10px 14px; font-size: .72rem; font-weight: 700;
          text-transform: uppercase; letter-spacing: .06em;
          color: var(--secondary-text-color);
          background: var(--md-surface-container);
          border-bottom: 1px solid var(--border-subtle-color);
          display: flex; align-items: center; justify-content: space-between; gap: 8px;
        }
        .bk-detail-section { padding: 14px 18px; }
        .bk-detail-section + .bk-detail-section { border-top: 1px solid var(--border-subtle-color); }
        .bk-kv { display: grid; grid-template-columns: 140px 1fr; gap: 4px 12px; font-size: .85rem; }
        .bk-kv-label { color: var(--secondary-text-color); font-size: .78rem; }
        .bk-banner-warn {
          background: color-mix(in srgb, #f59e0b 10%, transparent);
          border: 1px solid #f59e0b; border-radius: var(--md-shape-sm);
          padding: 10px 14px; margin-bottom: 12px; font-size: .85rem;
        }
        .bk-banner-danger {
          background: color-mix(in srgb, var(--error-color) 10%, transparent);
          border: 1px solid var(--error-color); border-radius: var(--md-shape-sm);
          padding: 10px 14px; margin-bottom: 12px; font-size: .85rem;
        }
        .bk-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
        .bk-wizard-steps {
          display: flex; gap: 0; margin-bottom: 16px;
        }
        .bk-wizard-step {
          flex: 1; text-align: center; padding: 8px; font-size: .78rem;
          color: var(--secondary-text-color);
          border-bottom: 2px solid var(--border-subtle-color);
        }
        .bk-wizard-step.active {
          color: var(--accent-color); font-weight: 700;
          border-bottom-color: var(--accent-color);
        }
        .bk-wizard-step.done {
          color: var(--success-color);
          border-bottom-color: var(--success-color);
        }
        .bk-checkbox { display: flex; align-items: center; gap: 6px; margin: 4px 0; font-size: .85rem; }
        .bk-checkbox input { margin: 0; }
      </style>
      <section class="wrap">
        <header style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">
          <h2 style="margin:0">Backups</h2>
          <div style="flex:1"></div>
        </header>
        <p style="font:var(--md-typescale-body-medium);color:var(--secondary-text-color);margin:0 0 12px">
          Backup and restore cluster state, databases, and configuration snapshots.
        </p>
        <div id="bkTabs"></div>
        <div id="bkContent"></div>
      </section>
    `
    this.renderTabs()
  }

  private renderTabs() {
    const el = this.querySelector('#bkTabs') as HTMLElement
    if (!el) return
    const tabs: { id: Tab; label: string }[] = [
      { id: 'overview', label: 'Overview' },
      { id: 'jobs', label: 'Jobs' },
      { id: 'backups', label: 'Backups' },
      { id: 'restore', label: 'Restore' },
      { id: 'settings', label: 'Settings' },
    ]
    el.innerHTML = `<div class="bk-tabs">${tabs.map(t =>
      `<button class="bk-tab${t.id === this._tab ? ' active' : ''}" data-tab="${t.id}">${t.label}</button>`
    ).join('')}</div>`
    el.querySelectorAll<HTMLButtonElement>('.bk-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        this._tab = btn.dataset.tab as Tab
        this.renderTabs()
        this.loadTab()
      })
    })
  }

  private async loadTab() {
    this._error = ''
    this._loading = true
    this.renderContent()
    try {
      switch (this._tab) {
        case 'overview': await this.loadOverview(); break
        case 'jobs': await this.loadJobs(); break
        case 'backups': await this.loadBackups(); break
        case 'restore': break
        case 'settings': break
      }
    } catch (e: any) {
      this._error = e?.message || 'Failed to load data'
    }
    this._loading = false
    this.renderContent()
  }

  // ─── Overview ──────────────────────────────────────────────────────────────

  private async loadOverview() {
    const [jobsRes, backupsRes, retRes] = await Promise.allSettled([
      listBackupJobs({ limit: 10 }),
      listBackups({ limit: 1, mode: 2 }),
      getRetentionStatus(),
    ])
    this._recentJobs = jobsRes.status === 'fulfilled' ? jobsRes.value.jobs : []
    this._latestBackup = backupsRes.status === 'fulfilled' ? (backupsRes.value.backups[0] ?? null) : null
    this._retention = retRes.status === 'fulfilled' ? retRes.value : null
  }

  private renderOverview() {
    const el = this.querySelector('#bkContent') as HTMLElement
    if (!el) return

    const lb = this._latestBackup
    const ret = this._retention
    const jobs24h = this._recentJobs.filter(j => j.createdMs > Date.now() - 86400000)
    const succeeded24h = jobs24h.filter(j => j.state === 3).length
    const failed24h = jobs24h.filter(j => j.state === 4).length

    let html = `<div class="bk-summary">`

    // Protection status
    html += `<div class="bk-card">
      <div class="bk-card-label">Latest Cluster Backup</div>
      ${lb ? `
        <div style="margin:6px 0">${badge(QUALITY[lb.qualityState] ?? 'Unknown', qualityColor(lb.qualityState))}</div>
        <div class="bk-card-sub">${esc(lb.planName || '—')} &middot; ${fmtMs(lb.createdMs)}</div>
        <div class="bk-card-sub">${fmtBytes(lb.totalBytes)}</div>
      ` : `<div class="bk-card-value" style="color:var(--error-color)">None</div>
           <div class="bk-card-sub">No cluster backup found</div>`}
    </div>`

    // Health
    html += `<div class="bk-card">
      <div class="bk-card-label">Last 24h</div>
      <div style="font-size:.85rem;line-height:1.7;margin-top:6px">
        <span style="color:var(--success-color);font-weight:700">${succeeded24h}</span> succeeded<br>
        <span style="color:${failed24h > 0 ? 'var(--error-color)' : 'var(--secondary-text-color)'};font-weight:700">${failed24h}</span> failed
      </div>
    </div>`

    // Retention
    html += `<div class="bk-card">
      <div class="bk-card-label">Storage</div>
      ${ret ? `
        <div class="bk-card-value">${ret.currentBackupCount}</div>
        <div class="bk-card-sub">backups &middot; ${fmtBytes(ret.currentTotalBytes)}</div>
      ` : `<div class="bk-card-value">—</div><div class="bk-card-sub">unavailable</div>`}
    </div>`

    // Coverage
    if (lb) {
      const ok = lb.providerResults.filter(r => r.state === 3).length
      const total = lb.providerResults.length
      html += `<div class="bk-card">
        <div class="bk-card-label">Provider Coverage</div>
        <div class="bk-card-value" style="color:${ok === total ? 'var(--success-color)' : '#f59e0b'}">${ok}/${total}</div>
        <div class="bk-card-sub">${providerBadges(lb.providerResults)}</div>
        ${lb.skippedProviders.length > 0 ? `<div class="bk-card-sub" style="margin-top:4px">Skipped: ${lb.skippedProviders.map(s => esc(s.name)).join(', ')}</div>` : ''}
      </div>`
    } else {
      html += `<div class="bk-card">
        <div class="bk-card-label">Provider Coverage</div>
        <div class="bk-card-value">—</div>
      </div>`
    }

    html += `</div>`

    // Quick actions
    html += `<div class="bk-actions">
      <button class="bk-btn-primary" id="bkRunCluster">Run Cluster Backup Now</button>
      <button class="bk-btn" id="bkPreflight">Preflight Check</button>
      <button class="bk-btn" id="bkRunRetention">Run Retention Now</button>
    </div>`

    // Recent jobs table
    html += `<div class="bk-panel">
      <div class="bk-panel-header"><span>Recent Jobs</span></div>
      <div style="overflow-x:auto">`
    if (this._recentJobs.length === 0) {
      html += `<p class="bk-empty">No jobs found.</p>`
    } else {
      html += this.jobsTableHtml(this._recentJobs)
    }
    html += `</div></div>`

    el.innerHTML = html
    this.bindOverviewActions()
    this.bindJobRowClicks()
  }

  private bindOverviewActions() {
    this.querySelector('#bkRunCluster')?.addEventListener('click', async () => {
      try {
        const jobId = await runBackup({ mode: 2, labels: { reason: 'manual', created_by: getUsername() || 'unknown' } })
        this._tab = 'jobs'
        this.renderTabs()
        await this.loadJobs()
        this._loading = false
        this.renderContent()
        this.selectJob(jobId)
      } catch (e: any) {
        this._error = e?.message || 'Failed to start backup'
        this.renderContent()
      }
    })
    this.querySelector('#bkPreflight')?.addEventListener('click', async () => {
      this._tab = 'settings'
      this.renderTabs()
      this._loading = false
      this.renderContent()
      this.runPreflightFromSettings()
    })
    this.querySelector('#bkRunRetention')?.addEventListener('click', async () => {
      this._tab = 'settings'
      this.renderTabs()
      this._loading = false
      this.renderContent()
    })
  }

  // ─── Jobs Tab ──────────────────────────────────────────────────────────────

  private async loadJobs() {
    const res = await listBackupJobs({ limit: 50 })
    this._jobs = res.jobs
    this._jobsTotal = res.total
    this._selectedJob = null
  }

  private jobsTableHtml(jobs: BackupJob[]): string {
    return `<table class="bk-table">
      <thead><tr>
        <th>Job ID</th><th>Type</th><th>State</th>
        <th>Created</th><th>Duration</th><th>Plan</th><th>Backup ID</th><th>Message</th>
      </tr></thead>
      <tbody>${jobs.map(j => `
        <tr class="clickable bk-job-row" data-jid="${esc(j.jobId)}">
          <td style="font-family:monospace;font-size:.78rem">${esc(j.jobId.slice(0, 8))}</td>
          <td>${esc(JOB_TYPE[j.jobType] ?? '—')}</td>
          <td>${badge(JOB_STATE[j.state] ?? '—', stateColor(j.state))}</td>
          <td>${fmtMs(j.createdMs)}</td>
          <td>${(j.state === 1 || j.state === 2) ? fmtElapsed(j.startedMs) : fmtDuration(j.startedMs, j.finishedMs)}</td>
          <td>${esc(j.planName || '—')}</td>
          <td style="font-family:monospace;font-size:.78rem">${j.backupId ? esc(j.backupId.slice(0, 8)) : '—'}</td>
          <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-color)">${(j.state === 1 || j.state === 2)
            ? `<span style="color:var(--primary-color)">&#9654; ${esc(j.message || 'running')}</span>`
            : esc(j.message || '')}</td>
        </tr>
      `).join('')}</tbody>
    </table>`
  }

  private renderJobs() {
    const el = this.querySelector('#bkContent') as HTMLElement
    if (!el) return

    if (this._selectedJob) {
      this.renderJobDetail(el)
      return
    }

    let html = `<div class="bk-actions">
      <button class="bk-btn" id="bkRefreshJobs">&#8635; Refresh</button>
      <button class="bk-btn-primary" id="bkRunBackupJobs">Run Cluster Backup</button>
    </div>`

    html += `<div class="bk-panel">
      <div class="bk-panel-header"><span>Jobs (${this._jobsTotal})</span></div>
      <div style="overflow-x:auto">`
    if (this._jobs.length === 0) {
      html += `<p class="bk-empty">No backup jobs found.</p>`
    } else {
      html += this.jobsTableHtml(this._jobs)
    }
    html += `</div></div>`

    el.innerHTML = html

    this.querySelector('#bkRefreshJobs')?.addEventListener('click', async () => {
      this._loading = true; this.renderContent()
      await this.loadJobs()
      this._loading = false; this.renderContent()
    })
    this.querySelector('#bkRunBackupJobs')?.addEventListener('click', async () => {
      try {
        const jobId = await runBackup({ mode: 2, labels: { reason: 'manual', created_by: getUsername() || 'unknown' } })
        await this.loadJobs()
        this.renderContent()
        this.selectJob(jobId)
      } catch (e: any) {
        this._error = e?.message || 'Failed'
        this.renderContent()
      }
    })
    this.bindJobRowClicks()
  }

  private bindJobRowClicks() {
    this.querySelectorAll<HTMLElement>('.bk-job-row').forEach(row => {
      row.addEventListener('click', () => {
        const jid = row.dataset.jid ?? ''
        if (jid) this.selectJob(jid)
      })
    })
  }

  private async selectJob(jobId: string) {
    try {
      this._selectedJob = await getBackupJob(jobId)
      this.renderContent()
      if (this._selectedJob.state === 1 || this._selectedJob.state === 2) {
        this.startJobPoll(jobId)
      }
    } catch (e: any) {
      this._error = e?.message || 'Failed to load job'
      this.renderContent()
    }
  }

  private startJobPoll(jobId: string) {
    this.stopJobPoll()
    this._jobPollTimer = window.setInterval(async () => {
      try {
        this._selectedJob = await getBackupJob(jobId)
        this.renderContent()
        if (this._selectedJob.state !== 1 && this._selectedJob.state !== 2) {
          this.stopJobPoll()
        }
      } catch { this.stopJobPoll() }
    }, JOB_POLL_MS)
  }

  private stopJobPoll() {
    if (this._jobPollTimer) { clearInterval(this._jobPollTimer); this._jobPollTimer = null }
  }

  private renderJobDetail(el: HTMLElement) {
    const j = this._selectedJob!
    const isRunning = j.state === 1 || j.state === 2

    let html = `
      <div style="margin-bottom:12px">
        <button class="bk-btn" id="bkBackJobs">&larr; Back to Jobs</button>
      </div>
      <div class="bk-panel">
        <div class="bk-panel-header">
          <span>Job ${esc(j.jobId)}</span>
          <span>${badge(JOB_STATE[j.state] ?? '—', stateColor(j.state))} ${badge(JOB_TYPE[j.jobType] ?? '—', 'var(--secondary-text-color)')}</span>
        </div>
        <div class="bk-detail-section">
          <div class="bk-kv">
            <span class="bk-kv-label">Plan</span><span>${esc(j.planName || '—')}</span>
            <span class="bk-kv-label">Created</span><span>${fmtMs(j.createdMs)}</span>
            <span class="bk-kv-label">Started</span><span>${fmtMs(j.startedMs)}</span>
            <span class="bk-kv-label">Finished</span><span>${fmtMs(j.finishedMs)}</span>
            <span class="bk-kv-label">Duration</span><span>${isRunning
              ? fmtElapsed(j.startedMs)
              : fmtDuration(j.startedMs, j.finishedMs)}</span>
            <span class="bk-kv-label">Backup ID</span><span style="font-family:monospace">${esc(j.backupId || '—')}</span>
            <span class="bk-kv-label">Status</span><span style="color:var(--text-color)">${isRunning
              ? `<span style="color:var(--primary-color)">&#9654; ${esc(j.message || 'running')}</span>`
              : esc(j.message || '—')}</span>
          </div>
          ${isRunning
            ? `<div style="margin-top:12px"><button class="bk-btn-danger" id="bkCancelJob">Cancel Job</button></div>`
            : `<div style="margin-top:12px"><button class="bk-btn-danger" id="bkDeleteJob">Delete Job</button></div>`}
        </div>`

    // Provider results
    if (j.results.length > 0) {
      html += `<div class="bk-detail-section">
        <div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--secondary-text-color);margin-bottom:8px">Provider Results</div>
        <table class="bk-table"><thead><tr>
          <th>Provider</th><th>State</th><th>Summary</th><th>Bytes</th><th>Duration</th><th>Error</th>
        </tr></thead><tbody>${j.results.map(r => `
          <tr>
            <td>${esc(PROVIDER_TYPE[r.type] ?? 'unknown')}</td>
            <td>${badge(JOB_STATE[r.state] ?? '—', stateColor(r.state))}</td>
            <td>${esc(r.summary)}</td>
            <td>${fmtBytes(r.bytesWritten)}</td>
            <td>${fmtDuration(r.startedMs, r.finishedMs)}</td>
            <td style="color:var(--error-color);max-width:200px;overflow:hidden;text-overflow:ellipsis">${esc(r.errorMessage || '')}</td>
          </tr>
        `).join('')}</tbody></table>
      </div>`
    }

    // Replications
    if (j.replications.length > 0) {
      html += `<div class="bk-detail-section">
        <div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--secondary-text-color);margin-bottom:8px">Replication Results</div>
        <table class="bk-table"><thead><tr>
          <th>Destination</th><th>Path</th><th>State</th><th>Bytes</th><th>Error</th>
        </tr></thead><tbody>${j.replications.map(r => `
          <tr>
            <td>${esc(r.destinationName)}</td>
            <td style="font-family:monospace;font-size:.78rem">${esc(r.destinationPath)}</td>
            <td>${badge(JOB_STATE[r.state] ?? '—', stateColor(r.state))}</td>
            <td>${fmtBytes(r.bytesWritten)}</td>
            <td style="color:var(--error-color)">${esc(r.errorMessage || '')}</td>
          </tr>
        `).join('')}</tbody></table>
      </div>`
    }

    html += `</div>`
    el.innerHTML = html

    this.querySelector('#bkBackJobs')?.addEventListener('click', () => {
      this.stopJobPoll()
      this._selectedJob = null
      this.renderContent()
    })
    this.querySelector('#bkCancelJob')?.addEventListener('click', async () => {
      try {
        await cancelBackupJob(j.jobId)
        this._selectedJob = await getBackupJob(j.jobId)
        this.stopJobPoll()
        this.renderContent()
      } catch (e: any) {
        this._error = e?.message || 'Cancel failed'
        this.renderContent()
      }
    })
    this.querySelector('#bkDeleteJob')?.addEventListener('click', () => {
      const self = this
      this._showConfirmDialog(
        `Delete job <strong>${esc(j.jobId.slice(0, 8))}…</strong> and its backup artifacts?`,
        async () => {
          try {
            await deleteBackupJob(j.jobId, true)
            self._selectedJob = null
            self.stopJobPoll()
            await self.loadJobs()
            self.renderContent()
          } catch (e: any) {
            displayError(e?.message || 'Delete failed', 5000)
          }
        },
      )
    })
  }

  // ─── Backups Tab ───────────────────────────────────────────────────────────

  private async loadBackups() {
    const res = await listBackups({ limit: 50 })
    this._backups = res.backups
    this._backupsTotal = res.total
    this._selectedBackup = null
    this._validateResult = null
  }

  private renderBackups() {
    const el = this.querySelector('#bkContent') as HTMLElement
    if (!el) return

    if (this._selectedBackup) {
      this.renderBackupDetail(el)
      return
    }

    let html = `<div class="bk-actions">
      <button class="bk-btn" id="bkRefreshBackups">&#8635; Refresh</button>
    </div>`

    html += `<div class="bk-panel">
      <div class="bk-panel-header"><span>Backups (${this._backupsTotal})</span></div>
      <div style="overflow-x:auto">`
    if (this._backups.length === 0) {
      html += `<p class="bk-empty">No backup artifacts found.</p>`
    } else {
      html += `<table class="bk-table"><thead><tr>
        <th>Backup ID</th><th>Created</th><th>Mode</th><th>Plan</th>
        <th>Size</th><th>Quality</th><th>Providers</th><th>Locations</th>
      </tr></thead><tbody>${this._backups.map(b => `
        <tr class="clickable bk-backup-row" data-bid="${esc(b.backupId)}">
          <td style="font-family:monospace;font-size:.78rem">${esc(b.backupId.slice(0, 8))}</td>
          <td>${fmtMs(b.createdMs)}</td>
          <td>${esc(BACKUP_MODE[b.mode] ?? '—')}</td>
          <td>${esc(b.planName || '—')}</td>
          <td>${fmtBytes(b.totalBytes)}</td>
          <td>${badge(QUALITY[b.qualityState] ?? '—', qualityColor(b.qualityState))}</td>
          <td>${providerBadges(b.providerResults)}</td>
          <td>${b.locations.length}</td>
        </tr>
      `).join('')}</tbody></table>`
    }
    html += `</div></div>`

    el.innerHTML = html

    this.querySelector('#bkRefreshBackups')?.addEventListener('click', async () => {
      this._loading = true; this.renderContent()
      await this.loadBackups()
      this._loading = false; this.renderContent()
    })
    this.querySelectorAll<HTMLElement>('.bk-backup-row').forEach(row => {
      row.addEventListener('click', async () => {
        const bid = row.dataset.bid ?? ''
        if (!bid) return
        try {
          this._selectedBackup = await getBackup(bid)
          this._validateResult = null
          this.renderContent()
        } catch (e: any) {
          this._error = e?.message || 'Failed to load backup'
          this.renderContent()
        }
      })
    })
  }

  private renderBackupDetail(el: HTMLElement) {
    const b = this._selectedBackup!

    let html = `
      <div style="margin-bottom:12px">
        <button class="bk-btn" id="bkBackBackups">&larr; Back to Backups</button>
      </div>
      <div class="bk-panel">
        <div class="bk-panel-header">
          <span>Backup ${esc(b.backupId)}</span>
          <span>${badge(QUALITY[b.qualityState] ?? '—', qualityColor(b.qualityState))} ${badge(BACKUP_MODE[b.mode] ?? '—', 'var(--secondary-text-color)')}</span>
        </div>

        <div class="bk-detail-section">
          <div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--secondary-text-color);margin-bottom:8px">Summary</div>
          <div class="bk-kv">
            <span class="bk-kv-label">Backup ID</span><span style="font-family:monospace">${esc(b.backupId)}</span>
            <span class="bk-kv-label">Created</span><span>${fmtMs(b.createdMs)}</span>
            <span class="bk-kv-label">Created By</span><span>${esc(b.createdBy || '—')}</span>
            <span class="bk-kv-label">Plan</span><span>${esc(b.planName || '—')}</span>
            <span class="bk-kv-label">Total Size</span><span>${fmtBytes(b.totalBytes)}</span>
            <span class="bk-kv-label">Manifest SHA</span><span style="font-family:monospace;font-size:.78rem">${esc(b.manifestSha256 || '—')}</span>
            <span class="bk-kv-label">Schema Version</span><span>${b.schemaVersion}</span>
            ${b.clusterInfo ? `
              <span class="bk-kv-label">Cluster ID</span><span style="font-family:monospace;font-size:.78rem">${esc(b.clusterInfo.clusterId)}</span>
              <span class="bk-kv-label">Domain</span><span>${esc(b.clusterInfo.domain)}</span>
            ` : ''}
          </div>
          ${Object.keys(b.labels).length > 0 ? `
            <div style="margin-top:8px">
              ${Object.entries(b.labels).map(([k, v]) =>
                `<span class="bk-badge" style="--badge-color:var(--secondary-text-color);margin-right:4px">${esc(k)}=${esc(v)}</span>`
              ).join(' ')}
            </div>
          ` : ''}
        </div>`

    // Provider results
    if (b.providerResults.length > 0) {
      html += `<div class="bk-detail-section">
        <div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--secondary-text-color);margin-bottom:8px">Providers</div>
        <table class="bk-table"><thead><tr>
          <th>Provider</th><th>State</th><th>Summary</th><th>Bytes</th><th>Error</th>
        </tr></thead><tbody>${b.providerResults.map(r => `
          <tr>
            <td>${esc(PROVIDER_TYPE[r.type] ?? 'unknown')}</td>
            <td>${badge(JOB_STATE[r.state] ?? '—', stateColor(r.state))}</td>
            <td>${esc(r.summary)}</td>
            <td>${fmtBytes(r.bytesWritten)}</td>
            <td style="color:var(--error-color)">${esc(r.errorMessage || '')}</td>
          </tr>
        `).join('')}</tbody></table>
      </div>`
    }

    // Skipped providers
    if (b.skippedProviders.length > 0) {
      html += `<div class="bk-detail-section">
        <div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--secondary-text-color);margin-bottom:8px">Skipped Providers</div>
        <table class="bk-table"><thead><tr><th>Provider</th><th>Reason</th></tr></thead>
        <tbody>${b.skippedProviders.map(s => `<tr><td>${esc(s.name)}</td><td>${esc(s.reason)}</td></tr>`).join('')}</tbody></table>
      </div>`
    }

    // Hooks
    if (b.hooks && (b.hooks.prepare.length > 0 || b.hooks.finalize.length > 0)) {
      html += `<div class="bk-detail-section">
        <div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--secondary-text-color);margin-bottom:8px">Hooks</div>`
      for (const phase of ['prepare', 'finalize'] as const) {
        const hooks = b.hooks[phase]
        if (hooks.length > 0) {
          html += `<p style="font-size:.78rem;font-weight:600;margin:8px 0 4px;text-transform:capitalize">${phase}</p>
          <table class="bk-table"><thead><tr><th>Service</th><th>OK</th><th>Message</th><th>Duration</th></tr></thead>
          <tbody>${hooks.map(h => `<tr>
            <td>${esc(h.serviceName)}</td>
            <td>${h.ok ? badge('OK', 'var(--success-color)') : badge('FAIL', 'var(--error-color)')}</td>
            <td>${esc(h.message)}</td>
            <td>${h.durationMs}ms</td>
          </tr>`).join('')}</tbody></table>`
        }
      }
      html += `</div>`
    }

    // Replications
    if (b.replications.length > 0) {
      html += `<div class="bk-detail-section">
        <div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--secondary-text-color);margin-bottom:8px">Replication</div>
        <table class="bk-table"><thead><tr><th>Destination</th><th>Path</th><th>State</th><th>Bytes</th></tr></thead>
        <tbody>${b.replications.map(r => `<tr>
          <td>${esc(r.destinationName)}</td>
          <td style="font-family:monospace;font-size:.78rem">${esc(r.destinationPath)}</td>
          <td>${badge(JOB_STATE[r.state] ?? '—', stateColor(r.state))}</td>
          <td>${fmtBytes(r.bytesWritten)}</td>
        </tr>`).join('')}</tbody></table>
      </div>`
    }

    // Actions
    html += `<div class="bk-detail-section">
      <div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--secondary-text-color);margin-bottom:8px">Actions</div>
      <div class="bk-actions">
        <button class="bk-btn" id="bkValidate">Validate</button>
        <button class="bk-btn" id="bkValidateDeep">Deep Validate</button>
        ${b.qualityState !== 4
          ? `<button class="bk-btn-primary" id="bkPromote">Promote</button>`
          : `<button class="bk-btn" id="bkDemote">Demote</button>`}
        <button class="bk-btn-primary" id="bkRestoreThis">Restore</button>
        <button class="bk-btn-danger" id="bkDelete">Delete</button>
      </div>`

    // Validation result
    if (this._validateResult) {
      const vr = this._validateResult
      html += `<div style="margin-top:8px">
        ${vr.valid
          ? `<div style="color:var(--success-color);font-weight:700;font-size:.85rem">&#10003; Backup is valid</div>`
          : `<div style="color:var(--error-color);font-weight:700;font-size:.85rem">&#10007; Backup has issues</div>`}
        ${vr.issues.length > 0 ? `<ul style="margin:4px 0 0;padding-left:1.4em;font-size:.82rem">${vr.issues.map(i =>
          `<li style="color:${i.severity === 3 ? 'var(--error-color)' : i.severity === 2 ? '#f59e0b' : 'var(--secondary-text-color)'}">[${esc(SEV[i.severity] ?? '?')}] ${esc(i.code)}: ${esc(i.message)}</li>`
        ).join('')}</ul>` : ''}
      </div>`
    }

    html += `</div></div>`
    el.innerHTML = html

    this.querySelector('#bkBackBackups')?.addEventListener('click', () => {
      this._selectedBackup = null
      this._validateResult = null
      this.renderContent()
    })
    this.querySelector('#bkValidate')?.addEventListener('click', () => this.doValidate(false))
    this.querySelector('#bkValidateDeep')?.addEventListener('click', () => this.doValidate(true))
    this.querySelector('#bkPromote')?.addEventListener('click', async () => {
      try {
        await promoteBackup(b.backupId)
        this._selectedBackup = await getBackup(b.backupId)
        this.renderContent()
      } catch (e: any) { this._error = e?.message || 'Promote failed'; this.renderContent() }
    })
    this.querySelector('#bkDemote')?.addEventListener('click', async () => {
      try {
        await demoteBackup(b.backupId)
        this._selectedBackup = await getBackup(b.backupId)
        this.renderContent()
      } catch (e: any) { this._error = e?.message || 'Demote failed'; this.renderContent() }
    })
    this.querySelector('#bkRestoreThis')?.addEventListener('click', () => {
      this._restoreBackupId = b.backupId
      this._restoreStep = 1
      this._restorePlan = null
      this._restoreResult = null
      this._tab = 'restore'
      this.renderTabs()
      this.renderContent()
    })
    this.querySelector('#bkDelete')?.addEventListener('click', () => this.doDelete(b.backupId))
  }

  private async doValidate(deep: boolean) {
    const b = this._selectedBackup!
    try {
      this._validateResult = await validateBackup(b.backupId, deep)
      this.renderContent()
    } catch (e: any) {
      this._error = e?.message || 'Validation failed'
      this.renderContent()
    }
  }

  private doDelete(backupId: string) {
    this._showConfirmDialog(
      `Delete backup <strong>${esc(backupId.slice(0, 8))}…</strong> and all its artifacts?`,
      async () => {
        try {
          await deleteBackup(backupId)
          this._selectedBackup = null
          await this.loadBackups()
          this.renderContent()
        } catch (e: any) {
          displayError(e?.message || 'Delete failed', 5000)
        }
      },
    )
  }

  // ─── Restore Tab (Wizard) ──────────────────────────────────────────────────

  private renderRestore() {
    const el = this.querySelector('#bkContent') as HTMLElement
    if (!el) return

    const steps = ['Select Backup', 'Restore Scope', 'Review Plan', 'Execute']
    let html = `<div class="bk-wizard-steps">${steps.map((s, i) => {
      const step = i + 1
      let cls = ''
      if (step === this._restoreStep) cls = 'active'
      else if (step < this._restoreStep) cls = 'done'
      return `<div class="bk-wizard-step ${cls}">${step}. ${s}</div>`
    }).join('')}</div>`

    html += `<div class="bk-banner-danger">&#9888; <strong>Warning:</strong> Restore is a destructive operation that will overwrite current cluster state.</div>`

    switch (this._restoreStep) {
      case 0:
      case 1:
        html += this.renderRestoreStep1()
        break
      case 2:
        html += this.renderRestoreStep2()
        break
      case 3:
        html += this.renderRestoreStep3()
        break
      case 4:
        html += this.renderRestoreStep4()
        break
    }

    el.innerHTML = html
    this.bindRestoreEvents()
  }

  private renderRestoreStep1(): string {
    return `<div class="bk-panel"><div class="bk-panel-header"><span>Select Backup to Restore</span></div>
      <div style="overflow-x:auto">
      ${this._backups.length === 0
        ? `<p class="bk-empty">No backups available. Load backups first.</p>`
        : `<table class="bk-table"><thead><tr>
            <th>Backup ID</th><th>Created</th><th>Mode</th><th>Plan</th><th>Size</th><th>Quality</th><th></th>
          </tr></thead><tbody>${this._backups.filter(b => b.mode === 2).map(b => `
            <tr>
              <td style="font-family:monospace;font-size:.78rem">${esc(b.backupId.slice(0, 8))}</td>
              <td>${fmtMs(b.createdMs)}</td>
              <td>${esc(BACKUP_MODE[b.mode] ?? '—')}</td>
              <td>${esc(b.planName || '—')}</td>
              <td>${fmtBytes(b.totalBytes)}</td>
              <td>${badge(QUALITY[b.qualityState] ?? '—', qualityColor(b.qualityState))}</td>
              <td><button class="bk-btn-primary bk-select-restore" data-bid="${esc(b.backupId)}">Select</button></td>
            </tr>
          `).join('')}</tbody></table>`}
      </div></div>`
  }

  private renderRestoreStep2(): string {
    return `<div class="bk-panel"><div class="bk-panel-header"><span>Restore Scope</span></div>
      <div class="bk-detail-section">
        <p style="font-size:.85rem;margin:0 0 12px">Selected backup: <code>${esc(this._restoreBackupId.slice(0, 12))}</code></p>
        <div class="bk-checkbox"><input type="checkbox" id="bkRetcd" ${this._restoreOpts.includeEtcd ? 'checked' : ''}><label for="bkRetcd">Include etcd</label></div>
        <div class="bk-checkbox"><input type="checkbox" id="bkRconfig" ${this._restoreOpts.includeConfig ? 'checked' : ''}><label for="bkRconfig">Include config</label></div>
        <div class="bk-checkbox"><input type="checkbox" id="bkRminio" ${this._restoreOpts.includeMinio ? 'checked' : ''}><label for="bkRminio">Include MinIO</label></div>
        <div class="bk-checkbox"><input type="checkbox" id="bkRscylla" ${this._restoreOpts.includeScylla ? 'checked' : ''}><label for="bkRscylla">Include ScyllaDB</label></div>
        <div style="margin-top:16px">
          <button class="bk-btn" id="bkRestoreBack1">&larr; Back</button>
          <button class="bk-btn-primary" id="bkRestoreNext2" style="margin-left:8px">Generate Restore Plan &rarr;</button>
        </div>
      </div></div>`
  }

  private renderRestoreStep3(): string {
    if (!this._restorePlan) {
      return `<p style="color:var(--secondary-text-color);font-size:.85rem">Loading restore plan...</p>`
    }
    const plan = this._restorePlan
    let html = `<div class="bk-panel"><div class="bk-panel-header"><span>Restore Plan Preview</span></div>
      <div class="bk-detail-section">`

    if (plan.warnings.length > 0) {
      html += `<div class="bk-banner-warn" style="margin-bottom:12px">
        <strong>Warnings:</strong><ul style="margin:4px 0 0;padding-left:1.4em">${plan.warnings.map(w =>
          `<li>[${esc(SEV[w.severity] ?? '?')}] ${esc(w.message)}</li>`
        ).join('')}</ul></div>`
    }

    if (plan.steps.length > 0) {
      html += `<div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--secondary-text-color);margin-bottom:8px">Restore Steps</div>
        <ol style="margin:0;padding-left:1.4em;font-size:.85rem;line-height:1.8">${plan.steps.map(s =>
          `<li><strong>${esc(s.title)}</strong>${s.details ? `<br><span style="color:var(--secondary-text-color);font-size:.78rem">${esc(s.details)}</span>` : ''}</li>`
        ).join('')}</ol>`
    }

    html += `<div style="margin-top:16px">
      <button class="bk-btn" id="bkRestoreBack2">&larr; Back</button>
      <button class="bk-btn-danger" id="bkRestoreExecute" style="margin-left:8px">Execute Restore</button>
    </div></div></div>`
    return html
  }

  private renderRestoreStep4(): string {
    if (!this._restoreResult) {
      return `<p style="color:var(--secondary-text-color);font-size:.85rem">Executing restore...</p>`
    }
    const r = this._restoreResult
    let html = `<div class="bk-panel"><div class="bk-panel-header"><span>Restore ${r.dryRun ? '(Dry Run)' : 'Initiated'}</span></div>
      <div class="bk-detail-section">`

    if (r.jobId) {
      html += `<p style="font-size:.85rem">Restore job started: <code>${esc(r.jobId)}</code></p>
        <p style="font-size:.85rem;color:var(--secondary-text-color)">Track progress in the Jobs tab.</p>
        <button class="bk-btn-primary" id="bkGoToRestoreJob">View Job &rarr;</button>`
    }

    if (r.warnings.length > 0) {
      html += `<div class="bk-banner-warn" style="margin-top:12px">
        <strong>Warnings:</strong><ul style="margin:4px 0 0;padding-left:1.4em">${r.warnings.map(w =>
          `<li>${esc(w.message)}</li>`
        ).join('')}</ul></div>`
    }

    html += `</div></div>`
    return html
  }

  private bindRestoreEvents() {
    // Step 1: select backup
    this.querySelectorAll<HTMLButtonElement>('.bk-select-restore').forEach(btn => {
      btn.addEventListener('click', () => {
        this._restoreBackupId = btn.dataset.bid ?? ''
        this._restoreStep = 2
        this.renderContent()
      })
    })

    // Step 2: scope
    this.querySelector('#bkRestoreBack1')?.addEventListener('click', () => {
      this._restoreStep = 1; this.renderContent()
    })
    this.querySelector('#bkRestoreNext2')?.addEventListener('click', async () => {
      // Read checkbox state
      this._restoreOpts.includeEtcd = (this.querySelector('#bkRetcd') as HTMLInputElement)?.checked ?? true
      this._restoreOpts.includeConfig = (this.querySelector('#bkRconfig') as HTMLInputElement)?.checked ?? true
      this._restoreOpts.includeMinio = (this.querySelector('#bkRminio') as HTMLInputElement)?.checked ?? true
      this._restoreOpts.includeScylla = (this.querySelector('#bkRscylla') as HTMLInputElement)?.checked ?? true

      this._restoreStep = 3
      this._restorePlan = null
      this.renderContent()
      try {
        const result = await restorePlan(this._restoreBackupId, this._restoreOpts)
        this._restorePlan = {
          steps: result.steps,
          warnings: result.warnings,
          confirmationToken: result.confirmationToken,
        }
        this.renderContent()
      } catch (e: any) {
        this._error = e?.message || 'Restore plan failed'
        this._restoreStep = 2
        this.renderContent()
      }
    })

    // Step 3: review
    this.querySelector('#bkRestoreBack2')?.addEventListener('click', () => {
      this._restoreStep = 2; this.renderContent()
    })
    this.querySelector('#bkRestoreExecute')?.addEventListener('click', async () => {
      this._restoreStep = 4
      this._restoreResult = null
      this.renderContent()
      try {
        this._restoreResult = await restoreBackup(this._restoreBackupId, {
          ...this._restoreOpts,
          confirmationToken: this._restorePlan?.confirmationToken,
        })
        this.renderContent()
      } catch (e: any) {
        this._error = e?.message || 'Restore failed'
        this._restoreStep = 3
        this.renderContent()
      }
    })

    // Step 4: go to job
    this.querySelector('#bkGoToRestoreJob')?.addEventListener('click', () => {
      const jobId = this._restoreResult?.jobId
      if (jobId) {
        this._tab = 'jobs'
        this.renderTabs()
        this.loadJobs().then(() => {
          this._loading = false
          this.renderContent()
          this.selectJob(jobId)
        })
      }
    })
  }

  // ─── Settings Tab ──────────────────────────────────────────────────────────

  private _settingsDirty = false
  private _scopeConfig = { etcd: true, scylla: false, minio: false, restic: true }
  private _policyConfig = { ProviderTimeoutSeconds: 600, MaxConcurrentJobs: 1, HookStrict: false, CompressCapsule: false }
  private _scheduleInterval = 'daily'
  private _retentionConfig = { RetentionKeepLastN: 0, RetentionKeepDays: 0, RetentionMaxTotalBytes: 0 }

  private renderSettings() {
    const el = this.querySelector('#bkContent') as HTMLElement
    if (!el) return

    const LABEL = `font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--secondary-text-color);display:block;margin-bottom:2px`
    const INPUT = `width:100%;max-width:480px;box-sizing:border-box;padding:6px 10px;font-size:.85rem;border:1px solid var(--border-subtle-color);border-radius:var(--md-shape-sm);background:transparent;color:var(--on-surface-color)`
    const SECTION = `max-width:960px`

    el.innerHTML = `
      <div style="${SECTION}">

      <!-- Unsaved banner -->
      <div id="bkUnsavedBanner" style="display:none;position:sticky;top:0;z-index:10;padding:8px 14px;margin-bottom:12px;background:color-mix(in srgb, #f59e0b 12%, var(--md-surface-container));border:1px solid #f59e0b;border-radius:var(--md-shape-sm);display:none;align-items:center;justify-content:space-between">
        <span style="font-size:.85rem;font-weight:600;color:#f59e0b">Unsaved changes</span>
        <button class="bk-btn-primary" id="bkSaveAll">Save All</button>
      </div>

      <!-- 1. MinIO Connection -->
      <div class="bk-panel">
        <div class="bk-panel-header"><span>MinIO Object Storage</span></div>
        <div class="bk-detail-section">
          <p style="font-size:.85rem;margin:0 0 12px;color:var(--secondary-text-color)">
            All backups are stored in <strong>MinIO S3-compatible buckets</strong>. Configure the connection to your MinIO instance, then create or select buckets for backup storage.
          </p>

          <!-- Connection settings -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:560px;margin-bottom:12px">
            <div>
              <label style="${LABEL}">Endpoint</label>
              <input id="bkMinioEndpoint" value="${esc(this._minioConfig.MinioEndpoint)}" placeholder="127.0.0.1:9000" style="${INPUT}">
            </div>
            <div>
              <label style="${LABEL}">Protocol</label>
              <select id="bkMinioSecure" style="${INPUT}">
                <option value="true" ${this._minioConfig.MinioSecure ? 'selected' : ''}>HTTPS</option>
                <option value="false" ${!this._minioConfig.MinioSecure ? 'selected' : ''}>HTTP</option>
              </select>
            </div>
            <div>
              <label style="${LABEL}">Access Key</label>
              <input id="bkMinioAccessKey" value="${esc(this._minioConfig.MinioAccessKey)}" placeholder="minioadmin" style="${INPUT}" autocomplete="off">
            </div>
            <div>
              <label style="${LABEL}">Secret Key</label>
              <input id="bkMinioSecretKey" type="password" value="${esc(this._minioConfig.MinioSecretKey)}" placeholder="minioadmin" style="${INPUT}" autocomplete="off">
            </div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:16px">
            <button class="bk-btn-primary" id="bkMinioTest">Test Connection</button>
            <span id="bkMinioTestResult" style="font-size:.82rem"></span>
          </div>

          <!-- Bucket list -->
          <div style="border-top:1px solid var(--border-subtle-color);padding-top:12px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
              <label style="font-size:.88rem;font-weight:600">Buckets</label>
              <button class="bk-btn" id="bkMinioRefresh" style="font-size:.75rem;padding:2px 10px">Refresh</button>
            </div>
            <div id="bkMinioBucketList"></div>
            <div style="margin-top:10px;display:flex;gap:8px;align-items:end">
              <div style="flex:1;max-width:260px">
                <label style="${LABEL}">New Bucket</label>
                <input id="bkMinioNewBucket" placeholder="globular-backups" style="${INPUT}">
              </div>
              <div style="display:flex;gap:6px">
                <label class="bk-checkbox" style="font-size:.78rem;white-space:nowrap">
                  <input type="checkbox" id="bkMinioSetDest" checked> Add as destination
                </label>
                <label class="bk-checkbox" style="font-size:.78rem;white-space:nowrap">
                  <input type="checkbox" id="bkMinioSetScylla"> Use for ScyllaDB
                </label>
              </div>
              <button class="bk-btn-primary" id="bkMinioCreateBucket" style="white-space:nowrap">Create Bucket</button>
            </div>
            <div id="bkMinioCreateResult" style="margin-top:6px;font-size:.82rem"></div>
          </div>
        </div>
      </div>

      <!-- 1b. Backup Destinations -->
      <div class="bk-panel">
        <div class="bk-panel-header"><span>Backup Destinations</span></div>
        <div class="bk-detail-section">
          <p style="font-size:.85rem;margin:0 0 12px;color:var(--secondary-text-color)">
            Capsules are replicated to every destination listed here. MinIO buckets created above are auto-added. You can also add external S3/rclone targets.
          </p>
          <div id="bkStorageCards"></div>
          <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
            <button class="bk-btn bk-add-storage" data-type="s3">+ S3 / MinIO</button>
            <button class="bk-btn bk-add-storage" data-type="rclone">+ Remote via rclone</button>
            <button class="bk-btn bk-add-storage" data-type="local">+ Local Disk</button>
          </div>
          <div id="bkStorageMsg" style="margin-top:8px"></div>
        </div>
      </div>

      <!-- 2. Backup Scope -->
      <div class="bk-panel">
        <div class="bk-panel-header"><span>Backup Scope</span></div>
        <div class="bk-detail-section">
          <p style="font-size:.85rem;margin:0 0 12px;color:var(--secondary-text-color)">
            Choose what parts of the cluster are protected. Unchecked items are skipped during backup.
          </p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;max-width:480px" id="bkScopeGrid">
            <div class="bk-card" style="padding:10px 14px">
              <label class="bk-checkbox"><input type="checkbox" data-scope="etcd" checked> <strong>Cluster Metadata</strong></label>
              <div style="font-size:.75rem;color:var(--secondary-text-color);margin-top:2px">etcd snapshots &mdash; cluster state, service registry, configuration</div>
            </div>
            <div class="bk-card" style="padding:10px 14px">
              <label class="bk-checkbox"><input type="checkbox" data-scope="scylla"> <strong>Databases</strong></label>
              <div style="font-size:.75rem;color:var(--secondary-text-color);margin-top:2px">ScyllaDB via scylla-manager &mdash; requires cluster registration</div>
            </div>
            <div class="bk-card" style="padding:10px 14px">
              <label class="bk-checkbox"><input type="checkbox" data-scope="minio"> <strong>Object Storage</strong></label>
              <div style="font-size:.75rem;color:var(--secondary-text-color);margin-top:2px">MinIO data sync via rclone &mdash; requires remote configuration</div>
            </div>
            <div class="bk-card" style="padding:10px 14px">
              <label class="bk-checkbox"><input type="checkbox" data-scope="restic" checked> <strong>Node Filesystems</strong></label>
              <div style="font-size:.75rem;color:var(--secondary-text-color);margin-top:2px">Restic snapshots of data directories on every node</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 3. Backup Policy -->
      <div class="bk-panel">
        <div class="bk-panel-header"><span>Backup Policy</span></div>
        <div class="bk-detail-section">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:480px">
            <div>
              <label style="${LABEL}">Timeout</label>
              <div style="display:flex;align-items:center;gap:6px">
                <input id="bkPolicyTimeout" type="number" min="60" step="60" style="${INPUT};max-width:100px">
                <span style="font-size:.82rem;color:var(--secondary-text-color)">seconds</span>
              </div>
            </div>
            <div>
              <label style="${LABEL}">Parallelism</label>
              <div style="display:flex;align-items:center;gap:6px">
                <input id="bkPolicyParallel" type="number" min="1" max="16" style="${INPUT};max-width:80px">
                <span style="font-size:.82rem;color:var(--secondary-text-color)">concurrent jobs</span>
              </div>
            </div>
          </div>
          <div style="margin-top:12px">
            <label style="${LABEL}">Consistency Mode</label>
            <label class="bk-checkbox"><input type="radio" name="bkHookMode" value="hooks"> Service hooks (quiesce before backup)</label>
            <label class="bk-checkbox"><input type="radio" name="bkHookMode" value="best-effort" checked> Best effort</label>
          </div>
          <div style="margin-top:12px">
            <label style="${LABEL}">Archiving</label>
            <label class="bk-checkbox"><input type="checkbox" id="bkCompressCapsule"> Compress capsules (tar.gz) before replication</label>
            <div style="font-size:.72rem;color:var(--secondary-text-color);margin-top:2px">Reduces transfer size for S3/NFS/rclone targets. Local storage is always uncompressed for fast access.</div>
          </div>
          <div style="margin-top:16px">
            <label style="${LABEL}">Automatic Backup Schedule</label>
            <div style="display:flex;align-items:center;gap:8px">
              <select id="bkScheduleInterval" style="${INPUT};max-width:200px">
                <option value="0">Disabled (manual only)</option>
                <option value="hourly">Every hour</option>
                <option value="6h">Every 6 hours</option>
                <option value="12h">Every 12 hours</option>
                <option value="daily">Daily (24h)</option>
                <option value="weekly">Weekly</option>
              </select>
            </div>
            <div style="font-size:.72rem;color:var(--secondary-text-color);margin-top:2px">Cluster backups run automatically at this interval. Skipped if a job is already running.</div>
          </div>
        </div>
      </div>

      <!-- 4. Advanced Provider Settings (collapsed) -->
      <div class="bk-panel">
        <div class="bk-panel-header" style="cursor:pointer" id="bkAdvProvToggle">
          <span id="bkAdvProvArrow" style="transition:transform .2s;display:inline-block">&#9654;</span>
          <span style="margin-left:6px;flex:1">Advanced Provider Settings</span>
        </div>
        <div id="bkAdvProvBody" style="display:none">
          <div class="bk-detail-section" id="bkProvCfgEditor"></div>
        </div>
      </div>

      <!-- 5. Preflight Check -->
      <div class="bk-panel">
        <div class="bk-panel-header"><span>Backup Tools Status</span></div>
        <div class="bk-detail-section">
          <button class="bk-btn-primary" id="bkRunPreflight">Run Preflight Check</button>
          <div id="bkPreflightResult" style="margin-top:12px"></div>
        </div>
      </div>

      <!-- 6. Retention -->
      <div class="bk-panel">
        <div class="bk-panel-header"><span>Retention Policy</span></div>
        <div class="bk-detail-section">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;max-width:600px">
            <div>
              <label style="${LABEL}">Keep last backups</label>
              <input id="bkRetKeepN" type="number" min="0" placeholder="0 = unlimited" style="${INPUT};max-width:120px">
            </div>
            <div>
              <label style="${LABEL}">Delete older than</label>
              <div style="display:flex;align-items:center;gap:6px">
                <input id="bkRetKeepDays" type="number" min="0" placeholder="0" style="${INPUT};max-width:80px">
                <span style="font-size:.82rem;color:var(--secondary-text-color)">days</span>
              </div>
            </div>
            <div>
              <label style="${LABEL}">Max storage</label>
              <div style="display:flex;align-items:center;gap:6px">
                <input id="bkRetMaxGB" type="number" min="0" step="1" placeholder="0" style="${INPUT};max-width:80px">
                <span style="font-size:.82rem;color:var(--secondary-text-color)">GB</span>
              </div>
            </div>
          </div>
          <div id="bkRetentionResult" style="margin-top:12px"></div>
          <div style="margin-top:10px;display:flex;gap:8px">
            <button class="bk-btn" id="bkRetDryRun">Dry Run</button>
            <button class="bk-btn-danger" id="bkRetExecute">Apply Policy</button>
          </div>
          <div id="bkRetentionRunResult" style="margin-top:12px"></div>
        </div>
      </div>

      </div><!-- /max-width wrapper -->
    `

    // --- Bind events ---
    this.querySelector('#bkSaveAll')?.addEventListener('click', () => this.saveAllSettings())

    // MinIO connection
    const minioInputs = ['bkMinioEndpoint', 'bkMinioAccessKey', 'bkMinioSecretKey'] as const
    minioInputs.forEach(id => {
      const el = this.querySelector(`#${id}`) as HTMLInputElement
      el?.addEventListener('input', () => {
        const key = id.replace('bkMinio', 'Minio') as keyof typeof this._minioConfig
        ;(this._minioConfig as any)[key] = el.value
        this.markDirty()
      })
    })
    const secureEl = this.querySelector('#bkMinioSecure') as HTMLSelectElement
    secureEl?.addEventListener('change', () => {
      this._minioConfig.MinioSecure = secureEl.value === 'true'
      this.markDirty()
    })
    this.querySelector('#bkMinioTest')?.addEventListener('click', () => this.testMinioConnection())
    this.querySelector('#bkMinioRefresh')?.addEventListener('click', () => this.loadMinioBuckets())
    this.querySelector('#bkMinioCreateBucket')?.addEventListener('click', () => this.createBucket())

    // Load buckets on open
    this.loadMinioBuckets()

    // Storage
    this.querySelectorAll<HTMLButtonElement>('.bk-add-storage').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = btn.dataset.type!
        const name = t === 's3' ? 'minio' : t
        this._destinations.push({ Name: name, Type: t === 's3' ? 'minio' : t, Path: '', Options: {}, Primary: false })
        this.renderStorageCards()
        this.markDirty()
      })
    })

    // Scope checkboxes
    this.querySelectorAll<HTMLInputElement>('[data-scope]').forEach(cb => {
      cb.addEventListener('change', () => {
        (this._scopeConfig as any)[cb.dataset.scope!] = cb.checked
        this.markDirty()
      })
    })

    // Policy inputs
    const timeoutEl = this.querySelector('#bkPolicyTimeout') as HTMLInputElement
    const parallelEl = this.querySelector('#bkPolicyParallel') as HTMLInputElement
    timeoutEl?.addEventListener('input', () => { this._policyConfig.ProviderTimeoutSeconds = Number(timeoutEl.value) || 600; this.markDirty() })
    parallelEl?.addEventListener('input', () => { this._policyConfig.MaxConcurrentJobs = Number(parallelEl.value) || 1; this.markDirty() })
    this.querySelectorAll<HTMLInputElement>('[name="bkHookMode"]').forEach(r => {
      r.addEventListener('change', () => { this._policyConfig.HookStrict = r.value === 'hooks'; this.markDirty() })
    })
    const compressEl = this.querySelector('#bkCompressCapsule') as HTMLInputElement
    compressEl?.addEventListener('change', () => { this._policyConfig.CompressCapsule = compressEl.checked; this.markDirty() })
    const schedEl = this.querySelector('#bkScheduleInterval') as HTMLSelectElement
    schedEl?.addEventListener('change', () => { this._scheduleInterval = schedEl.value; this.markDirty() })

    // Retention inputs
    const retN = this.querySelector('#bkRetKeepN') as HTMLInputElement
    const retDays = this.querySelector('#bkRetKeepDays') as HTMLInputElement
    const retGB = this.querySelector('#bkRetMaxGB') as HTMLInputElement
    retN?.addEventListener('input', () => { this._retentionConfig.RetentionKeepLastN = Number(retN.value) || 0; this.markDirty() })
    retDays?.addEventListener('input', () => { this._retentionConfig.RetentionKeepDays = Number(retDays.value) || 0; this.markDirty() })
    retGB?.addEventListener('input', () => { this._retentionConfig.RetentionMaxTotalBytes = (Number(retGB.value) || 0) * 1024 * 1024 * 1024; this.markDirty() })

    // Advanced toggle
    this.querySelector('#bkAdvProvToggle')?.addEventListener('click', () => {
      const body = this.querySelector('#bkAdvProvBody') as HTMLElement
      const arrow = this.querySelector('#bkAdvProvArrow') as HTMLElement
      if (body.style.display === 'none') {
        body.style.display = 'block'
        arrow.style.transform = 'rotate(90deg)'
      } else {
        body.style.display = 'none'
        arrow.style.transform = ''
      }
    })

    this.querySelector('#bkRunPreflight')?.addEventListener('click', () => this.runPreflightFromSettings())
    this.querySelector('#bkRetDryRun')?.addEventListener('click', () => this.doRetention(true))
    this.querySelector('#bkRetExecute')?.addEventListener('click', () => this.doRetention(false))

    // Preloaded state
    if (this._preflight) this.renderPreflightResult()

    // Auto-load config
    this.loadAllSettings()
  }

  private markDirty() {
    this._settingsDirty = true
    const banner = this.querySelector('#bkUnsavedBanner') as HTMLElement
    if (banner) banner.style.display = 'flex'
  }

  private clearDirty() {
    this._settingsDirty = false
    const banner = this.querySelector('#bkUnsavedBanner') as HTMLElement
    if (banner) banner.style.display = 'none'
  }

  private async loadAllSettings() {
    try {
      const cfg = await getConfig()
      if (!cfg?.Services) throw new Error('No services in config')
      const svcKey = Object.keys(cfg.Services).find(k => {
        const s = cfg.Services![k]
        return s?.Name?.includes('backup_manager') || s?.Name?.includes('BackupManager')
      })
      if (!svcKey) throw new Error('backup_manager service not found')
      const svc = cfg.Services[svcKey] as any
      this._serviceId = svc.Id || svcKey
      this._serviceConfig = svc

      // Destinations
      this._destinations = (svc.Destinations || []).map((d: any) => ({
        Name: d.Name || '', Type: d.Type || 'local', Path: d.Path || '',
        Options: d.Options || {}, Primary: d.Primary || false,
      }))
      if (this._destinations.length === 0) {
        this._destinations = [{ Name: 'local', Type: 'local', Path: '/var/lib/globular/backups', Options: {}, Primary: true }]
      }

      // Provider config
      this._providerConfig = {
        ScyllaCluster: svc.ScyllaCluster || '', ScyllaLocation: svc.ScyllaLocation || '',
        ScyllaManagerAPI: svc.ScyllaManagerAPI || 'http://127.0.0.1:5080',
        RcloneRemote: svc.RcloneRemote || '', RcloneSource: svc.RcloneSource || '',
        EtcdEndpoints: svc.EtcdEndpoints || '127.0.0.1:2379',
        ResticRepo: svc.ResticRepo || '/var/lib/globular/backups/restic',
        ResticPaths: svc.ResticPaths || '/var/lib/globular',
      }

      // Policy
      this._policyConfig = {
        ProviderTimeoutSeconds: svc.ProviderTimeoutSeconds || 600,
        MaxConcurrentJobs: svc.MaxConcurrentJobs || 1,
        HookStrict: svc.HookStrict || false,
        CompressCapsule: svc.CompressCapsule || false,
      }

      // Retention
      this._retentionConfig = {
        RetentionKeepLastN: svc.RetentionKeepLastN || 0,
        RetentionKeepDays: svc.RetentionKeepDays || 0,
        RetentionMaxTotalBytes: svc.RetentionMaxTotalBytes || 0,
      }

      // Schedule
      this._scheduleInterval = svc.ScheduleInterval || '0'

      // MinIO connection
      this._minioConfig = {
        MinioEndpoint: svc.MinioEndpoint || '127.0.0.1:9000',
        MinioAccessKey: svc.MinioAccessKey || '',
        MinioSecretKey: svc.MinioSecretKey || '',
        MinioSecure: svc.MinioSecure ?? true,
      }

      // Scope: derive from ClusterDefaultProviders, but also auto-enable
      // providers that are configured (e.g. scylla when ScyllaCluster is set).
      const defaults: string[] = svc.ClusterDefaultProviders || ['etcd', 'scylla', 'restic', 'minio']
      this._scopeConfig = {
        etcd: defaults.includes('etcd'),
        scylla: (defaults.includes('scylla') || !!svc.ScyllaCluster),
        minio: (defaults.includes('minio') || !!svc.RcloneRemote),
        restic: defaults.includes('restic'),
      }

      // Populate UI
      this.renderStorageCards()
      this.renderProvCfgEditor()
      this.populatePolicyUI()
      this.populateRetentionUI()
      this.populateScopeUI()
      this.clearDirty()

      // Also load retention status
      try {
        this._retention = await getRetentionStatus()
        this.renderRetentionStatus()
      } catch (_) { /* retention status is optional */ }
    } catch (e: any) {
      const msg = this.querySelector('#bkStorageMsg') as HTMLElement
      if (msg) msg.innerHTML = `<div class="bk-banner-warn">Failed to load config: ${esc(e?.message ?? '')}</div>`
    }
  }

  private populateScopeUI() {
    for (const [key, val] of Object.entries(this._scopeConfig)) {
      const cb = this.querySelector(`[data-scope="${key}"]`) as HTMLInputElement
      if (cb) cb.checked = val
    }
  }

  private populatePolicyUI() {
    const t = this.querySelector('#bkPolicyTimeout') as HTMLInputElement
    const p = this.querySelector('#bkPolicyParallel') as HTMLInputElement
    if (t) t.value = String(this._policyConfig.ProviderTimeoutSeconds)
    if (p) p.value = String(this._policyConfig.MaxConcurrentJobs)
    const hookMode = this._policyConfig.HookStrict ? 'hooks' : 'best-effort'
    const radio = this.querySelector(`[name="bkHookMode"][value="${hookMode}"]`) as HTMLInputElement
    if (radio) radio.checked = true
    const compress = this.querySelector('#bkCompressCapsule') as HTMLInputElement
    if (compress) compress.checked = this._policyConfig.CompressCapsule
    const sched = this.querySelector('#bkScheduleInterval') as HTMLSelectElement
    if (sched) sched.value = this._scheduleInterval
  }

  private populateRetentionUI() {
    const n = this.querySelector('#bkRetKeepN') as HTMLInputElement
    const d = this.querySelector('#bkRetKeepDays') as HTMLInputElement
    const g = this.querySelector('#bkRetMaxGB') as HTMLInputElement
    if (n) n.value = this._retentionConfig.RetentionKeepLastN ? String(this._retentionConfig.RetentionKeepLastN) : ''
    if (d) d.value = this._retentionConfig.RetentionKeepDays ? String(this._retentionConfig.RetentionKeepDays) : ''
    if (g) g.value = this._retentionConfig.RetentionMaxTotalBytes ? String(Math.round(this._retentionConfig.RetentionMaxTotalBytes / (1024 * 1024 * 1024))) : ''
  }

  // ─── MinIO Bucket Management ──────────────────────────────────────────────

  private async testMinioConnection() {
    const resultEl = this.querySelector('#bkMinioTestResult') as HTMLElement
    if (resultEl) resultEl.innerHTML = `<span style="color:var(--secondary-text-color)">Connecting...</span>`
    try {
      // Save MinIO config first so the backend can use it
      await this.saveMinioConfig()
      const res = await listMinioBuckets()
      this._minioBuckets = res.buckets
      this._minioEndpoint = res.endpoint
      if (resultEl) resultEl.innerHTML = `<span style="color:var(--success-color)">&#10003; Connected &mdash; ${res.buckets.length} bucket(s) on ${esc(res.endpoint)}</span>`
      this.renderMinioBucketList()
    } catch (e: any) {
      if (resultEl) resultEl.innerHTML = `<span style="color:var(--error-color)">&#10007; ${esc(e?.message ?? 'Connection failed')}</span>`
    }
  }

  private async loadMinioBuckets() {
    const listEl = this.querySelector('#bkMinioBucketList') as HTMLElement
    if (listEl) listEl.innerHTML = `<p style="font-size:.82rem;color:var(--secondary-text-color)">Loading buckets...</p>`
    try {
      const res = await listMinioBuckets()
      this._minioBuckets = res.buckets
      this._minioEndpoint = res.endpoint
      this.renderMinioBucketList()
    } catch (e: any) {
      if (listEl) listEl.innerHTML = `<p style="font-size:.82rem;color:var(--secondary-text-color)">
        Could not list buckets. ${esc(e?.message ?? '')}
        <br><span style="font-size:.75rem">Configure MinIO credentials above and click <strong>Test Connection</strong>.</span></p>`
    }
  }

  private renderMinioBucketList() {
    const el = this.querySelector('#bkMinioBucketList') as HTMLElement
    if (!el) return
    if (this._minioBuckets.length === 0) {
      el.innerHTML = `<p style="font-size:.82rem;color:var(--secondary-text-color)">No buckets found. Create one below.</p>`
      return
    }

    // Check which buckets are already configured as destinations
    const destBuckets = new Set(this._destinations.filter(d => d.Type === 'minio').map(d => d.Path))

    el.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:8px">${this._minioBuckets.map(b => {
      const isDest = destBuckets.has(b.name)
      return `<div class="bk-card" style="padding:8px 12px;display:flex;align-items:center;gap:10px;min-width:200px">
        <div style="flex:1;min-width:0">
          <strong style="font-size:.85rem">${esc(b.name)}</strong>
          <div style="font-size:.72rem;color:var(--secondary-text-color)">${b.creationDate ? new Date(b.creationDate).toLocaleDateString() : ''}</div>
        </div>
        ${isDest
          ? `<span class="bk-badge" style="--badge-color:var(--accent-color);font-size:.68rem">DESTINATION</span>`
          : `<button class="bk-btn bk-use-bucket" data-bucket="${esc(b.name)}" style="font-size:.72rem;padding:2px 8px;white-space:nowrap">Use for Backups</button>`}
        <button class="bk-btn-danger bk-delete-bucket" data-bucket="${esc(b.name)}" style="font-size:.68rem;padding:2px 8px" title="Delete bucket">&#10005;</button>
      </div>`
    }).join('')}</div>`

    el.querySelectorAll<HTMLButtonElement>('.bk-use-bucket').forEach(btn => {
      btn.addEventListener('click', () => {
        const bucket = btn.dataset.bucket!
        this.addMinioBucketAsDestination(bucket)
        this.renderMinioBucketList()
        this.renderStorageCards()
        this.markDirty()
      })
    })

    el.querySelectorAll<HTMLButtonElement>('.bk-delete-bucket').forEach(btn => {
      btn.addEventListener('click', () => {
        const bucket = btn.dataset.bucket!
        this._showConfirmDialog(
          `Delete MinIO bucket <strong>${esc(bucket)}</strong> and all its contents?<br><br>
           <label class="bk-checkbox" style="font-size:.82rem"><input type="checkbox" id="bkForceDeleteBucket" checked> Force delete (remove all objects first)</label>`,
          async () => {
            const force = !!(this.querySelector('#bkForceDeleteBucket') as HTMLInputElement)?.checked
            try {
              const res = await deleteMinioBucket({ name: bucket, force })
              displayMessage(res.message, 4000)
              await this.loadMinioBuckets()
              this.renderStorageCards()
            } catch (e: any) {
              displayError(e?.message || 'Delete failed', 5000)
            }
          }
        )
      })
    })
  }

  private addMinioBucketAsDestination(bucket: string) {
    // Don't add duplicates
    if (this._destinations.some(d => d.Type === 'minio' && d.Path === bucket)) return

    const scheme = this._minioConfig.MinioSecure ? 'https' : 'http'
    this._destinations.push({
      Name: 'minio-' + bucket,
      Type: 'minio',
      Path: bucket,
      Options: {
        endpoint: `${scheme}://${this._minioConfig.MinioEndpoint}`,
        access_key: this._minioConfig.MinioAccessKey,
        secret_key: this._minioConfig.MinioSecretKey,
      },
      Primary: this._destinations.length === 0,
    })
  }

  private async createBucket() {
    const nameEl = this.querySelector('#bkMinioNewBucket') as HTMLInputElement
    const resultEl = this.querySelector('#bkMinioCreateResult') as HTMLElement
    const name = nameEl?.value?.trim()
    if (!name) {
      if (resultEl) resultEl.innerHTML = `<span style="color:var(--error-color)">Enter a bucket name</span>`
      return
    }

    const setDest = (this.querySelector('#bkMinioSetDest') as HTMLInputElement)?.checked ?? true
    const setScylla = (this.querySelector('#bkMinioSetScylla') as HTMLInputElement)?.checked ?? false

    if (resultEl) resultEl.innerHTML = `<span style="color:var(--secondary-text-color)">Creating...</span>`
    try {
      // Save MinIO config first
      await this.saveMinioConfig()
      const res = await createMinioBucket({ name, setAsBackupDestination: setDest, setAsScyllaLocation: setScylla })
      if (resultEl) resultEl.innerHTML = `<span style="color:var(--success-color)">&#10003; ${esc(res.message)}</span>`
      if (nameEl) nameEl.value = ''

      // If setDest, also add to local destinations list
      if (setDest) {
        this.addMinioBucketAsDestination(name)
        this.renderStorageCards()
      }
      if (setScylla) {
        this._providerConfig.ScyllaLocation = 's3:' + name
        this.renderProvCfgEditor()
      }

      // Refresh bucket list
      await this.loadMinioBuckets()
      this.markDirty()
    } catch (e: any) {
      if (resultEl) resultEl.innerHTML = `<span style="color:var(--error-color)">&#10007; ${esc(e?.message ?? 'Create failed')}</span>`
    }
  }

  private async saveMinioConfig() {
    if (!this._serviceId) return
    await saveServiceConfig({
      Id: this._serviceId,
      MinioEndpoint: this._minioConfig.MinioEndpoint,
      MinioAccessKey: this._minioConfig.MinioAccessKey,
      MinioSecretKey: this._minioConfig.MinioSecretKey,
      MinioSecure: this._minioConfig.MinioSecure,
    } as any)
  }

  // ─── Destination Cards ──────────────────────────────────────────────────────

  private renderStorageCards() {
    const el = this.querySelector('#bkStorageCards') as HTMLElement
    if (!el) return
    const DEST_TYPES = ['local', 'minio', 'nfs', 's3', 'rclone']
    const typeLabel: Record<string, string> = { local: 'Local Disk', minio: 'S3 / MinIO', nfs: 'NFS Mount', s3: 'AWS S3', rclone: 'Rclone Remote' }
    const INPUT = `width:100%;box-sizing:border-box;padding:4px 8px;font-size:.85rem;border:1px solid var(--border-subtle-color);border-radius:var(--md-shape-sm);background:transparent;color:var(--on-surface-color)`
    const LABEL = `font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--secondary-text-color);display:block;margin-bottom:2px`

    if (this._destinations.length === 0) {
      el.innerHTML = `<p class="bk-empty">No storage configured.</p>`
      return
    }

    el.innerHTML = this._destinations.map((d, i) => `
      <div class="bk-card" style="margin-bottom:10px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div style="display:flex;align-items:center;gap:8px">
            ${d.Primary ? `<span class="bk-badge" style="--badge-color:var(--accent-color)">PRIMARY</span>` : ''}
            <strong style="font-size:.9rem">${esc(d.Name || typeLabel[d.Type] || d.Type)}</strong>
            <span style="font-size:.78rem;color:var(--secondary-text-color)">${typeLabel[d.Type] || d.Type}</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            ${!d.Primary ? `<button class="bk-btn bk-dest-set-primary" data-idx="${i}" style="font-size:.72rem;padding:2px 8px">Set Primary</button>` : ''}
            <button class="bk-btn-danger bk-dest-remove" data-idx="${i}" style="padding:2px 8px;font-size:.72rem">Remove</button>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:${d.Type === 'local' || d.Type === 'nfs' ? '140px 1fr' : '140px 1fr 1fr'};gap:8px;align-items:end">
          <div>
            <label style="${LABEL}">Name</label>
            <input class="bk-dest-name" data-idx="${i}" value="${esc(d.Name)}" style="${INPUT}">
          </div>
          <div>
            <label style="${LABEL}">Path</label>
            <input class="bk-dest-path" data-idx="${i}" value="${esc(d.Path)}" placeholder="${d.Type === 'local' ? '/var/lib/globular/backups' : d.Type === 'nfs' ? '/mnt/nfs/backups' : 'bucket/prefix or remote:path'}" style="${INPUT}">
          </div>
          ${d.Type !== 'local' && d.Type !== 'nfs' ? `<div>
            <label style="${LABEL}">Options <span style="font-weight:400;text-transform:none">(key=value per line)</span></label>
            <textarea class="bk-dest-options" data-idx="${i}" rows="3" placeholder="endpoint=https://...&#10;access_key=...&#10;secret_key=..." style="${INPUT};font-family:monospace;font-size:.78rem;resize:vertical;min-height:4.5em;line-height:1.4">${Object.entries(d.Options).map(([k, v]) => {
              const secret = /secret|password|token/i.test(k)
              return `${k}=${secret ? '••••••••' : v}`
            }).join('\n')}</textarea>
          </div>` : ''}
        </div>
      </div>
    `).join('')

    // Bind
    el.querySelectorAll<HTMLInputElement>('.bk-dest-name').forEach(inp => {
      inp.addEventListener('input', () => { this._destinations[Number(inp.dataset.idx)].Name = inp.value; this.markDirty() })
    })
    el.querySelectorAll<HTMLInputElement>('.bk-dest-path').forEach(inp => {
      inp.addEventListener('input', () => { this._destinations[Number(inp.dataset.idx)].Path = inp.value; this.markDirty() })
    })
    el.querySelectorAll<HTMLTextAreaElement>('.bk-dest-options').forEach(ta => {
      ta.addEventListener('input', () => {
        const idx = Number(ta.dataset.idx)
        const prev = this._destinations[idx].Options
        const opts: Record<string, string> = {}
        ta.value.split('\n').forEach(line => {
          const eq = line.indexOf('=')
          if (eq > 0) {
            const k = line.slice(0, eq).trim()
            const v = line.slice(eq + 1).trim()
            // Keep the original secret if the user hasn't changed the masked value
            if (v === '••••••••' && prev[k]) opts[k] = prev[k]
            else opts[k] = v
          }
        })
        this._destinations[idx].Options = opts
        this.markDirty()
      })
    })
    el.querySelectorAll<HTMLButtonElement>('.bk-dest-set-primary').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.idx)
        this._destinations.forEach((d, i) => d.Primary = i === idx)
        this.renderStorageCards()
        this.markDirty()
      })
    })
    el.querySelectorAll<HTMLButtonElement>('.bk-dest-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        this._destinations.splice(Number(btn.dataset.idx), 1)
        this.renderStorageCards()
        this.markDirty()
      })
    })
  }

  private renderProvCfgEditor() {
    const el = this.querySelector('#bkProvCfgEditor') as HTMLElement
    if (!el) return
    const c = this._providerConfig
    const INPUT = `width:100%;max-width:420px;box-sizing:border-box;padding:5px 10px;font-size:.85rem;border:1px solid var(--border-subtle-color);border-radius:var(--md-shape-sm);background:transparent;color:var(--on-surface-color)`
    const LABEL = `font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--secondary-text-color);display:block;margin-bottom:2px`

    const field = (label: string, key: string, value: string, placeholder: string, hint: string) => `
      <div style="margin-bottom:8px">
        <label style="${LABEL}">${label}</label>
        <input class="bk-prov-field" data-key="${key}" value="${esc(value)}" placeholder="${esc(placeholder)}" style="${INPUT}">
        <div style="font-size:.72rem;color:var(--secondary-text-color);margin-top:1px">${hint}</div>
      </div>`

    const section = (title: string, content: string) => `
      <details style="margin-bottom:4px">
        <summary style="cursor:pointer;font-size:.88rem;font-weight:600;padding:8px 0;color:var(--on-surface-color)">${title}</summary>
        <div style="padding:4px 0 8px 16px">${content}</div>
      </details>`

    el.innerHTML =
      section('Restic', `
        ${field('Repository', 'ResticRepo', c.ResticRepo, '/var/lib/globular/backups/restic', 'Local or remote restic repository.')}
        ${field('Backup Paths', 'ResticPaths', c.ResticPaths, '/var/lib/globular', 'Comma-separated filesystem paths.')}
      `) +
      section('ScyllaDB', `
        <div style="display:flex;align-items:end;gap:8px;margin-bottom:8px">
          <div style="flex:1">
            <label style="${LABEL}">Cluster Name</label>
            <input class="bk-prov-field" data-key="ScyllaCluster" value="${esc(c.ScyllaCluster)}" placeholder="my-cluster" style="${INPUT}">
            <div style="font-size:.72rem;color:var(--secondary-text-color);margin-top:1px">Registered via <code>sctool cluster add</code>.</div>
          </div>
          <button class="bk-btn" id="bkDetectScyllaCluster" style="margin-bottom:18px;white-space:nowrap">Detect</button>
        </div>
        <div id="bkDetectedClusters" style="margin-bottom:8px"></div>
        <div style="font-size:.78rem;color:var(--secondary-text-color);margin:6px 0 4px">
          <strong>Backup location:</strong> ScyllaDB requires S3-compatible storage.
          ${c.ScyllaLocation
            ? `Currently: <code>${esc(c.ScyllaLocation)}</code>`
            : `<span style="color:#f59e0b">Not set &mdash; create a MinIO bucket above and check "Use for ScyllaDB".</span>`}
        </div>
        ${field('Scylla Location', 'ScyllaLocation', c.ScyllaLocation, 's3:scylla-backups', 'S3 bucket for ScyllaDB backups (e.g. s3:my-bucket). Set automatically when creating a MinIO bucket with "Use for ScyllaDB".')}
        ${field('Manager API', 'ScyllaManagerAPI', c.ScyllaManagerAPI, 'http://127.0.0.1:5080', 'Scylla-manager HTTP endpoint.')}
      `) +
      section('MinIO / Rclone', `
        <p style="font-size:.78rem;color:var(--secondary-text-color);margin:0 0 8px">MinIO connection is configured in the <strong>MinIO Object Storage</strong> panel above. These settings control the rclone-based MinIO data sync provider.</p>
        ${field('Rclone Remote', 'RcloneRemote', c.RcloneRemote, 'myremote:backups/minio', 'Rclone remote:path for MinIO data sync.')}
        ${field('Rclone Source', 'RcloneSource', c.RcloneSource, '/var/lib/globular/minio/data', 'Local MinIO data directory.')}
      `) +
      section('etcd', `
        ${field('Endpoints', 'EtcdEndpoints', c.EtcdEndpoints, '127.0.0.1:2379', 'Comma-separated. TLS auto-detected.')}
      `)

    el.querySelectorAll<HTMLInputElement | HTMLSelectElement>('.bk-prov-field').forEach(inp => {
      const evtName = inp.tagName === 'SELECT' ? 'change' : 'input'
      inp.addEventListener(evtName, () => {
        (this._providerConfig as any)[inp.dataset.key!] = inp.value
        this.markDirty()
      })
    })

    // Detect ScyllaDB clusters via preflight
    this.querySelector('#bkDetectScyllaCluster')?.addEventListener('click', async () => {
      const btn = this.querySelector('#bkDetectScyllaCluster') as HTMLButtonElement
      const resultEl = this.querySelector('#bkDetectedClusters') as HTMLElement
      if (btn) btn.disabled = true
      if (resultEl) resultEl.innerHTML = `<span style="font-size:.82rem;color:var(--secondary-text-color)">Detecting...</span>`
      try {
        const pf = await preflightCheck()
        const detected = pf.tools.filter(t => t.name === 'scylla_cluster_detected')
        const managed = detected.filter(d => !d.version.startsWith('native:') && !d.version.startsWith('scylla_host:'))

        if (managed.length > 0) {
          // Registered cluster(s) found — show "Use" buttons
          let html = `<div style="font-size:.78rem;color:var(--secondary-text-color);margin-bottom:4px">Registered in scylla-manager:</div>`
          html += managed.map(d =>
            `<button class="bk-btn bk-use-cluster" data-cluster="${esc(d.version)}" style="font-size:.82rem;padding:3px 10px;margin-right:6px">Use "${esc(d.version)}"</button>`
          ).join('')
          resultEl.innerHTML = html

          resultEl.querySelectorAll<HTMLButtonElement>('.bk-use-cluster').forEach(b => {
            b.addEventListener('click', () => {
              const inp = this.querySelector('[data-key="ScyllaCluster"]') as HTMLInputElement
              if (inp) { inp.value = b.dataset.cluster!; this._providerConfig.ScyllaCluster = b.dataset.cluster!; this.markDirty() }
              resultEl.innerHTML = `<span style="font-size:.82rem;color:var(--success-color)">&#10003; Set to "${esc(b.dataset.cluster!)}"</span>`
            })
          })
        } else if (detected.length === 0) {
          const sctool = pf.tools.find(t => t.name === 'sctool')
          if (!sctool?.available) {
            resultEl.innerHTML = `<span style="font-size:.82rem;color:var(--error-color)">sctool not available &mdash; install scylla-manager first</span>`
          } else {
            resultEl.innerHTML = `<span style="font-size:.82rem;color:#f59e0b">No ScyllaDB detected locally. Verify ScyllaDB is running.</span>`
          }
        } else {
          // Native detected but registration failed — show manual command
          const native = detected.find(d => d.version.startsWith('native:'))
          const hostEntry = detected.find(d => d.version.startsWith('scylla_host:'))
          const nativeName = native ? native.version.replace('native:', '') : 'unknown'
          const scyllaHost = hostEntry ? hostEntry.version.replace('scylla_host:', '') : '127.0.0.1'
          resultEl.innerHTML = `<span style="font-size:.82rem;color:#f59e0b">ScyllaDB detected on <strong>${esc(scyllaHost)}</strong> but auto-registration failed.<br>
            Register manually: <code>sctool cluster add --host ${esc(scyllaHost)} --name "${esc(nativeName)}"</code></span>`
        }
      } catch (e: any) {
        if (resultEl) resultEl.innerHTML = `<span style="font-size:.82rem;color:var(--error-color)">Detection failed: ${esc(e?.message ?? '')}</span>`
      } finally {
        if (btn) btn.disabled = false
      }
    })
  }

  private async saveAllSettings() {
    if (!this._serviceId) return
    // Read latest DOM values
    this.querySelectorAll<HTMLInputElement>('.bk-dest-name').forEach(inp => {
      this._destinations[Number(inp.dataset.idx)].Name = inp.value
    })
    this.querySelectorAll<HTMLInputElement>('.bk-dest-path').forEach(inp => {
      this._destinations[Number(inp.dataset.idx)].Path = inp.value
    })
    this.querySelectorAll<HTMLInputElement>('.bk-prov-field').forEach(inp => {
      (this._providerConfig as any)[inp.dataset.key!] = inp.value
    })

    // Build ClusterDefaultProviders from scope
    const providers: string[] = []
    if (this._scopeConfig.etcd) providers.push('etcd')
    if (this._scopeConfig.scylla) providers.push('scylla')
    if (this._scopeConfig.restic) providers.push('restic')
    if (this._scopeConfig.minio) providers.push('minio')

    const banner = this.querySelector('#bkUnsavedBanner') as HTMLElement
    try {
      await saveServiceConfig({
        Id: this._serviceId,
        Destinations: this._destinations,
        ClusterDefaultProviders: providers,
        ScheduleInterval: this._scheduleInterval,
        ...this._providerConfig,
        ...this._policyConfig,
        ...this._retentionConfig,
        ...this._minioConfig,
      } as any)
      this.clearDirty()
      if (banner) {
        banner.style.display = 'flex'
        banner.innerHTML = `<span style="font-size:.85rem;font-weight:600;color:var(--success-color)">&#10003; Settings saved. Restart backup_manager to apply.</span>`
        setTimeout(() => { if (banner) banner.style.display = 'none' }, 4000)
      }
    } catch (e: any) {
      if (banner) {
        banner.innerHTML = `<span style="font-size:.85rem;font-weight:600;color:var(--error-color)">Save failed: ${esc(e?.message ?? '')}</span>
          <button class="bk-btn-primary" id="bkSaveAll">Retry</button>`
        this.querySelector('#bkSaveAll')?.addEventListener('click', () => this.saveAllSettings())
      }
    }
  }

  private async runPreflightFromSettings() {
    const resultEl = this.querySelector('#bkPreflightResult') as HTMLElement
    if (resultEl) resultEl.innerHTML = `<p style="color:var(--secondary-text-color);font-size:.85rem">Running...</p>`
    try {
      this._preflight = await preflightCheck()
      this.renderPreflightResult()
    } catch (e: any) {
      if (resultEl) resultEl.innerHTML = `<div class="bk-banner-warn">Preflight failed: ${esc(e?.message ?? '')}</div>`
    }
  }

  private renderPreflightResult() {
    const el = this.querySelector('#bkPreflightResult') as HTMLElement
    if (!el || !this._preflight) return
    // Filter out synthetic detection entries — they're handled by the Detect button
    const pf = { ...this._preflight, tools: this._preflight.tools.filter(t => !t.name.endsWith('_detected')) }
    const HINTS: Record<string, string> = {
      sctool: 'Check that scylla-manager is running: <code>systemctl status globular-scylla-manager</code>',
      restic: 'Install restic: <code>apt install restic</code> or download from GitHub',
      etcdctl: 'Install etcdctl from the etcd release package',
      rclone: 'Install rclone: <code>curl https://rclone.org/install.sh | bash</code>',
    }

    el.innerHTML = `
      <div style="margin-bottom:10px">${pf.allOk
        ? `<span style="color:var(--success-color);font-weight:700">&#10003; All tools available</span>`
        : `<span style="color:var(--error-color);font-weight:700">&#10007; Some tools need attention</span>`}
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
      ${pf.tools.map(t => {
        const ok = t.available
        const icon = ok ? (t.errorMessage ? '<span style="color:#f59e0b">&#9888;</span>' : '<span style="color:var(--success-color)">&#10003;</span>') : '<span style="color:var(--error-color)">&#10007;</span>'
        const severity = ok ? (t.errorMessage ? 'warn' : 'ok') : 'error'
        return `<div style="display:flex;align-items:flex-start;gap:10px;padding:6px 10px;border-radius:var(--md-shape-sm);background:${severity === 'error' ? 'color-mix(in srgb, var(--error-color) 6%, transparent)' : severity === 'warn' ? 'color-mix(in srgb, #f59e0b 6%, transparent)' : 'transparent'}">
          <span style="font-size:1.1rem;line-height:1;min-width:20px">${icon}</span>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:baseline;gap:8px">
              <strong style="font-size:.88rem">${esc(t.name)}</strong>
              <span style="font-size:.78rem;color:var(--secondary-text-color)">${esc(t.version || (ok ? 'installed' : 'not found'))}</span>
              ${t.path ? `<span style="font-size:.72rem;font-family:monospace;color:var(--secondary-text-color)">${esc(t.path)}</span>` : ''}
            </div>
            ${t.errorMessage ? `<div style="font-size:.78rem;color:${severity === 'error' ? 'var(--error-color)' : '#f59e0b'};margin-top:2px">${esc(t.errorMessage)}${HINTS[t.name] ? `<br><span style="color:var(--secondary-text-color)">${HINTS[t.name]}</span>` : ''}</div>` : ''}
          </div>
        </div>`
      }).join('')}
      </div>`
  }

  private renderRetentionStatus() {
    const el = this.querySelector('#bkRetentionResult') as HTMLElement
    if (!el || !this._retention) return
    const r = this._retention
    el.innerHTML = `<div style="display:flex;gap:24px;flex-wrap:wrap;font-size:.85rem;margin-top:8px">
      <div><span style="color:var(--secondary-text-color)">Current backups:</span> <strong>${r.currentBackupCount}</strong></div>
      <div><span style="color:var(--secondary-text-color)">Total size:</span> <strong>${fmtBytes(r.currentTotalBytes)}</strong></div>
      <div><span style="color:var(--secondary-text-color)">Oldest:</span> ${fmtMs(r.oldestMs)}</div>
      <div><span style="color:var(--secondary-text-color)">Newest:</span> ${fmtMs(r.newestMs)}</div>
    </div>`
  }

  private async doRetention(dryRun: boolean) {
    const resultEl = this.querySelector('#bkRetentionRunResult') as HTMLElement
    if (resultEl) resultEl.innerHTML = `<p style="color:var(--secondary-text-color);font-size:.85rem">Running...</p>`
    try {
      const res = await runRetention(dryRun)
      if (resultEl) {
        resultEl.innerHTML = `
          <div style="font-size:.85rem">
            <p style="margin:0 0 4px"><strong>${dryRun ? 'Dry Run' : 'Applied'}</strong>: ${esc(res.message || 'Complete')}</p>
            ${res.deletedIds.length > 0 ? `<p style="margin:0;color:var(--error-color)">Deleted: ${res.deletedIds.map(id => esc(id.slice(0, 8))).join(', ')}</p>` : '<p style="margin:0;color:var(--success-color)">No backups need cleanup.</p>'}
          </div>`
      }
    } catch (e: any) {
      if (resultEl) resultEl.innerHTML = `<div class="bk-banner-warn">Retention failed: ${esc(e?.message ?? '')}</div>`
    }
  }

  // ─── Confirmation Dialog (toast-based, like file explorer) ─────────────────

  private _showConfirmDialog(messageHtml: string, onYes: () => void, onNo?: () => void) {
    // Build an overlay + centered card instead of relying on Toastify
    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;'

    const card = document.createElement('div')
    card.style.cssText = `
      background:var(--surface-color,#333);color:var(--on-surface-color,#fff);
      border-radius:8px;padding:24px;max-width:420px;width:90%;
      box-shadow:0 8px 24px rgba(0,0,0,.4);font-family:Roboto,sans-serif;
    `
    card.innerHTML = `
      <div style="margin-bottom:16px;font-size:.95rem;line-height:1.4">${messageHtml}</div>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button class="bk-confirm-no" style="
          background:var(--surface-color,#424242);color:var(--on-surface-color,#fff);
          border:1px solid var(--divider-color,#666);border-radius:4px;
          padding:8px 20px;cursor:pointer;font-size:.85rem;
        ">Cancel</button>
        <button class="bk-confirm-yes" style="
          background:var(--error-color,#d32f2f);color:#fff;border:none;
          border-radius:4px;padding:8px 20px;cursor:pointer;font-size:.85rem;
        ">Yes, delete</button>
      </div>
    `
    overlay.appendChild(card)

    const close = () => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay) }

    card.querySelector('.bk-confirm-yes')!.addEventListener('click', () => {
      close()
      onYes()
    })
    card.querySelector('.bk-confirm-no')!.addEventListener('click', () => {
      close()
      onNo?.()
    })
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { close(); onNo?.() }
    })

    document.body.appendChild(overlay)
  }

  // ─── Main content router ───────────────────────────────────────────────────

  private renderContent() {
    const el = this.querySelector('#bkContent') as HTMLElement
    if (!el) return

    if (this._error) {
      el.innerHTML = `<div class="bk-banner-warn">&#9888; ${esc(this._error)}</div>`
      this._error = ''
      // Still render the tab content below the error
      const wrap = document.createElement('div')
      el.appendChild(wrap)
      this.renderTabInto(wrap)
      return
    }

    if (this._loading) {
      el.innerHTML = `<p style="color:var(--secondary-text-color);font-size:.85rem">Loading...</p>`
      return
    }

    this.renderTabInto(el)
  }

  private renderTabInto(_el: HTMLElement) {
    switch (this._tab) {
      case 'overview': this.renderOverview(); break
      case 'jobs': this.renderJobs(); break
      case 'backups': this.renderBackups(); break
      case 'restore':
        // Need backups for the picker
        if (this._backups.length === 0 && this._restoreStep <= 1) {
          listBackups({ limit: 50 }).then(res => {
            this._backups = res.backups
            this._backupsTotal = res.total
            this.renderRestore()
          }).catch(() => this.renderRestore())
        } else {
          this.renderRestore()
        }
        break
      case 'settings': this.renderSettings(); break
    }
  }
}

customElements.define('page-admin-backups', PageAdminBackups)
