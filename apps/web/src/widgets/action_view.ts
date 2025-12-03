// action_view.ts
// Minimal, dependency-free ActionView with native buttons and clean attrs handling.

export class ActionView extends HTMLElement {
  static get observedAttributes() {
    return ["closeable", "addable"];
  }

  // Optional hooks (set from parent)
  onClose?: () => void;
  onAdd?: () => void;

  private shadow!: ShadowRoot;
  private action = "";

  // Refs
  private btnClose!: HTMLButtonElement;
  private btnAdd!: HTMLButtonElement;
  private spanText!: HTMLSpanElement;

  // Inline icons to keep bundle tiny
  private static XIcon = `
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path fill="currentColor" d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4Z"/>
    </svg>
  `;
  private static PlusIcon = `
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path fill="currentColor" d="M11 5a1 1 0 0 1 2 0v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 1 1 0-2h6V5Z"/>
    </svg>
  `;

  constructor(action?: string) {
    super();
    this.shadow = this.attachShadow({ mode: "open" });
    if (action) this.action = action;

    this.shadow.innerHTML = `
      <style>
        @import url('./styles.css');

        :host { display: inline-block; }

        #content {
          display: inline-flex;
          align-items: center;
          gap: .5rem;
          padding: .25rem .5rem;
          background: var(--surface-color);
          color: var(--on-surface-color);
          border-radius: .5rem;
          box-shadow: 0 0 0 1px var(--divider-color, color-mix(in oklab, currentColor 15%, transparent));
        }

        .icon-btn {
          appearance: none; border: 0; background: transparent;
          width: 30px; height: 30px; border-radius: .5rem;
          display:grid; place-items:center;
          color: var(--on-surface-variant-color, currentColor);
        }
        .icon-btn[hidden] { display: none; }
        .icon-btn:hover { background: color-mix(in oklab, var(--on-surface-color) 8%, transparent); }
        .icon-btn:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }

        #action-text {
          font-size: .95rem; line-height: 1.25rem;
          white-space: nowrap;
        }
      </style>

      <div id="content" part="chip">
        <button id="close-btn" class="icon-btn" title="Remove" aria-label="Remove" hidden>
          ${ActionView.XIcon}
        </button>
        <button id="add-btn" class="icon-btn" title="Add" aria-label="Add" hidden>
          ${ActionView.PlusIcon}
        </button>
        <span id="action-text"></span>
      </div>
    `;
  }

  connectedCallback() {
    this.btnClose = this.shadow.getElementById("close-btn") as HTMLButtonElement;
    this.btnAdd = this.shadow.getElementById("add-btn") as HTMLButtonElement;
    this.spanText = this.shadow.getElementById("action-text") as HTMLSpanElement;

    // Initial text
    this.spanText.textContent = this.action;

    // Initialize attributes → UI
    this.syncAttr("closeable", this.getAttribute("closeable"));
    this.syncAttr("addable", this.getAttribute("addable"));

    // Button handlers
    this.btnClose.onclick = (e) => {
      e.stopPropagation();
      this.onClose?.();
      // Also emit a semantic event
      this.dispatchEvent(new CustomEvent("action:close", { bubbles: true, composed: true, detail: { action: this.action } }));
    };

    this.btnAdd.onclick = (e) => {
      e.stopPropagation();
      this.onAdd?.();
      this.dispatchEvent(new CustomEvent("action:add", { bubbles: true, composed: true, detail: { action: this.action } }));
    };
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null) {
    this.syncAttr(name, value);
  }

  private syncAttr(name: string, value: string | null) {
    if (!this.shadowRoot) return;

    if (name === "closeable" && this.btnClose) {
      this.btnClose.hidden = value !== "true";
    }
    if (name === "addable" && this.btnAdd) {
      this.btnAdd.hidden = value !== "true";
    }
  }

  // Public API
  setAction(next: string) {
    this.action = next;
    if (this.spanText) this.spanText.textContent = next;
  }

  getAction() {
    return this.action;
  }
}

customElements.define("globular-action-view", ActionView);