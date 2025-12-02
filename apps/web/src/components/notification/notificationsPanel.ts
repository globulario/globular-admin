import { displayError, displayMessage, displaySuccess } from "../../backend/ui/notify";
import { listNotifications, clearNotificationsByType, deleteNotification, NotificationVM } from "../../backend/notify/notification";
import { NotificationType, Notification } from "globular-web-client/resource/resource_pb";
import { getCurrentAccount, getAccount, type AccountVM } from "../../backend/rbac/accounts";
import { NotificationEditor } from "./notificationEditor";

import "@polymer/iron-icon/iron-icon.js";
import "@polymer/iron-icons/iron-icons.js";
import "@polymer/iron-icons/social-icons.js";
import "@polymer/paper-card/paper-card.js";
import "@polymer/paper-button/paper-button.js";
import "@polymer/paper-icon-button/paper-icon-button.js";
import "@polymer/paper-ripple/paper-ripple.js";
import "@polymer/iron-collapse/iron-collapse.js";

export class NotificationsPanel extends HTMLElement {
  private _listeners: Record<string, any> = {};
  private _container: HTMLElement | null = null;
  private _applicationNotificationsDiv: HTMLElement | null = null;
  private _userNotificationsDiv: HTMLElement | null = null;
  private _userNotificationsBtn: HTMLElement | null = null;
  private _applicationNotificationBtn: HTMLElement | null = null;
  private _userNotificationsCollapse: any = null;
  private _applicationNotificationsCollapse: any = null;
  private _applicationNotificationsPanel: HTMLElement | null = null;
  private _userNotificationsPanel: HTMLElement | null = null;
  private _notificationCreateBtn: HTMLElement | null = null;
  private _clearUserNotificationsBtn: HTMLElement | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback(): void {
    this._render();
    this._grabRefs();
    this._bindEvents();
    this._loadNotifications();
  }

  disconnectedCallback(): void {
    Object.keys(this._listeners).forEach((k) => {
      document.removeEventListener(k, this._listeners[k]);
    });
    this._listeners = {};
  }

