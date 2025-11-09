import '@polymer/iron-icon/iron-icon.js';
import { listToString } from '../utility';

/**
 * <globular-conversation-info>
 * Displays basic conversation information (works with proto instance or VM object).
 */
export class ConversationInfo extends HTMLElement {
  /** @type {any|null} */
  _conversation = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this._render();
  }

  /** @param {any} conversation */
  set conversation(conversation) {
    if (this._conversation !== conversation) {
      this._conversation = conversation;
      this._render();
    }
  }
  get conversation() {
    return this._conversation;
  }

  /** Safe getter: tries methods (getX) and then plain props (x / camelCase) */
  _v(obj, names, fallback = undefined) {
    if (!obj) return fallback;
    for (const n of names) {
      const fn = obj[n];
      if (typeof fn === 'function') {
        try { return fn.call(obj); } catch {}
      }
      if (n in obj) return obj[n];
    }
    return fallback;
  }

  /** Convert seconds→ms if needed and return Date */
  _tsToDate(t) {
    if (!t && t !== 0) return null;
    const num = Number(t);
    if (!Number.isFinite(num)) return null;
    const ms = num > 1e12 ? num : num * 1000;
    return new Date(ms);
  }

  _render() {
    if (!this._conversation) {
      this.shadowRoot.innerHTML = `
        <style>
          #container { display:flex; color: var(--primary-text-color); padding:10px; }
        </style>
        <div id="container"><p>No conversation data available.</p></div>
      `;
      return;
    }

    // Pull values (supports proto or VM)
    const uuid = this._v(this._conversation, ['getUuid', 'uuid'], '');
    const name = this._v(this._conversation, ['getName', 'name'], '');
    const creationTimeRaw = this._v(this._conversation, ['getCreationtime', 'getCreationTime', 'creationTime', 'creation_time'], 0);
    const lastMsgTimeRaw = this._v(this._conversation, ['getLastMessageTime', 'getLastmessagetime', 'lastMessageTime', 'last_message_time'], 0);
    const keywords = this._v(this._conversation, ['getKeywordsList', 'keywords', 'keywordsList'], []) || [];
    const participants = this._v(this._conversation, ['getParticipantsList', 'participants', 'participantsList'], []) || [];

    const creationDate = this._tsToDate(creationTimeRaw);
    const lastMsgDate = this._tsToDate(lastMsgTimeRaw);

    this.shadowRoot.innerHTML = `
      <style>
        #container {
          display: flex;
          color: var(--primary-text-color);
          padding: 15px;
          gap: 20px;
          align-items: flex-start;
        }
        .icon-container iron-icon {
          height: 40px;
          width: 40px;
          padding-left: 15px;
          flex-shrink: 0;
          color: var(--primary-color);
        }
        .info-table {
          display: table;
          flex-grow: 1;
          border-collapse: separate;
          border-spacing: 0 5px;
          width: 100%;
        }
        .info-row { display: table-row; }
        .info-label {
          display: table-cell;
          font-weight: 500;
          padding-right: 15px;
          vertical-align: top;
          white-space: nowrap;
        }
        .info-value {
          display: table-cell;
          word-break: break-word;
        }
      </style>
      <div id="container">
        <div class="icon-container">
          <iron-icon id="icon" icon="communication:forum"></iron-icon>
        </div>
        <div class="info-table">
          <div class="info-row">
            <div class="info-label">Id:</div>
            <div class="info-value">${uuid}</div>
          </div>
          <div class="info-row">
            <div class="info-label">Name:</div>
            <div class="info-value">${name || '—'}</div>
          </div>
          <div class="info-row">
            <div class="info-label">Creation time:</div>
            <div class="info-value">${creationDate ? creationDate.toLocaleString() : '—'}</div>
          </div>
          <div class="info-row">
            <div class="info-label">Last message time:</div>
            <div class="info-value">${lastMsgDate ? lastMsgDate.toLocaleString() : '—'}</div>
          </div>
          <div class="info-row">
            <div class="info-label">Keywords:</div>
            <div class="info-value">${keywords.length ? listToString(keywords) : '—'}</div>
          </div>
          <div class="info-row">
            <div class="info-label">Participants:</div>
            <div class="info-value">${participants.length ? listToString(participants) : '—'}</div>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define('globular-conversation-info', ConversationInfo);
