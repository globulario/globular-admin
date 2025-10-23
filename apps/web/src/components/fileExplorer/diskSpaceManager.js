// components/disk-space-manager.js
import { displayError, displayMessage } from "../../backend/ui/notify";
import { getCoords, getFileSizeString } from "../utility";

import {
  getAllocatedSpace,
  getAvailableSpace,
  setAllocatedSpace,
  SubjectType,
} from "../../backend/diskSpace.js";

// Polymer imports
import "@polymer/paper-card/paper-card.js";
import "@polymer/paper-progress/paper-progress.js";
import "@polymer/paper-tooltip/paper-tooltip.js";
import "@polymer/paper-input/paper-input.js";
import "@polymer/paper-button/paper-button.js";
import "@polymer/paper-spinner/paper-spinner.js";

/**
 * Manages and displays disk space usage for an account or application.
 * @element globular-disk-space-manager
 * @attr {string} account
 * @attr {string} application
 * @attr {boolean} editable
 */
export class DiskSpaceManager extends HTMLElement {
  // Private fields (native JS)
  #allocatedSpace = 0;
  #availableSpace = 0;
  #account = null;

  #domRefs = {};
  #onEditClickBound = this.#displayAllocatedSpaceInputBox.bind(this);

  static get observedAttributes() {
    return ["account", "application", "editable"];
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.#renderInitialHTML();
    this.#cacheDomElements();
  }

  connectedCallback() {
    this.#refreshData();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return;

    switch (name) {
      case "account":
        this.#account = null;
        this.#refreshData();
        break;
      case "application":
        this.#refreshData();
        break;
      case "editable":
        this.#updateEditableState(newValue === "true");
        break;
    }
  }