  private _render() {
    this.shadowRoot!.innerHTML = `
      <style>
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: var(--surface-color); }
        ::-webkit-scrollbar-thumb { background: var(--palette-divider); }
        #notifications {
          display: flex;
          flex-direction: column;
          position: absolute;
          top: 70px;
          right: 10px;
          z-index: 1000;
          background-color: var(--surface-color);
          color: var(--on-surface-color);
          border-radius: 8px;
          box-shadow: var(--shadow-elevation-8dp);
          overflow: hidden;
        }
        .header {
          display: flex;
          min-width: 375px;
          position: relative;
          font-size: 12pt;
          align-items: center;
          padding: .5rem;
          background-color: var(--surface-color);
          color: var(--on-surface-color);
          border-bottom: 1px solid var(--palette-action-disabled);
        }
        .header paper-icon-button { min-width: 40px; color: var(--on-surface-color); }
        .notification-label { flex-grow: 1; text-align: center; font-size: 1.1rem; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: calc(100% - 60px); }
        .body {
          min-width: 375px;
          min-height: 100px;
          max-height: 30rem;
          overflow-y: auto;
          background-color: var(--surface-color);
          color: var(--on-surface-color);
        }
        .btn_div { display: flex; flex-grow: 1; justify-content: flex-end; }
        .btn_ { position: relative; }
        .btn_:hover { cursor: pointer; }
        iron-collapse { border-bottom: 1px solid var(--palette-action-disabled); }
        iron-collapse:last-of-type { border-bottom: none; }
        .notification_panel {
          display: flex;
          padding: .75rem;
          font-size: 12pt;
          background-color: var(--surface-color);
          color: var(--on-surface-color);
          border-bottom: 1px solid var(--palette-action-disabled);
          position: relative;
          transition: background 0.2s ease;
        }
        .notification_panel:hover { background-color: var(--palette-action-hover); cursor: pointer; }
        .notification_panel img { height: 48px; width: 48px; border-radius: 50%; }
        #user-notifications-btn, #application-notifications-btn {
          display: flex;
          position: relative;
          align-items: center;
          justify-content: space-between;
          padding: .5rem;
          background-color: var(--palette-background-dark);
          color: var(--primary-text-color);
          border-bottom: 1px solid var(--palette-divider);
        }
        #user-notifications-btn span, #application-notifications-btn span { flex-grow: 1; margin-right: 10px; }
        #content { width: 100%; display: flex; flex-direction: column; }
        paper-button { font-size: .85rem; font-weight: 350; }
        .new_notification { background-color: var(--palette-primary-light); }
        .notification-close-btn-appended {
          position: absolute;
          top: -5px;
          right: -5px;
          z-index: 10;
          color: var(--primary-color);
          display: none;
          background-color: var(--surface-color);
          border-radius: 50%;
        }
        .notification_panel:hover .notification-close-btn-appended { display: block; }
        @media (max-width: 500px) {
          #notifications { width: calc(100vw - 20px); right: 10px; left: 10px; margin: auto; top: 10px; max-height: calc(100vh - 20px); }
          .header, .body { min-width: unset; width: auto; }
          .header { padding: 0.5rem; }
          .notification-label, .btn_ { padding: 0.5rem; }
          .body { max-height: calc(100vh - 160px); }
        }
      </style>
      <paper-card id="notifications">
        <div id="content">
          <div class="header">
            <span class="notification-label">Notifications</span>
            <div class="btn_div">
              <div class="btn_">
                <paper-icon-button id="notification-create-btn" icon="icons:add"></paper-icon-button>
                <paper-ripple class="circle" recenters></paper-ripple>
              </div>
            </div>
          </div>

          <div id="application-notifications" style="display: none;">
            <div class="header" id="application-notifications-btn">
              <span class="notification-label">Application</span>
              <paper-ripple recenters></paper-ripple>
            </div>
            <iron-collapse id="application-notifications-collapse" opened>
              <div id="application-notifications-panel" class="body"></div>
            </iron-collapse>
          </div>

          <div id="user-notifications" style="display: none;">
            <div class="header" id="user-notifications-btn">
              <span class="notification-label">User</span>
              <paper-button id="clear-user-notifications-btn">Clear</paper-button>
              <paper-ripple recenters></paper-ripple>
            </div>
            <iron-collapse id="user-notifications-collapse">
              <div id="user-notifications-panel" class="body"></div>
            </iron-collapse>
          </div>
        </div>
      </paper-card>
    `;
  }

  private _grabRefs() {
    const root = this.shadowRoot!;
    this._container = root.querySelector("#notifications");
    this._applicationNotificationsDiv = root.getElementById("application-notifications");
    this._userNotificationsDiv = root.getElementById("user-notifications");
    this._userNotificationsBtn = root.getElementById("user-notifications-btn");
    this._applicationNotificationBtn = root.getElementById("application-notifications-btn");
    this._userNotificationsCollapse = root.getElementById("user-notifications-collapse");
    this._applicationNotificationsCollapse = root.getElementById("application-notifications-collapse");
    this._applicationNotificationsPanel = root.getElementById("application-notifications-panel");
    this._userNotificationsPanel = root.getElementById("user-notifications-panel");
    this._notificationCreateBtn = root.getElementById("notification-create-btn");
    this._clearUserNotificationsBtn = root.getElementById("clear-user-notifications-btn");
  }

  private _bindEvents() {
    this._clearUserNotificationsBtn?.addEventListener("click", (e) => this._handleClearUserNotificationsClick(e));
    this._notificationCreateBtn?.addEventListener("click", () => this._handleCreateNotificationClick());
    this._userNotificationsBtn?.addEventListener("click", () => this._handleToggleSection("user"));
    this._applicationNotificationBtn?.addEventListener("click", () => this._handleToggleSection("application"));

    const onNewNotification = (evt: any) => {
      const n = evt.detail as Notification;
      if (n && n.getRecipient && n.getRecipient() === this._userRecipient()) {
        this._appendNotification(this._userNotificationsPanel!, n);
        if (!this._userNotificationsCollapse.opened) this._userNotificationsCollapse.toggle();
      }
    };
    document.addEventListener("new-notification", onNewNotification);
    this._listeners["new-notification"] = onNewNotification;
  }

