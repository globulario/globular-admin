import { displayError, displayMessage, displaySuccess } from "../../backend/ui/notify";
import { randomUUID } from "../utility.js";
import { getAccount, getCurrentAccount, type AccountVM } from "../../backend/rbac/accounts";
import { Notification, NotificationType } from "globular-web-client/resource/resource_pb";
import { createNotification } from "../../backend/notify/notification";
import { setMoveable } from "../moveable.js";
import { setResizeable } from "../resizeable.js";

import "@polymer/paper-card/paper-card.js";
import "@polymer/paper-icon-button/paper-icon-button.js";
import "@polymer/iron-autogrow-textarea/iron-autogrow-textarea.js";
import "@polymer/iron-icon/iron-icon.js";

type SubjectsViewEl = HTMLElement & {
  on_account_click?: (div: HTMLElement, account: AccountVM) => void;
  on_group_click?: (div: HTMLElement, group: any) => void;
};

type SubjectsSelectedEl = HTMLElement & {
  appendAccount?: (div: HTMLElement, account: AccountVM) => void;
  appendGroup?: (div: HTMLElement, group: any) => void;
  getAccounts?: () => AccountVM[];
  getGroups?: () => any[];
};

export class NotificationEditor extends HTMLElement {
  private _container: HTMLElement | null = null;
  private _messageBox: any = null;
  private _sendButton: HTMLElement | null = null;
  private _closeButton: HTMLElement | null = null;
  private _handleElement: HTMLElement | null = null;
  private _subjectsView: SubjectsViewEl | null = null;
  private _selectedSubjects: SubjectsSelectedEl | null = null;
  private _resizeObserver: ResizeObserver | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback(): void {
    this._renderInitialStructure();
    this._getDomReferences();
    this._bindEventListeners();
    this._setupDraggableAndResizable();
    this._setupSubjectsView();
    this._restoreDimensions();
  }

  disconnectedCallback(): void {
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
  }

  private _renderInitialStructure() {
    this.shadowRoot!.innerHTML = `
      <style>
        #container {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: var(--surface-color);
          border: 1px solid var(--palette-divider);
          box-shadow: var(--shadow-elevation-8dp);
          border-radius: 8px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          width: 600px;
          height: 400px;
          min-width: 350px;
          min-height: 300px;
          z-index: 1000;
        }
        .header {
          display: flex;
          align-items: center;
          color: var(--palette-text-accent);
          background-color: var(--palette-primary-accent);
          padding: 8px 16px;
          cursor: grab;
        }
        .header span {
          flex-grow: 1;
          text-align: center;
          font-size: 1.1rem;
          font-weight: 500;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: calc(100% - 60px);
          color: var(--on-primary-color);
        }
        .header paper-icon-button {
          min-width: 24px;
          color: var(--on-primary-color);
        }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: var(--surface-color); }
        ::-webkit-scrollbar-thumb { background: var(--palette-divider); }
        #content {
          display: flex;
          background: var(--palette-background-paper);
          color: var(--palette-text-primary);
          flex-grow: 1;
          font-size: 1.1rem;
          overflow: hidden;
        }
        globular-subjects-view {
          border-right: 1px solid var(--palette-divider);
          min-width: 250px;
          max-width: 40%;
          overflow-y: auto;
        }
        #sub-content {
          display: flex;
          flex-direction: column;
          flex-grow: 1;
          width: 100%;
          padding: 10px;
        }
        globular-subjects-selected {
          margin-bottom: 10px;
          max-height: 150px;
          overflow-y: auto;
          border: 1px solid var(--palette-divider);
          border-radius: 4px;
          padding: 5px;
        }
        #text-writer-box {
          flex-grow: 1;
          margin-bottom: 10px;
          border: 1px solid var(--palette-divider);
          border-radius: 4px;
          padding: 8px;
          background-color: var(--surface-color);
          color: var(--primary-text-color);
          --iron-autogrow-textarea-background-color: var(--surface-color);
          --iron-autogrow-textarea-placeholder-color: var(--secondary-text-color);
          font-family: inherit;
          font-size: inherit;
        }
        #send-btn {
          align-self: flex-end;
          background-color: var(--palette-primary-main);
          color: var(--palette-primary-contrast);
          border-radius: 50%;
          width: 48px;
          height: 48px;
          box-shadow: var(--shadow-elevation-4dp);
          transition: transform 0.2s ease-in-out, background-color 0.2s ease-in-out;
        }
        #send-btn:hover {
          transform: scale(1.05);
          background-color: var(--palette-primary-dark);
        }
        @media (max-width: 500px) {
          #content { flex-direction: column; overflow-y: auto; }
          globular-subjects-view { border-right: none; border-bottom: 1px solid var(--palette-divider); max-width: 100%; height: 200px; flex-shrink: 0; }
          #sub-content { margin-bottom: 50px; padding: 5px; }
          #container { width: 95%; height: 80%; }
        }
      </style>
      <paper-card id="container">
        <div class="header">
          <span id="handle">Notification</span>
          <paper-icon-button id="close-btn" icon="icons:close"></paper-icon-button>
        </div>
        <div id="content">
          <globular-subjects-view></globular-subjects-view>
          <div id="sub-content">
            <globular-subjects-selected></globular-subjects-selected>
            <iron-autogrow-textarea id="text-writer-box" placeholder="Write your notification message..."></iron-autogrow-textarea>
            <paper-icon-button id="send-btn" icon="send"></paper-icon-button>
          </div>
        </div>
      </paper-card>
    `;
  }

