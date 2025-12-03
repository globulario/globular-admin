import "@polymer/paper-card/paper-card.js";
import "@polymer/paper-button/paper-button.js";
import "@polymer/paper-icon-button/paper-icon-button.js";
import "@polymer/iron-icons/iron-icons.js";
import "@polymer/iron-image/iron-image.js";

const ROLE_LABELS = {
  actors: "Actor",
  writers: "Writer",
  directors: "Director",
  casting: "Cast",
};

const FALLBACK_PROFILE_IMAGE =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(`
    <svg width="160" height="160" viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg">
      <rect width="160" height="160" rx="20" ry="20" fill="#1f2933"/>
      <circle cx="80" cy="60" r="36" fill="#111827"/>
      <circle cx="80" cy="60" r="32" fill="#374151"/>
      <path d="M40 140c0-30 20-55 40-55s40 25 40 55" fill="#111827"/>
    </svg>
  `);

export class CastPersonPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._person = null;
    this._roleLabel = "Cast";
    this._onEdit = null;
    this._onClose = null;
    this._render();
  }

  static get observedAttributes() {
    return ["hidden"];
  }

  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.45);
          display: none;
          align-items: flex-start;
          justify-content: center;
          padding: 32px 16px;
          box-sizing: border-box;
          z-index: 1200;
          overflow-y: auto;
        }
        :host([hidden]) {
          display: none;
        }
        :host(:not([hidden])) {
          display: flex;
        }
        #backdrop {
          position: relative;
          width: 100%;
          max-width: 740px;
          box-sizing: border-box;
        }
        paper-card {
          width: 100%;
          background: var(--surface-color);
          color: var(--primary-text-color);
          box-sizing: border-box;
          border-radius: 12px;
          padding: 0;
          overflow: hidden;
        }
        .panel-header {
          display: flex;
          padding: 16px;
          gap: 16px;
          align-items: center;
          border-bottom: 1px solid var(--palette-divider);
        }
        iron-image {
          width: 88px;
          height: 88px;
          border-radius: 12px;
          background: var(--surface-color);
          object-fit: cover;
        }
        .header-text {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .name {
          font-size: 1.4rem;
          font-weight: 600;
        }
        .role {
          font-size: 0.85rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--secondary-text-color);
        }
        .panel-body {
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .section {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .section-title {
          font-size: 0.85rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--secondary-text-color);
        }
        .section-value {
          font-size: 0.95rem;
          line-height: 1.5;
        }
        .tags {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .tag {
          background: var(--surface-color-dark, var(--palette-divider));
          color: var(--on-surface-color);
          border-radius: 999px;
          padding: 3px 10px;
          font-size: 0.75rem;
        }
        .panel-actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          padding: 12px 16px 16px;
          border-top: 1px solid var(--palette-divider);
        }
        paper-button[disabled] {
          opacity: 0.6;
        }
        #close-btn {
          --paper-icon-button-ink-color: var(--secondary-text-color);
        }
      </style>
      <div id="backdrop">
        <paper-card elevation="1">
          <div class="panel-header">
            <iron-image id="person-picture" sizing="cover" preload fade></iron-image>
            <div class="header-text">
              <div class="name" id="person-name"></div>
              <div class="role" id="person-role"></div>
              <div class="aliases" id="person-aliases"></div>
            </div>
            <paper-icon-button icon="icons:close" id="close-btn" title="Close"></paper-icon-button>
          </div>
          <div class="panel-body">
            <div class="section">
              <div class="section-title">Biography</div>
              <div class="section-value" id="person-bio"></div>
            </div>
            <div class="section">
              <div class="section-title">Details</div>
              <div class="section-value" id="person-details"></div>
            </div>
            <div class="section">
              <div class="section-title">Credits</div>
              <div class="tags" id="person-credits"></div>
            </div>
          </div>
          <div class="panel-actions">
            <paper-button id="profile-btn" disabled>Open profile</paper-button>
            <paper-button id="edit-btn" raised>Edit</paper-button>
          </div>
        </paper-card>
      </div>
    `;

    this._picture = this.shadowRoot.querySelector("#person-picture");
    this._nameEl = this.shadowRoot.querySelector("#person-name");
    this._roleEl = this.shadowRoot.querySelector("#person-role");
    this._aliasesEl = this.shadowRoot.querySelector("#person-aliases");
    this._bioEl = this.shadowRoot.querySelector("#person-bio");
    this._detailsEl = this.shadowRoot.querySelector("#person-details");
    this._creditsEl = this.shadowRoot.querySelector("#person-credits");
    this._closeBtn = this.shadowRoot.querySelector("#close-btn");
    this._editBtn = this.shadowRoot.querySelector("#edit-btn");
    this._profileBtn = this.shadowRoot.querySelector("#profile-btn");
    this._backdrop = this.shadowRoot.querySelector("#backdrop");

    this._closeBtn?.addEventListener("click", () => this.close());
    this._editBtn?.addEventListener("click", () => {
      if (typeof this._onEdit === "function") {
        this._onEdit(this._person);
      }
      this.close();
    });
    this._profileBtn?.addEventListener("click", () => {
      const url = this._person?.getUrl?.();
      if (url) window.open(url, "_blank");
    });
    this._backdrop?.addEventListener("click", (evt) => {
      if (evt.target === this._backdrop) this.close();
    });
    this.addEventListener("keydown", (evt) => {
      if (evt.key === "Escape") this.close();
    });
  }

  setPerson(person, role = "cast", callbacks = {}) {
    this._person = person;
    this._roleLabel = ROLE_LABELS[role] || role || "Cast";
    this._onEdit = callbacks.onEdit;
    this._onClose = callbacks.onClose;
    this._update();
  }

  open() {
    this.removeAttribute("hidden");
    this.focus({ preventScroll: true });
  }

  close() {
    this.setAttribute("hidden", "true");
    if (typeof this._onClose === "function") {
      this._onClose(this._person);
    }
  }

  _update() {
    if (!this._person) return;
    const fullName = this._person.getFullname?.() || this._person.getName?.() || "Unknown";
    const aliases = (this._person.getAliasesList?.() || []).filter(Boolean);
    const career = this._person.getCareerstatus?.() || "";
    const gender = this._person.getGender?.() || "";
    const birthPlace = this._person.getBirthplace?.() || "";
    const birthDate = this._person.getBirthdate?.() || "";
    const biography = this._decodeBio(this._person.getBiography?.());

    this._nameEl.textContent = fullName;
    this._roleEl.textContent = this._roleLabel;
    this._aliasesEl.textContent = aliases.length ? `Also known as ${aliases.join(", ")}` : "";
    this._aliasesEl.style.display = aliases.length ? "block" : "none";
    this._bioEl.textContent = biography || "No biography available.";

    const detailPieces = [];
    if (career) detailPieces.push(`Career: ${career}`);
    if (gender) detailPieces.push(`Gender: ${gender}`);
    if (birthPlace) detailPieces.push(`Birth place: ${birthPlace}`);
    if (birthDate) detailPieces.push(`Born: ${birthDate}`);
    this._detailsEl.textContent = detailPieces.join(" · ") || "No detailed information yet.";

    const credits = [
      { label: "Directing", items: this._person.getDirectingList?.() },
      { label: "Writing", items: this._person.getWritingList?.() },
      { label: "Acting", items: this._person.getActingList?.() },
      { label: "Casting", items: this._person.getCastingList?.() },
    ];
    this._creditsEl.innerHTML = "";
    credits.forEach((credit) => {
      if (!credit.items || !credit.items.length) return;
      const chip = document.createElement("span");
      chip.classList.add("tag");
      chip.textContent = `${credit.label}: ${credit.items.length}`;
      this._creditsEl.appendChild(chip);
    });
    if (!this._creditsEl.children.length) {
      const noneTag = document.createElement("span");
      noneTag.classList.add("tag");
      noneTag.textContent = "No credits recorded";
      this._creditsEl.appendChild(noneTag);
    }

    const pictureUrl = this._person.getPicture?.();
    this._picture.src = pictureUrl && typeof pictureUrl === "string" ? pictureUrl : FALLBACK_PROFILE_IMAGE;
    this._picture.hidden = false;
    this._picture.alt = `${fullName} profile picture`;

    const url = this._person.getUrl?.();
    this._profileBtn.disabled = !url;
  }

  _decodeBio(bio) {
    if (!bio) return "";
    try {
      return atob(bio);
    } catch (err) {
      return bio;
    }
  }
}

customElements.define("globular-cast-person-panel", CastPersonPanel);