  private _userRecipient(): string {
    const acc = getCurrentAccount();
    return acc ? `${acc.id}@${acc.domain}` : "";
  }

  private async _loadNotifications() {
    const recipient = this._userRecipient();
    if (!recipient) return;
    try {
      const list = await listNotifications(recipient, NotificationType.USER_NOTIFICATION);
      const protos = list.map((n: NotificationVM) => {
        const proto = new Notification();
        proto.setId(n.id);
        proto.setSender(n.sender);
        proto.setRecipient(n.recipient);
        proto.setMessage(n.message);
        proto.setMac(n.mac || "");
        proto.setNotificationType(n.type);
        proto.setDate(n.date);
        return proto;
      });
      this.setUserNotifications(protos);
    } catch (err: any) {
      displayError(`Failed to load notifications: ${err?.message || err}`, 3000);
    }
  }

  private _handleClearUserNotificationsClick(evt: Event) {
    evt.stopPropagation();
    const toast = displayMessage(
      `
        <style>
          #yes-no-notification-delete-box { display: flex; flex-direction: column; }
          #yes-no-notification-delete-box div { display: flex; padding-bottom: 10px; }
          #yes-no-notification-delete-box paper-button { font-size: .8rem; }
        </style>
        <div id="yes-no-notification-delete-box">
          <div>You're about to delete all user notifications</div>
          <div>Is this what you want to do?</div>
          <div style="justify-content: flex-end;">
            <paper-button raised id="yes-delete-notification">Yes</paper-button>
            <paper-button raised id="no-delete-notification">No</paper-button>
          </div>
        </div>
      `,
      15000
    );

    const yesBtn = toast.toastElement ? toast.toastElement.querySelector("#yes-delete-notification") : null;
    const noBtn = toast.toastElement ? toast.toastElement.querySelector("#no-delete-notification") : null;

    yesBtn?.addEventListener("click", async () => {
      toast.hideToast();
      const recipient = this._userRecipient();
      try {
        await clearNotificationsByType(recipient, NotificationType.USER_NOTIFICATION);
        displaySuccess("<iron-icon icon='icons:delete' style='margin-right: 10px;'></iron-icon><div>All user notifications were removed</div>", 3000);
        this.clearUserNotifications();
      } catch (err: any) {
        displayError(`Failed to clear notifications: ${err?.message || err}`, 3000);
      }
    });

    noBtn?.addEventListener("click", () => toast.hideToast());
  }

  private _handleCreateNotificationClick() {
    const editor = new NotificationEditor();
    document.body.appendChild(editor);
  }

  private _handleToggleSection(type: "user" | "application") {
    const targetCollapse = type === "user" ? this._userNotificationsCollapse : this._applicationNotificationsCollapse;
    const otherCollapse = type === "user" ? this._applicationNotificationsCollapse : this._userNotificationsCollapse;
    const targetBtn = type === "user" ? this._userNotificationsBtn : this._applicationNotificationBtn;
    const otherBtn = type === "user" ? this._applicationNotificationBtn : this._userNotificationsBtn;

    targetCollapse?.toggle();
    if (otherCollapse?.opened) otherCollapse.toggle();
    if (targetBtn) targetBtn.style.borderTop = targetCollapse?.opened ? "1px solid var(--palette-action-disabled)" : "";
    if (otherBtn) otherBtn.style.borderTop = otherCollapse?.opened ? "1px solid var(--palette-action-disabled)" : "";
  }