  #renderInitialHTML() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display:flex; flex-direction:column; position:relative; font-size:1rem; width:100%; }
        #container { display:flex; flex-direction:column; position:relative; width:100%; }
        #error-message-div { display:none; text-decoration:underline; color: var(--palette-error-main); cursor:pointer; margin-top:5px; }
        #disk-space-usage-div { display:flex; font-size:.85rem; justify-content:space-between; margin-bottom:5px; }
        paper-progress { width:100%; --paper-progress-active-color: var(--primary-color); --paper-progress-secondary-color: var(--secondary-color); }
        paper-card { background-color: var(--surface-color); color: var(--primary-text-color); }
        .allocated-space-modal { position:absolute; z-index:1000; display:flex; flex-direction:column; padding:10px; background-color: var(--surface-color); color: var(--primary-text-color); box-shadow:0 4px 8px rgba(0,0,0,.2); border-radius:4px; min-width:250px; }
        .allocated-space-modal paper-input { margin-bottom:10px; }
        .allocated-space-modal .buttons { display:flex; width:100%; justify-content:flex-end; gap:8px; }
      </style>
      <div id="container">
        <div id="disk-space-div">
          <div id="disk-space-usage-div">
            <span id="used-space-span"></span> / <span id="allocated-space-span"></span>
          </div>
          <div id="error-message-div"></div>
          <paper-progress id="progress-bar" value="0" min="0" max="0"></paper-progress>
        </div>
        <paper-tooltip for="disk-space-div" role="tooltip" tabindex="-1" id="main-tooltip"></paper-tooltip>
      </div>
    `;
  }

  #cacheDomElements() {
    this.#domRefs.tooltip = this.shadowRoot.querySelector("#main-tooltip");
    this.#domRefs.diskUsageDiv = this.shadowRoot.querySelector("#disk-space-usage-div");
    this.#domRefs.allocatedSpaceSpan = this.shadowRoot.querySelector("#allocated-space-span");
    this.#domRefs.usedSpaceSpan = this.shadowRoot.querySelector("#used-space-span");
    this.#domRefs.errorMessageDiv = this.shadowRoot.querySelector("#error-message-div");
    this.#domRefs.progressBar = this.shadowRoot.querySelector("#progress-bar");
  }

  #updateEditableState(editable) {
    const span = this.#domRefs.allocatedSpaceSpan;
    const err = this.#domRefs.errorMessageDiv;

    // remove previous
    span.removeEventListener("click", this.#onEditClickBound);
    err.removeEventListener("click", this.#onEditClickBound);

    if (editable) {
      span.addEventListener("click", this.#onEditClickBound);
      err.addEventListener("click", this.#onEditClickBound);
      span.style.textDecoration = "underline";
      span.style.cursor = "pointer";
      err.style.cursor = "pointer";
    } else {
      span.style.textDecoration = "none";
      span.style.cursor = "default";
      err.style.cursor = "default";
    }
  }

  #displayAllocatedSpaceInputBox() {
    if (document.body.querySelector("#allocated-space-box")) return;

    const inputBox = document.createElement("paper-card");
    inputBox.id = "allocated-space-box";
    inputBox.classList.add("allocated-space-modal");

    inputBox.innerHTML = `
      <paper-input id="allocated-space-input" type="number" step="1" min="0" label="Allocated Space (GB)"></paper-input>
      <div class="buttons">
        <paper-button id="set-space-btn">Allocate</paper-button>
        <paper-button id="cancel-btn">Cancel</paper-button>
      </div>
    `;
    document.body.appendChild(inputBox);

    const coords = getCoords(this);
    inputBox.style.top = `${coords.top + 40}px`;
    inputBox.style.left = `${coords.left}px`;

    const inputField = inputBox.querySelector("#allocated-space-input");
    inputField.value = (this.#allocatedSpace / 1073741824).toString();

    inputBox.querySelector("#cancel-btn").addEventListener("click", () => inputBox.remove());
    inputBox.querySelector("#set-space-btn").addEventListener("click", async () => {
      const newSpaceGB = parseFloat(inputField.value);
      if (isNaN(newSpaceGB) || newSpaceGB < 0) {
        displayError("Please enter a valid number for allocated space.", 3000);
        return;
      }
      const newSpaceBytes = newSpaceGB * 1073741824;
      await this.#setSubjectAllocatedSpace(newSpaceBytes);
      inputBox.remove();
    });

    setTimeout(() => {
      inputField.focus();
      inputField.inputElement?.inputElement?.select?.();
    }, 100);
  }

  setAccount(account) {
    this.#account = account;
    this.setAttribute("account", `${account.getId()}@${account.getDomain()}`);
    this.#refreshData();
  }

  #updateUsedSpaceUI() {
    const used = this.#allocatedSpace - this.#availableSpace;
    const pct = this.#allocatedSpace > 0 ? ((used / this.#allocatedSpace) * 100).toFixed(2) : "0";
    this.#domRefs.tooltip.innerHTML = `
      ${getFileSizeString(used)} (${pct}%) used space of ${getFileSizeString(this.#allocatedSpace)}
    `;
    this.#domRefs.errorMessageDiv.style.display = "none";
    this.#domRefs.diskUsageDiv.style.display = "flex";
    this.#domRefs.progressBar.style.display = "block";
    this.#domRefs.progressBar.value = used;
    this.#domRefs.usedSpaceSpan.innerHTML = getFileSizeString(used);
  }

  #updateAllocatedSpaceUI() {
    this.#domRefs.errorMessageDiv.style.display = "none";
    this.#domRefs.diskUsageDiv.style.display = "flex";
    this.#domRefs.progressBar.style.display = "block";
    this.#domRefs.progressBar.max = this.#allocatedSpace;
    this.#domRefs.allocatedSpaceSpan.innerHTML = getFileSizeString(this.#allocatedSpace);
  }

  #resolveSubject() {
    if (this.hasAttribute("account") && this.#account) {
      if (this.#account.getId() === "sa") {
        this.style.display = "none";
        return null;
      }
      return { id: `${this.#account.getId()}@${this.#account.getDomain()}`, type: SubjectType.ACCOUNT };
    }
    if (this.hasAttribute("application")) {
      return { id: this.getAttribute("application"), type: SubjectType.APPLICATION };
    }
    return null;
  }

  async #refreshData() {
    const subject = this.#resolveSubject();
    if (!subject) {
      this.#displayErrorState("No account or application specified.");
      return;
    }

    this.style.display = "flex";

    try {
      this.#allocatedSpace = await getAllocatedSpace(subject.id, subject.type);
      this.#updateAllocatedSpaceUI();

      this.#domRefs.progressBar.setAttribute("indeterminate", "");
      this.#availableSpace = await getAvailableSpace(subject.id, subject.type);
      this.#domRefs.progressBar.removeAttribute("indeterminate");

      this.#updateUsedSpaceUI();
    } catch (err) {
      console.error(`DiskSpaceManager refresh failed for ${subject.id}:`, err);
      const msg =
        this.hasAttribute("account") && this.#account
          ? `No space allocated for user ${this.#account.getName?.() || subject.id}`
          : `No space allocated for application ${subject.id}`;
      this.#displayErrorState(msg, "Click here to allocate space");
    }
  }

  async #setSubjectAllocatedSpace(spaceBytes) {
    const subject = this.#resolveSubject();
    if (!subject) {
      displayError("No account or application specified to allocate space.", 3000);
      return;
    }

    try {
      await setAllocatedSpace(subject.id, subject.type, spaceBytes);
      this.#allocatedSpace = spaceBytes;
      this.#updateAllocatedSpaceUI();
      this.#updateUsedSpaceUI();
      displayMessage("Allocated space updated successfully!", 3000);
    } catch (err) {
      displayError(`Failed to set allocated space: ${err?.message || err}`, 3000);
      console.error(err);
    }
  }

  #displayErrorState(message, tooltipMessage = "") {
    this.#domRefs.errorMessageDiv.innerHTML = message;
    this.#domRefs.tooltip.innerHTML = tooltipMessage || message;
    this.#domRefs.errorMessageDiv.style.display = "block";
    this.#domRefs.diskUsageDiv.style.display = "none";
    this.#domRefs.progressBar.style.display = "none";
  }
}

customElements.define("globular-disk-space-manager", DiskSpaceManager);
