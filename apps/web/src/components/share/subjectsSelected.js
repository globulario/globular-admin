// src/widgets/subjectsSelected.js

// Polymer / Custom Element deps
import "@polymer/iron-icon/iron-icon.js";       // account-circle, social:people
import "@polymer/paper-icon-button/paper-icon-button.js";

/**
 * Selected subjects panel (accounts & groups).
 * Works with new backend VMs or legacy proto-like objects.
 */
export class GlobularSubjectsSelected extends HTMLElement {
  // Internal state
  _accounts = [];
  _groups = [];

  // DOM refs
  _accountsDiv = null;
  _groupsDiv = null;

  // Callbacks (two naming styles for compatibility)
  onAccountRemoved = null;
  onGroupRemoved = null;
  on_account_removed = null; // alias
  on_group_removed = null;   // alias

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this._render();
    this._refs();
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        #container {
          display:flex; flex-direction:column; width:100%;
          box-sizing:border-box; color: var(--primary-text-color);
        }
        .title {
          font-size:1.1rem; font-weight:500;
        }
        .subject-list-section {
          display:flex; flex-wrap:wrap; gap:10px; margin-top:15px;
        }
        .subject-list-section:first-of-type { margin-top:5px; }

        .infos {
          position:relative; display:flex; flex-direction:column; align-items:center;
          gap:6px; margin:2px; padding:8px; border-radius:8px;
          background: var(--surface-color); color: var(--primary-text-color);
          box-shadow: var(--shadow-elevation-2dp); transition: box-shadow .2s ease;
        }
        .infos:hover { box-shadow: var(--shadow-elevation-4dp); }

        .infos img {
          width:64px; height:64px; border-radius:50%; object-fit:cover;
        }
        .infos iron-icon.subject-icon {
          width:64px; height:64px; --iron-icon-fill-color: var(--palette-action-disabled);
        }
        .infos span.name {
          font-size:.9rem; text-align:center; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
          max-width:120px;
        }

        .remove-btn {
          position:absolute; top:0; right:0;
          color: var(--palette-error-main); background: rgba(0,0,0,.4);
          border-radius:50%; padding:4px; display:none;
        }
        .infos:hover .remove-btn { display:block; }
      </style>

      <div id="container">
        <span class="title">Choose who to share with...</span>
        <div id="accounts-list" class="subject-list-section"></div>
        <div id="groups-list" class="subject-list-section"></div>
      </div>
    `;
  }

  _refs() {
    this._accountsDiv = this.shadowRoot.querySelector("#accounts-list");
    this._groupsDiv = this.shadowRoot.querySelector("#groups-list");
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  /**
   * Append an account (VM or proto).
   * @param {HTMLElement} _accountDivTemplate (unused, kept for signature compatibility)
   * @param {object} account
   */
  appendAccount(_accountDivTemplate, account) {
    const id = subjId(account);
    if (!id) return;
    if (this._accounts.some(a => subjId(a) === id)) return;

    const card = this._createSubjectCard(account, "account");
    this._accountsDiv.appendChild(card);
    this._accounts.push(account);
  }

  /**
   * Append a group (VM or proto).
   * @param {HTMLElement} _groupDivTemplate (unused)
   * @param {object} group
   */
  appendGroup(_groupDivTemplate, group) {
    const id = subjId(group);
    if (!id) return;
    if (this._groups.some(g => subjId(g) === id)) return;

    const card = this._createSubjectCard(group, "group");
    this._groupsDiv.appendChild(card);
    this._groups.push(group);
  }

  /** @returns {object[]} current accounts */
  getAccounts() { return this._accounts; }

  /** @returns {object[]} current groups */
  getGroups() { return this._groups; }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  _createSubjectCard(subject, type) {
    const card = document.createElement("div");
    card.classList.add("infos");
    card.subject = subject;

    const pic = profilePicture(subject);
    const nm = displayName(subject);
    const iconHtml =
      type === "account"
        ? (pic ? `<img src="${pic}" alt="Profile Picture">` : `<iron-icon class="subject-icon" icon="account-circle"></iron-icon>`)
        : `<iron-icon class="subject-icon" icon="social:people"></iron-icon>`;

    card.innerHTML = `
      ${iconHtml}
      <span class="name" title="${nm}">${nm}</span>
      <paper-icon-button class="remove-btn" icon="icons:close" title="Remove"></paper-icon-button>
    `;

    const removeBtn = card.querySelector(".remove-btn");
    removeBtn?.addEventListener("click", () => {
      this._removeSubject(subject, type);
      card.remove();
    });

    return card;
  }

  _removeSubject(subject, type) {
    const id = subjId(subject);
    if (!id) return;

    if (type === "account") {
      this._accounts = this._accounts.filter(a => subjId(a) !== id);
      // Call both styles if provided
      if (typeof this.onAccountRemoved === "function") this.onAccountRemoved(subject);
      if (typeof this.on_account_removed === "function") this.on_account_removed(subject);
    } else if (type === "group") {
      this._groups = this._groups.filter(g => subjId(g) !== id);
      if (typeof this.onGroupRemoved === "function") this.onGroupRemoved(subject);
      if (typeof this.on_group_removed === "function") this.on_group_removed(subject);
    }

    // Generic DOM event (useful for external listeners)
    this.dispatchEvent(new CustomEvent(`${type}-removed`, { detail: subject }));
  }
}

customElements.define("globular-subjects-selected", GlobularSubjectsSelected);

// =====================================================================
// Subject helpers — tolerate VM or proto-like objects
// =====================================================================

function subjId(x) {
  return x?.id ?? x?.getId?.();
}
function subjDomain(x) {
  return x?.domain ?? x?.getDomain?.();
}
function subjName(x) {
  return x?.name ?? x?.getName?.();
}
function firstName(x) {
  return x?.firstName ?? x?.firstname ?? x?.getFirstName?.() ?? x?.getFirstname?.();
}
function lastName(x) {
  return x?.lastName ?? x?.lastname ?? x?.getLastName?.() ?? x?.getLastname?.();
}
function profilePicture(x) {
  return x?.profilePicture ?? x?.profilepicture ?? x?.getProfilePicture?.() ?? x?.getProfilepicture?.();
}

/** Prefer "First Last" for accounts; else fallback to name or id. */
function displayName(x) {
  const fn = firstName(x);
  const ln = lastName(x);
  if (fn && ln) return `${fn} ${ln}`;
  return subjName(x) || subjId(x) || "(unknown)";
}