  setUserNotifications(notifications: Notification[]) {
    this._userNotificationsPanel!.innerHTML = "";
    if (notifications && notifications.length) {
      notifications.forEach((n) => this._appendNotification(this._userNotificationsPanel!, n));
      this._userNotificationsDiv!.style.display = "";
      if (!this._userNotificationsCollapse.opened) this._userNotificationsCollapse.toggle();
    } else {
      this.clearUserNotifications();
    }
  }

  clearUserNotifications() {
    this._userNotificationsPanel!.innerHTML = "";
    if (this._userNotificationsDiv) this._userNotificationsDiv.style.display = "none";
    if (this._userNotificationsCollapse?.opened) this._userNotificationsCollapse.toggle();
  }

  private _appendNotification(parent: HTMLElement, notification: Notification) {
    const id = notification.getId();
    const notificationDivId = `div_${id}`;
    if (this.shadowRoot!.getElementById(notificationDivId)) return;

    const html = `
      <div id="${notificationDivId}" class="notification_panel">
        <paper-icon-button id="${notificationDivId}_close_btn" class="notification-close-btn-appended" icon="close"></paper-icon-button>
        <div id="${notificationDivId}_recipient_info" style="display: flex; flex-direction: column; padding: 5px; align-items: center;">
          <img id="${notificationDivId}_img" alt="sender image"></img>
          <iron-icon id="${notificationDivId}_ico" icon="account-circle"></iron-icon>
          <span id="${notificationDivId}_span" style="font-size: 10pt;"></span>
          <div id="${notificationDivId}_date" class="notification_date" style="font-size: 10pt;"></div>
        </div>
        <div style="display: flex; flex-direction: column; padding:5px; flex-grow: 1;">
          <div id="${notificationDivId}_text" style="flex-grow: 1; display: flex;">${notification.getMessage()}</div>
        </div>
      </div>
    `;

    parent.insertAdjacentHTML("afterbegin", html);
    const closeBtn = this.shadowRoot!.getElementById(`${notificationDivId}_close_btn`)!;
    const dateDiv = this.shadowRoot!.getElementById(`${notificationDivId}_date`)!;
    const img = this.shadowRoot!.getElementById(`${notificationDivId}_img`)! as HTMLImageElement;
    const ico = this.shadowRoot!.getElementById(`${notificationDivId}_ico`)!;
    const span = this.shadowRoot!.getElementById(`${notificationDivId}_span`)!;
    const notificationDiv = this.shadowRoot!.getElementById(notificationDivId)!;

    const date = new Date(notification.getDate() * 1000);
    const updateDate = () => {
      const now = new Date();
      const delay = Math.floor((now.getTime() - date.getTime()) / 1000);
      let text = "";
      if (delay < 60) text = `${delay} seconds ago`;
      else if (delay < 3600) text = `${Math.floor(delay / 60)} minutes ago`;
      else if (delay < 86400) text = `${Math.floor(delay / 3600)} hours ago`;
      else text = `${Math.floor(delay / 86400)} days ago`;
      dateDiv.textContent = text;
    };
    updateDate();
    const interval = setInterval(updateDate, 1000);
    notificationDiv.addEventListener("DOMNodeRemoved", () => clearInterval(interval));

    notificationDiv.addEventListener("mouseover", () => {
      notificationDiv.style.cursor = "pointer";
      if (notification.getNotificationType() === NotificationType.USER_NOTIFICATION) closeBtn.style.display = "block";
    });
    notificationDiv.addEventListener("mouseleave", () => {
      notificationDiv.style.cursor = "default";
      if (notification.getNotificationType() === NotificationType.USER_NOTIFICATION) closeBtn.style.display = "none";
    });

    closeBtn.addEventListener("click", async () => {
      try {
        await deleteNotification(notification.getId(), notification.getRecipient());
        notificationDiv.parentNode?.removeChild(notificationDiv);
        document.dispatchEvent(new CustomEvent("removed-notification", { detail: notification }));
      } catch (err: any) {
        displayError(`Failed to delete notification: ${err?.message || err}`, 3000);
      }
    });

    if (notification.getNotificationType() === NotificationType.USER_NOTIFICATION) {
      const senderId = notification.getSender();
      getAccount(senderId)
        .then((account: AccountVM | null) => {
          if (account?.profilePicture) {
            img.src = account.profilePicture;
            img.style.display = "block";
            img.style.maxWidth = "64px";
            img.style.maxHeight = "64px";
            img.style.borderRadius = "50%";
            (ico as any).style.display = "none";
          } else {
            img.style.display = "none";
            (ico as any).style.display = "block";
          }
          span.textContent = account?.displayName || account?.name || senderId;
        })
        .catch(() => {
          img.style.display = "none";
          (ico as any).style.display = "block";
          span.textContent = senderId;
        });
    }
  }
}

