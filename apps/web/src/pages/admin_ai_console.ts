// src/pages/admin_ai_console.ts
//
// AI Console — interactive chat UI for the cluster's ai-executor service.
// Each node runs its own ai-executor backed by a Claude Max OAuth token
// (cluster-shared via etcd). Conversations persist in ScyllaDB so they
// survive page navigation and are listed in the left sidebar.

import "@globular/components/markdown.js"  // registers <globular-markdown embedded>

import {
  sendPrompt,
  listConversations,
  getConversation,
  deleteConversation as sdkDeleteConversation,
  listClusterNodes,
  getUsername,
  type ClusterNode,
  type PromptResult,
  type ConversationSummary,
  type ConversationMessage as SdkConversationMessage,
} from '@globular/sdk'

interface UIMessage {
  role: 'user' | 'assistant' | 'error'
  text: string
  node?: string
  tokens?: { input: number, output: number }
  timestamp: Date
}

// ─── Module-level persistent state ───────────────────────────────────────────
// Survives route changes (custom-element disconnect/reconnect). The actual
// messages are persisted server-side in ScyllaDB; this just keeps the UI's
// current selection and draft text across navigation so the user doesn't
// lose context when switching admin pages.
const consoleState = {
  conversationId: '',
  targetNode: '__leader__',
  draft: '',
}

class PageAdminAiConsole extends HTMLElement {
  private _nodes: ClusterNode[] = []
  private _targetNode = ''
  private _conversationId = ''
  private _conversations: ConversationSummary[] = []
  private _messages: UIMessage[] = []
  private _sending = false
  private _streamingText = ''
  private _user: string = ''