  private _getDomReferences() {
    this._container = this.shadowRoot!.querySelector("#container");
    this._messageBox = this.shadowRoot!.querySelector("#text-writer-box");
    this._sendButton = this.shadowRoot!.querySelector("#send-btn");
    this._closeButton = this.shadowRoot!.querySelector("#close-btn");
    this._handleElement = this.shadowRoot!.querySelector(".header");
    this._subjectsView = this.shadowRoot!.querySelector("globular-subjects-view") as SubjectsViewEl;
    this._selectedSubjects = this.shadowRoot!.querySelector("globular-subjects-selected") as SubjectsSelectedEl;
  }

  private _bindEventListeners() {
    this._sendButton?.addEventListener("click", () => this._sendNotification());
    this._closeButton?.addEventListener("click", () => this.remove());
  }

  private _setupDraggableAndResizable() {
    if (this._handleElement && this._container) {
      setMoveable(this._handleElement, this._container, () => {}, this, 64);
      setResizeable(this._container, (width: number, height: number) => {
        const minWidth = 600;
        const minHeight = 400;
        const finalWidth = Math.max(width, minWidth);
        const finalHeight = Math.max(height, minHeight);
        this._container!.style.width = `${finalWidth}px`;
        this._container!.style.height = `${finalHeight}px`;
        localStorage.setItem("__notification_editor_dimension__", JSON.stringify({ width: finalWidth, height: finalHeight }));
      });
    }
  }

  private _setupSubjectsView() {
    if (this._subjectsView && this._selectedSubjects) {
      this._subjectsView.on_account_click = (_div, account) => this._selectedSubjects?.appendAccount?.(_div, account);
      this._subjectsView.on_group_click = (_div, group) => this._selectedSubjects?.appendGroup?.(_div, group);
    }
  }

  private _restoreDimensions() {
    const savedDimensions = localStorage.getItem("__notification_editor_dimension__");
    if (this._container && savedDimensions) {
      try {
        const { width, height } = JSON.parse(savedDimensions);
        this._container.style.width = `${Math.max(width, 600)}px`;
        this._container.style.height = `${Math.max(height, 400)}px`;
      } catch {
        localStorage.removeItem("__notification_editor_dimension__");
      }
    }
  }

  private async _collectRecipientAccounts(): Promise<Record<string, AccountVM>> {
    const uniqueAccounts: Record<string, AccountVM> = {};
    const selectedAccounts = this._selectedSubjects?.getAccounts?.() || [];
    const selectedGroups = this._selectedSubjects?.getGroups?.() || [];

    selectedAccounts.forEach((account: AccountVM) => {
      if (account?.id) uniqueAccounts[account.id] = account;
    });

    for (const group of selectedGroups) {
      const members: string[] = Array.isArray(group?.members) ? group.members : [];
      for (const memberId of members) {
        try {
          const acc = await getAccount(memberId);
          if (acc?.id) uniqueAccounts[acc.id] = acc;
        } catch (err: any) {
          console.warn(`Failed to get account ${memberId}: ${err?.message || err}`);
        }
      }
    }

    return uniqueAccounts;
  }

  private async _sendNotification() {
    const message = this._messageBox?.value?.trim?.() || "";
    if (!message) {
      displayMessage("Notification message cannot be empty.", 3000);
      return;
    }

    const sender = getCurrentAccount();
    if (!sender?.id || !sender?.domain) {
      displayError("Sender account information is missing.", 3000);
      return;
    }

    const recipients = await this._collectRecipientAccounts();
    const recipientCount = Object.keys(recipients).length;
    if (recipientCount === 0) {
      displayMessage("Please select at least one recipient.", 3000);
      return;
    }

    displayMessage(
      `<div style="display: flex;"><iron-icon icon="send"></iron-icon><span style="margin-left: 20px;">Sending notification...</span></div>`,
      0
    );

    const results = await Promise.all(
      Object.values(recipients).map(async (acc: AccountVM) => {
        try {
          const vm = {
            id: randomUUID(),
            sender: `${sender.id}@${sender.domain}`,
            recipient: `${acc.id}@${acc.domain}`,
            message,
            mac: (acc as any).mac || "",
            type: NotificationType.USER_NOTIFICATION,
            date: Math.floor(Date.now() / 1000),
          };
          await createNotification(vm);

          const n = new Notification();
          n.setId(vm.id);
          n.setSender(vm.sender);
          n.setRecipient(vm.recipient);
          n.setMessage(vm.message);
          n.setMac(vm.mac || "");
          n.setNotificationType(vm.type);
          n.setDate(vm.date);
          document.dispatchEvent(new CustomEvent("new-notification", { detail: n }));
          return true;
        } catch (err: any) {
          displayError(`Failed to send to ${acc.id}@${acc.domain}: ${err?.message || err}`, 3000);
          return false;
        }
      })
    );

    const sentCount = results.filter(Boolean).length;
    const failed = recipientCount - sentCount;

    displaySuccess(
      `<div style="display: flex;"><iron-icon icon="send"></iron-icon><span style="margin-left: 20px;">Notification sent to ${sentCount} of ${recipientCount}${failed ? ` (${failed} failed)` : ""}</span></div>`,
      3000
    );
    this.remove();
  }

  remove(): void {
    if (this.parentNode) this.parentNode.removeChild(this);
  }
}

customElements.define("globular-notification-editor", NotificationEditor);