customElements.define("globular-notifications-panel", NotificationsPanel);

class NotificationMenu extends HTMLElement {
  private _unreadCount = 0;
  private _notificationCountBadge: HTMLElement | null = null;
  private _notificationsPanel: NotificationsPanel | null = null;

  static get observedAttributes() {
    return ["unread-count"];
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback(): void {
    this._render();
    this._getDomReferences();
    this.addEventListener("click", () => this._handleClick());
    if (this.hasAttribute("unread-count")) {
      this._unreadCount = parseInt(this.getAttribute("unread-count") || "0", 10) || 0;
      this._updateBadgeDisplay();
    }
    document.addEventListener("new-notification", () => this._handleNewNotificationEvent());
    document.addEventListener("removed-notification", () => this._handleRemovedNotificationEvent());
  }

  attributeChangedCallback(name: string, _oldValue: string, newValue: string) {
    if (name === "unread-count") {
      this._unreadCount = parseInt(newValue || "0", 10) || 0;
      this._updateBadgeDisplay();
    }
  }

  private _render() {
    this.shadowRoot!.innerHTML = `
      <style>
        :host { display: inline-flex; align-items: center; position: relative; }
        .badge {
          position: absolute; top: -6px; left: 22px;
          background-color: red; color: white; border-radius: 50%;
          width: 20px; height: 20px; font-size: 10px;
          display: flex; align-items: center; justify-content: center;
          border: 3px solid var(--primary-color);
        }
        div:hover { cursor: pointer; }
        iron-icon { color: var(--primary-text-color); }
        iron-icon:hover { color: var(--primary-color); }
      </style>
      <div>
        <iron-icon icon="social:notifications-none"></iron-icon>
        <span class="badge" style="display: none;">${this._unreadCount}</span>
      </div>
    `;
  }

  private _getDomReferences() {
    this._notificationCountBadge = this.shadowRoot!.querySelector(".badge");
  }

  private _updateBadgeDisplay() {
    if (this._notificationCountBadge) {
      this._notificationCountBadge.textContent = String(this._unreadCount);
      this._notificationCountBadge.style.display = this._unreadCount > 0 ? "flex" : "none";
    }
  }

  private _handleNewNotificationEvent() {
    this._unreadCount++;
    this._updateBadgeDisplay();
  }

  private _handleRemovedNotificationEvent() {
    if (this._unreadCount > 0) this._unreadCount--;
    this._updateBadgeDisplay();
  }

  private _handleClick() {
    if (!this._notificationsPanel) {
      this._notificationsPanel = new NotificationsPanel();
    }
    const isHidden = this._notificationsPanel.parentNode === null;
    if (isHidden) {
      document.body.appendChild(this._notificationsPanel);
    } else {
      document.body.removeChild(this._notificationsPanel);
    }
    const now = new Date();
    localStorage.setItem("notifications_read_date", now.getTime().toString());
    this._unreadCount = 0;
    this._updateBadgeDisplay();
    this._notificationsPanel.shadowRoot!.querySelectorAll(".new_notification").forEach((el) => {
      el.classList.remove("new_notification");
    });
  }
}

customElements.define("globular-notification-menu", NotificationMenu);