  connectedCallback() {
    this.style.display = 'block'
    this._user = getUsername() ?? ''
    // Restore persisted state so switching routes doesn't wipe the session.
    this._conversationId = consoleState.conversationId
    this._targetNode     = consoleState.targetNode
    this.innerHTML = `
      <style>
        .aic-wrap { display: flex; height: calc(100vh - 120px); gap: 12px; padding: 12px; }
        .aic-sidebar {
          width: 260px; min-width: 220px; flex-shrink: 0;
          border-right: 1px solid var(--divider-color); padding-right: 12px;
          display: flex; flex-direction: column; gap: 8px;
        }
        .aic-sidebar-header { display: flex; align-items: center; justify-content: space-between; margin: 0 0 4px; }
        .aic-sidebar-header h3 { margin: 0; font: var(--md-typescale-title-small); }
        .aic-new-btn { padding: 6px 10px; font: var(--md-typescale-label-small); }
        .aic-conv-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
        .aic-conv-item {
          padding: 8px 10px; border-radius: 6px; cursor: pointer;
          display: flex; align-items: flex-start; gap: 6px;
          border: 1px solid transparent;
        }
        .aic-conv-item:hover { background: color-mix(in srgb, var(--primary-text-color) 4%, transparent); }
        .aic-conv-item.active { background: color-mix(in srgb, var(--primary-color) 12%, transparent); border-color: color-mix(in srgb, var(--primary-color) 30%, transparent); }
        .aic-conv-body { flex: 1; min-width: 0; }
        .aic-conv-title { font: var(--md-typescale-body-small); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .aic-conv-preview { font: var(--md-typescale-label-small); color: var(--secondary-text-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; }
        .aic-conv-meta { font: var(--md-typescale-label-small); color: var(--secondary-text-color); display: flex; justify-content: space-between; margin-top: 2px; }
        .aic-conv-del {
          background: none; border: none; color: var(--secondary-text-color); cursor: pointer;
          padding: 2px 4px; border-radius: 3px; font-size: 14px; line-height: 1; opacity: 0;
        }
        .aic-conv-item:hover .aic-conv-del { opacity: 1; }
        .aic-conv-del:hover { background: var(--error-color); color: #fff; }
        .aic-empty-list { padding: 20px 10px; text-align: center; color: var(--secondary-text-color); font: var(--md-typescale-label-small); font-style: italic; }

        .aic-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
        .aic-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; flex-wrap: wrap; }
        .aic-header h2 { margin: 0; }
        .aic-header .spacer { flex: 1; }
        .aic-node-select { padding: 6px 10px; border-radius: 6px; border: 1px solid var(--divider-color); background: var(--surface-color); color: var(--primary-text-color); font: var(--md-typescale-body-small); }
        .aic-subtitle { font: var(--md-typescale-label-small); color: var(--secondary-text-color); margin: 0 0 8px; }
        .aic-conv-id { font: var(--md-typescale-label-small); color: var(--secondary-text-color); font-family: monospace; }

        .aic-messages {
          flex: 1; overflow-y: auto; padding: 8px 4px;
          border-top: 1px solid var(--divider-color); border-bottom: 1px solid var(--divider-color);
          display: flex; flex-direction: column; gap: 12px;
        }
        .aic-msg { padding: 10px 14px; border-radius: 12px; max-width: 85%; word-wrap: break-word; font-size: 13px; line-height: 1.5; }
        .aic-msg-user { background: var(--primary-color); color: var(--on-primary-color); align-self: flex-end; font-size: 13.5px; }
        .aic-msg-assistant {
          background: color-mix(in srgb, var(--on-surface-color, #333) 6%, var(--surface-color, #fff));
          color: var(--primary-text-color, var(--on-surface-color));
          align-self: flex-start;
          border: 1px solid color-mix(in srgb, var(--on-surface-color, #333) 12%, transparent);
        }
        .aic-msg-assistant globular-markdown {
          --md-font-size: 13px;
          --on-surface-color: var(--primary-text-color, var(--on-surface-color));
          --surface-color: transparent;
          --divider-color: transparent;
        }
        .aic-msg-error { background: var(--error-color); color: #fff; align-self: flex-start; }
        .aic-msg-meta { font-size: 11px; color: var(--secondary-text-color); margin-top: 4px; display: flex; gap: 10px; align-items: center; }
        .aic-msg-meta .pill { padding: 1px 6px; border-radius: 3px; background: rgba(255,255,255,0.08); }

        /* Thinking indicator */
        .aic-thinking { align-self: flex-start; padding: 10px 14px; display: flex; align-items: center; gap: 8px; color: var(--secondary-text-color); font: var(--md-typescale-body-small); font-style: italic; }
        .aic-dots { display: inline-flex; gap: 3px; }
        .aic-dots span { width: 6px; height: 6px; border-radius: 50%; background: var(--secondary-text-color); animation: aic-bounce 1.2s infinite ease-in-out; }
        .aic-dots span:nth-child(2) { animation-delay: 0.15s; }
        .aic-dots span:nth-child(3) { animation-delay: 0.3s; }
        @keyframes aic-bounce { 0%,80%,100% { transform: translateY(0); opacity: 0.4; } 40% { transform: translateY(-4px); opacity: 1; } }

        /* Composer with embedded send button */
        .aic-composer {
          position: relative; margin-top: 10px;
          display: flex; align-items: flex-end;
          border: 1px solid var(--divider-color); border-radius: 14px;
          background: var(--surface-color);
          padding: 6px 6px 6px 14px;
        }
        .aic-composer:focus-within { border-color: var(--primary-color); }
        .aic-input {
          flex: 1; min-height: 28px; max-height: 180px;
          padding: 10px 0; border: none; background: transparent;
          color: var(--primary-text-color); font: var(--md-typescale-body-medium);
          resize: none; outline: none;
        }
        .aic-send-btn {
          background: var(--primary-color); color: var(--on-primary-color);
          border: none; border-radius: 50%;
          width: 36px; height: 36px; flex-shrink: 0;
          cursor: pointer; display: flex; align-items: center; justify-content: center;
          transition: background 0.15s;
        }
        .aic-send-btn:hover:not(:disabled) { background: color-mix(in srgb, var(--primary-color) 85%, #000); }
        .aic-send-btn:disabled { background: var(--divider-color); cursor: not-allowed; }
        .aic-send-btn svg { width: 18px; height: 18px; }

        .aic-empty { text-align: center; padding: 40px 20px; color: var(--secondary-text-color); font-style: italic; }
      </style>
      <div class="aic-wrap">
        <aside class="aic-sidebar">
          <div class="aic-sidebar-header">
            <h3>Conversations</h3>
            <button class="md-btn md-btn-filled aic-new-btn" id="newConvBtn">+ New</button>
          </div>
          <div id="convList" class="aic-conv-list">
            <div class="aic-empty-list">Loading…</div>
          </div>
        </aside>

        <main class="aic-main">
          <div class="aic-header">
            <h2>AI Console</h2>
            <div class="spacer"></div>
            <label style="font:var(--md-typescale-label-small);color:var(--secondary-text-color);">Target:</label>
            <select id="nodeSelect" class="aic-node-select"></select>
            <span id="convId" class="aic-conv-id"></span>
          </div>
          <p class="aic-subtitle">
            Chat with the cluster AI. Conversations persist across sessions. The leader node (\u2605) is selected by default.
          </p>
          <div id="messages" class="aic-messages">
            <div class="aic-empty">Start a new conversation or pick one on the left.</div>
          </div>
          <div class="aic-composer">
            <textarea id="input" class="aic-input" placeholder="Ask the cluster AI…  (Ctrl+Enter to send)" rows="1"></textarea>
            <button id="sendBtn" class="aic-send-btn" title="Send (Ctrl+Enter)">
              ${this.sendIconSvg()}
            </button>
          </div>
        </main>
      </div>
    `

    this.querySelector<HTMLButtonElement>('#sendBtn')?.addEventListener('click', () => this.send())
    this.querySelector<HTMLButtonElement>('#newConvBtn')?.addEventListener('click', () => this.newConversation())
    this.querySelector<HTMLSelectElement>('#nodeSelect')?.addEventListener('change', (e) => {
      this._targetNode = (e.target as HTMLSelectElement).value
      consoleState.targetNode = this._targetNode
    })
    const input = this.querySelector<HTMLTextAreaElement>('#input')
    input?.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        this.send()
      }
    })
    input?.addEventListener('input', () => {
      this.autoResizeInput()
      consoleState.draft = input.value
    })
    // Restore draft text.
    if (input && consoleState.draft) {
      input.value = consoleState.draft
      this.autoResizeInput()
    }

    this.loadNodes()
    this.refreshConversations()
    // If we had a conversation selected, reload its messages.
    if (this._conversationId) {
      this.loadConversation(this._conversationId)
    } else {
      this.renderConvId()
    }
  }

  disconnectedCallback() {
    // Persist current state so the next mount restores it.
    consoleState.conversationId = this._conversationId
    consoleState.targetNode     = this._targetNode
    const input = this.querySelector<HTMLTextAreaElement>('#input')
    if (input) consoleState.draft = input.value
  }

  // ─── Data loads ────────────────────────────────────────────────────────────

  private async loadNodes() {
    try {
      this._nodes = await listClusterNodes()
    } catch {
      return
    }
    const sel = this.querySelector<HTMLSelectElement>('#nodeSelect')
    if (!sel) return

    // Sort: control-plane nodes first (leader candidates), then the rest.
    const sorted = [...this._nodes].filter(n => n.hostname)
    sorted.sort((a, b) => {
      const aCP = a.profiles?.includes('control-plane') ? 0 : 1
      const bCP = b.profiles?.includes('control-plane') ? 0 : 1
      return aCP - bCP || a.hostname.localeCompare(b.hostname)
    })

    let leaderSet = false
    for (const n of sorted) {
      const isCP = n.profiles?.includes('control-plane')
      const opt = document.createElement('option')
      // Only the first control-plane node gets the __leader__ value;
      // additional control-plane nodes use their hostname directly.
      if (isCP && !leaderSet) {
        opt.value = '__leader__'
        opt.textContent = `${n.hostname} \u2605`
        leaderSet = true
      } else {
        opt.value = n.hostname
        opt.textContent = n.hostname
      }
      sel.appendChild(opt)
    }

    // Restore persisted target-node selection if it still exists.
    if (this._targetNode) sel.value = this._targetNode
  }

  private async refreshConversations() {
    try {
      this._conversations = await listConversations(this._user, 100)
      this._conversations.sort((a, b) => b.updatedAtMs - a.updatedAtMs)
    } catch (e) {
      this._conversations = []
      console.warn('listConversations failed', e)
    }
    this.renderConversationList()
  }

  private async loadConversation(conversationId: string) {
    try {
      const msgs: SdkConversationMessage[] = await getConversation(conversationId, 0)
      this._conversationId = conversationId
      consoleState.conversationId = conversationId
      this._messages = msgs.map((m) => ({
        role: (m.role === 'user' || m.role === 'assistant') ? m.role : 'assistant',
        text: m.content,
        node: m.nodeHostname || undefined,
        tokens: (m.inputTokens || m.outputTokens) ? { input: m.inputTokens, output: m.outputTokens } : undefined,
        timestamp: new Date(m.createdAtMs),
      }))
      this.renderMessages()
      this.renderConvId()
      this.renderConversationList()
    } catch (e: any) {
      console.warn('getConversation failed', e)
    }
  }

  private async deleteConv(conversationId: string) {
    if (!confirm('Delete this conversation?')) return
    try {
      await sdkDeleteConversation(conversationId)
    } catch (e: any) {
      alert(`Delete failed: ${e?.message ?? e}`)
      return
    }
    if (this._conversationId === conversationId) {
      this.newConversation()
    }
    this.refreshConversations()
  }

  private newConversation() {
    this._conversationId = ''
    consoleState.conversationId = ''
    this._messages = []
    this._streamingText = ''
    this.renderMessages()
    this.renderConvId()
    this.renderConversationList()
    this.querySelector<HTMLTextAreaElement>('#input')?.focus()
  }

  // ─── Sending ───────────────────────────────────────────────────────────────

  private async send() {
    if (this._sending) return
    const input = this.querySelector<HTMLTextAreaElement>('#input')
    const text = input?.value.trim() ?? ''
    if (!text) return

    this._messages.push({ role: 'user', text, timestamp: new Date() })
    if (input) { input.value = ''; this.autoResizeInput() }
    consoleState.draft = ''
    this._sending = true
    this._streamingText = ''
    this.renderMessages()
    this.setSendEnabled(false)

    try {
      const result: PromptResult = await sendPrompt(
        text,
        this._conversationId || undefined,
        this._targetNode || undefined,
        (chunk) => {
          this._streamingText += chunk
          this.renderMessages()
        },
        this._user || undefined,
      )
      if (result.conversationId) {
        this._conversationId = result.conversationId
        consoleState.conversationId = result.conversationId
      }
      this._streamingText = ''
      this._messages.push({
        role: 'assistant',
        text: result.response || '(empty response)',
        node: result.respondingNode,
        tokens: { input: result.inputTokens, output: result.outputTokens },
        timestamp: new Date(),
      })
    } catch (e: any) {
      this._streamingText = ''
      this._messages.push({
        role: 'error',
        text: `Request failed: ${e?.message ?? String(e)}`,
        timestamp: new Date(),
      })
    } finally {
      this._sending = false
      this.setSendEnabled(true)
      this.renderMessages()
      this.renderConvId()
      this.refreshConversations()  // sidebar shows new convs / updated previews
    }
  }

  private setSendEnabled(enabled: boolean) {
    const btn = this.querySelector<HTMLButtonElement>('#sendBtn')
    if (btn) btn.disabled = !enabled
    const input = this.querySelector<HTMLTextAreaElement>('#input')
    if (input) input.disabled = !enabled
  }

  private autoResizeInput() {
    const input = this.querySelector<HTMLTextAreaElement>('#input')
    if (!input) return
    input.style.height = 'auto'
    input.style.height = Math.min(input.scrollHeight, 180) + 'px'
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  private renderConvId() {
    const el = this.querySelector<HTMLSpanElement>('#convId')
    if (!el) return
    el.textContent = this._conversationId ? `conv: ${this._conversationId.slice(0, 8)}…` : ''
  }

  private renderConversationList() {
    const container = this.querySelector<HTMLDivElement>('#convList')
    if (!container) return
    if (this._conversations.length === 0) {
      container.innerHTML = `<div class="aic-empty-list">No conversations yet.</div>`
      return
    }
    container.innerHTML = this._conversations.map((c) => {
      const active = c.id === this._conversationId ? ' active' : ''
      const title = c.title || '(untitled)'
      const preview = c.lastMessagePreview || ''
      const when = formatRelative(c.updatedAtMs)
      return `
        <div class="aic-conv-item${active}" data-id="${escapeAttr(c.id)}">
          <div class="aic-conv-body">
            <div class="aic-conv-title">${escapeHtml(title)}</div>
            <div class="aic-conv-preview">${escapeHtml(preview)}</div>
            <div class="aic-conv-meta">
              <span>${c.messageCount} msg</span>
              <span>${when}</span>
            </div>
          </div>
          <button class="aic-conv-del" data-del="${escapeAttr(c.id)}" title="Delete conversation">✕</button>
        </div>
      `
    }).join('')
    // Wire up click handlers.
    container.querySelectorAll<HTMLDivElement>('.aic-conv-item').forEach((el) => {
      el.addEventListener('click', (e) => {
        const t = e.target as HTMLElement
        const delId = t.getAttribute('data-del')
        if (delId) { e.stopPropagation(); this.deleteConv(delId); return }
        const id = el.getAttribute('data-id') ?? ''
        if (id) this.loadConversation(id)
      })
    })
  }

  private renderMessages() {
    const container = this.querySelector<HTMLDivElement>('#messages')
    if (!container) return

    if (this._messages.length === 0 && !this._streamingText && !this._sending) {
      container.innerHTML = `<div class="aic-empty">Start a new conversation or pick one on the left.</div>`
      return
    }

    const parts: string[] = []
    for (const m of this._messages) {
      parts.push(this.renderMessage(m))
    }
    if (this._streamingText) {
      parts.push(`
        <div class="aic-msg aic-msg-assistant">
          <globular-markdown embedded>${escapeHtml(this._streamingText)}</globular-markdown>
          <div class="aic-msg-meta"><span class="pill">streaming…</span></div>
        </div>
      `)
    } else if (this._sending) {
      parts.push(`
        <div class="aic-thinking">
          thinking
          <span class="aic-dots"><span></span><span></span><span></span></span>
        </div>
      `)
    }
    container.innerHTML = parts.join('')
    container.scrollTop = container.scrollHeight
  }

  private renderMessage(m: UIMessage): string {
    const cls = m.role === 'user' ? 'aic-msg-user'
              : m.role === 'error' ? 'aic-msg-error'
              : 'aic-msg-assistant'
    const meta: string[] = []
    if (m.node) meta.push(`<span class="pill">${escapeHtml(m.node)}</span>`)
    if (m.tokens && (m.tokens.input || m.tokens.output)) {
      meta.push(`<span>in:${m.tokens.input} out:${m.tokens.output}</span>`)
    }
    meta.push(`<span>${m.timestamp.toLocaleTimeString()}</span>`)
    // Use markdown renderer for assistant messages, plain text for user/error.
    const body = m.role === 'assistant'
      ? `<globular-markdown embedded>${escapeHtml(m.text)}</globular-markdown>`
      : `<div style="white-space:pre-wrap;">${escapeHtml(m.text)}</div>`
    return `
      <div class="aic-msg ${cls}">
        ${body}
        <div class="aic-msg-meta">${meta.join(' ')}</div>
      </div>
    `
  }

  // ─── Icons ─────────────────────────────────────────────────────────────────

  private sendIconSvg(): string {
    return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/></svg>`
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c
  ))
}

function escapeAttr(s: string): string {
  return escapeHtml(s)
}

function formatRelative(ms: number): string {
  if (!ms) return ''
  const diff = Date.now() - ms
  const s = Math.floor(diff / 1000)
  if (s < 60) return 'now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  return `${d}d`
}

customElements.define('page-admin-ai-console', PageAdminAiConsole)
