// searchable_entities.js — updated to the new PeerVM/ApplicationVM accessors

import getUuidByString from "uuid-by-string";

// Base list component (unchanged import)
import { SearchableList } from "../list.js";

// Newer backend wrappers (adjust paths if yours differ)
import { listAccounts } from "../../backend/rbac/accounts";
import { listGroups }   from "../../backend/rbac/groups";
import { listRoles }    from "../../backend/rbac/roles";
import { listOrganizations } from "../../backend/rbac/organizations";
import { listPeers }    from "../../backend/rbac/peers";   // NEW peers accessor (PeerVM[])
import { listApplications } from "../../backend/rbac/applications"; // NEW apps accessor (ApplicationVM[])

// UI deps
import '@polymer/paper-card/paper-card.js';
import '@polymer/paper-icon-button/paper-icon-button.js';
import '@polymer/iron-icon/iron-icon.js';
import '@polymer/iron-icons/social-icons.js';
import '@polymer/iron-icons/hardware-icons.js';
import '@polymer/iron-icons/iron-icons.js';
import '../autocomplete.js';

/* -----------------------------------------------------------------------------
 * Small access helpers to support both proto objects and VM/plain objects
 * -------------------------------------------------------------------------- */
const callIf = (o, m) => (o && typeof o[m] === "function") ? o[m]() : undefined;

function getId(o) {
  return callIf(o, "getId") ?? o?.id ?? o?.uuid ?? "";
}
function getName(o) {
  return callIf(o, "getName") ?? o?.name ?? "";
}
function getEmail(o) {
  return callIf(o, "getEmail") ?? o?.email ?? "";
}
function getFirstName(o) {
  return callIf(o, "getFirstname") ?? o?.firstName ?? o?.firstname ?? "";
}
function getLastName(o) {
  return callIf(o, "getLastname") ?? o?.lastName ?? o?.lastname ?? "";
}
function getProfilePicture(o) {
  return callIf(o, "getProfilepicture") ?? o?.profilePicture ?? o?.avatar ?? "";
}
function getAlias(o) {
  return callIf(o, "getAlias") ?? o?.alias ?? "";
}
function getVersion(o) {
  return callIf(o, "getVersion") ?? o?.version ?? "";
}
function getDomain(o) {
  return callIf(o, "getDomain") ?? o?.domain ?? "";
}
function getIcon(o) {
  return callIf(o, "getIcon") ?? o?.icon ?? "";
}
function getHostname(o) {
  return callIf(o, "getHostname") ?? o?.hostname ?? o?.host ?? "";
}
function getMac(o) {
  return callIf(o, "getMac") ?? o?.mac ?? "";
}

// For Peers: treat MAC as identity if id is missing
function getPeerKey(o) {
  return getId(o) || getMac(o) || "";
}

/* -----------------------------------------------------------------------------
 * Common “Add Panel” helper (uses new backend fetchers)
 * -------------------------------------------------------------------------- */
async function _setupAddPanelLogic(
  parentComponent,
  panelId,
  titleText,
  autocompleteLabel,
  fetchAllItemsFn,       // async () => Array<any>
  filterAutocompleteFn,  // (all, query) => subset
  createItemDivFn,       // (item) => HTMLElement
  autocompleteType = "text"
) {
  const headerDiv = parentComponent.shadowRoot.querySelector("#header-div");
  let panel = headerDiv.querySelector(`#${panelId}`);
  if (panel) return;

  const html = `
    <style>
      #${panelId}{
        position:absolute;
        left:0;
        z-index:10;
        background: var(--surface-color);
        border-radius: 10px;
        box-shadow: var(--shadow-elevation-6dp);
        width: min(520px, calc(100% - 24px));
        max-height: calc(80vh);
        overflow: visible;
        display:flex;
        flex-direction:column;
      }
      #${panelId} .panel-header {
        display:flex; align-items:center; gap:8px;
        padding:8px;
        background: var(--palette-primary-accent);
        color: var(--on-primary-color);
        border-bottom: 1px solid var(--palette-divider);
      }
      #${panelId} .panel-header > div { flex:1; font-weight:500; }
      #${panelId} .card-content {
        flex:1;
        padding:12px;
        overflow: visible;
      }
      #${panelId} paper-card { background: var(--surface-color); color: var(--primary-text-color); }
      #${panelId} globular-autocomplete { --globular-autocomplete-input-width: 100%; }
    </style>
    <paper-card id="${panelId}">
      <div class="panel-header">
        <div>${titleText}</div>
        <paper-icon-button id="cancel-btn" icon="icons:close"></paper-icon-button>
      </div>
      <div class="card-content">
        <globular-autocomplete type="${autocompleteType}" label="${autocompleteLabel}" id="add_input" width="${parentComponent.width - 20}" style="flex:1;"></globular-autocomplete>
      </div>
    </paper-card>
  `;

  headerDiv.appendChild(document.createRange().createContextualFragment(html));
  panel = headerDiv.querySelector(`#${panelId}`);
  panel.style.top = `${(headerDiv.offsetHeight / 2) + 14}px`;

  panel.querySelector("#cancel-btn").addEventListener('click', () => {
    panel?.parentNode?.removeChild(panel);
  });

  const addInput = panel.querySelector("globular-autocomplete");
  addInput.focus();

  // Fetch items from new backend wrapper
  let allAvailableItems = await fetchAllItemsFn();

  // Remove items already displayed
  const current = parentComponent.list ?? [];
  allAvailableItems = allAvailableItems.filter(item =>
    !current.some(existing => (getPeerKey(existing) || getId(existing)) === (getPeerKey(item) || getId(item)))
  );

  const refreshAutocomplete = () => {
    const v = addInput.getValue?.() ?? "";
    if (v && v.length >= 2) {
      const filtered = filterAutocompleteFn(allAvailableItems, v);
      addInput.setValues?.(filtered);
    } else {
      addInput.clearSuggestions?.();
    }
  };

  addInput.onkeyup = refreshAutocomplete;

  const addItemToPanel = (item) => {
    const key = getPeerKey(item) || getId(item);
    allAvailableItems = allAvailableItems.filter(a => (getPeerKey(a) || getId(a)) !== key);
    addInput.clear?.();
    refreshAutocomplete();
    parentComponent.onadditem?.(item);
  };

  addInput.displayValue = (item) => {
    const itemDiv = createItemDivFn(item);
    const btn = itemDiv.querySelector("paper-icon-button");
    const clickHandler = (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      addItemToPanel(item);
    };
    itemDiv.addEventListener('click', clickHandler);
    if (btn) {
      btn.icon = "icons:add";
      btn.addEventListener('click', clickHandler);
    }
    return itemDiv;
  };
}

/* -----------------------------------------------------------------------------
 * Generic item renderer
 * -------------------------------------------------------------------------- */
function _createGenericItemDiv(uuid, mainText, subText = "", iconUrl = "", iconName = "account-circle") {
  const div = document.createElement('div');
  div.id = uuid;
  div.className = "item-div";
  div.innerHTML = `
    <style>
      .item-div {
        display:flex; align-items:center; padding:8px; width:100%;
        border-bottom:1px solid var(--palette-divider);
      }
      .item-div:last-child { border-bottom:none; }
      .item-icon {
        width:40px; height:40px; border-radius:50%; object-fit:cover; margin-right:8px; flex-shrink:0;
      }
      .item-icon-placeholder {
        width:40px; height:40px; margin-right:8px; flex-shrink:0;
        --iron-icon-fill-color: var(--palette-action-disabled);
      }
      .item-text-content { display:flex; flex-direction:column; flex:1; font-size:.9em; }
      .item-text-content span:first-child { font-weight:500; }
      .item-delete-btn { margin-left:auto; color: var(--primary-text-color); }
      .item-delete-btn:hover { color: var(--palette-error-main); cursor:pointer; }
    </style>
    <div style="display:flex; align-items:center; width:100%;">
      ${iconUrl ? `<img class="item-icon" src="${iconUrl}" alt="icon">`
                : `<iron-icon class="item-icon-placeholder" icon="${iconName}"></iron-icon>`}
      <div class="item-text-content">
        <span>${mainText}</span>
        ${subText ? `<span>${subText}</span>` : ''}
      </div>
      <paper-icon-button class="item-delete-btn" icon="icons:delete"></paper-icon-button>
    </div>
  `;
  return div;
}

/* -----------------------------------------------------------------------------
 * Accounts
 * -------------------------------------------------------------------------- */
export class SearchableAccountList extends SearchableList {
  constructor(title, list, ondeleteaccount, onaddaccount) {
    const onadd = async () => {
      await _setupAddPanelLogic(
        this,
        "add-list-user-panel",
        "Add Account",
        "Search Account",
        async () => {
          // Expect an array of Account objects (proto or VM)
          const { items } = await listAccounts({ pageSize: 1000 });
          return items ?? [];
        },
        (all, value) => {
          const V = value.toUpperCase();
          return all.filter(a =>
            getName(a).toUpperCase().includes(V) ||
            getEmail(a).toUpperCase().includes(V)
          );
        },
        (account) => this.createAccountDiv(account),
        "email"
      );
    };
    super(title, list, ondeleteaccount, onaddaccount, onadd);
  }

  createAccountDiv(account) {
    const id = getId(account);
    const uuid = `_${getUuidByString(id)}`;
    const dispName = (getFirstName(account) && getLastName(account))
      ? `${getFirstName(account)} ${getLastName(account)}`
      : getName(account);
    const email = getEmail(account);
    const avatar = getProfilePicture(account);
    return _createGenericItemDiv(uuid, dispName, email, avatar, "account-circle");
  }

  removeItem(a) {
    const id = getId(a);
    this.list = (this.list ?? []).filter(el => getId(el) !== id);
  }

  displayItem(a) {
    const div = this.createAccountDiv(a);
    const del = div.querySelector(".item-delete-btn");
    if (this.ondeleteitem) {
      del.addEventListener('click', () => {
        div.parentNode?.removeChild(div);
        this.ondeleteitem(a);
      });
    } else {
      del.style.display = "none";
    }
    return div;
  }

  filter(a) {
    const f = (this.filter_ ?? "").toUpperCase();
    return getName(a).toUpperCase().includes(f) || getEmail(a).toUpperCase().includes(f);
  }

  sortItems() {
    return (this.list ?? []).sort((a, b) => getName(a).localeCompare(getName(b)));
  }
}
customElements.define('globular-searchable-account-list', SearchableAccountList);

/* -----------------------------------------------------------------------------
 * Applications (uses new listApplications(): Promise<ApplicationVM[]>)
 * -------------------------------------------------------------------------- */
export class SearchableApplicationList extends SearchableList {
  constructor(title, list, ondeleteapplication, onaddapplication) {
    const onadd = async () => {
      await _setupAddPanelLogic(
        this,
        "add-list-application-panel",
        "Add Application",
        "Search Application",
        async () => {
          const items = await listApplications(); // ← now returns ApplicationVM[]
          return items ?? [];
        },
        (all, value) => {
          const V = value.toUpperCase();
          return all.filter(a =>
            (getName(a) || "").toUpperCase().includes(V) ||
            (getAlias(a) || "").toUpperCase().includes(V)
          );
        },
        (application) => this.createApplicationDiv(application)
      );
    };
    super(title, list, ondeleteapplication, onaddapplication, onadd);
  }

  createApplicationDiv(application) {
    const id = getId(application);
    const uuid = `_${id}`;
    const aliasOrName = getAlias(application) || getName(application);
    const mainText = `${aliasOrName}${getDomain(application) ? `@${getDomain(application)}` : ""}`;
    const subText  = getVersion(application);
    const iconUrl  = getIcon(application);
    return _createGenericItemDiv(uuid, mainText, subText, iconUrl, "apps");
  }

  removeItem(a) {
    const id = getId(a);
    this.list = (this.list ?? []).filter(el => getId(el) !== id);
  }

  displayItem(a) {
    const div = this.createApplicationDiv(a);
    const del = div.querySelector(".item-delete-btn");
    if (this.ondeleteitem) {
      del.addEventListener('click', () => {
        div.parentNode?.removeChild(div);
        this.ondeleteitem(a);
      });
    } else {
      del.style.display = "none";
    }
    return div;
  }

  filter(a) {
    const f = (this.filter_ ?? "").toUpperCase();
    return (getName(a) || "").toUpperCase().includes(f) || (getAlias(a) || "").toUpperCase().includes(f);
  }

  sortItems() {
    return (this.list ?? []).sort((a, b) => (getName(a) || "").localeCompare(getName(b) || ""));
  }
}
customElements.define('globular-searchable-application-list', SearchableApplicationList);

/* -----------------------------------------------------------------------------
 * Roles
 * -------------------------------------------------------------------------- */
export class SearchableRoleList extends SearchableList {
  constructor(title, list, ondeleterole, onaddrole) {
    const onadd = async () => {
      await _setupAddPanelLogic(
        this,
        "add-list-role-panel",
        "Add Role",
        "Search Role",
        async () => {
          const { items } = await listRoles({ pageSize: 1000 });
          return items ?? [];
        },
        (all, value) => {
          const V = value.toUpperCase();
          return all.filter(r =>
            getName(r).toUpperCase().includes(V) || getId(r).toUpperCase().includes(V)
          );
        },
        (role) => this.createRoleDiv(role)
      );
    };
    super(title, list, ondeleterole, onaddrole, onadd);
  }

  createRoleDiv(role) {
    const id = getId(role);
    const uuid = `_${id}`;
    const mainText = `${id}${getDomain(role) ? `@${getDomain(role)}` : ""}`;
    return _createGenericItemDiv(uuid, mainText, "", "", "notification:enhanced-encryption");
  }

  removeItem(r) {
    const id = getId(r);
    this.list = (this.list ?? []).filter(el => getId(el) !== id);
  }

  displayItem(r) {
    const div = this.createRoleDiv(r);
    const del = div.querySelector(".item-delete-btn");
    if (this.ondeleteitem) {
      del.addEventListener('click', () => {
        div.parentNode?.removeChild(div);
        this.ondeleteitem(r);
      });
    } else {
      del.style.display = "none";
    }
    return div;
  }

  filter(r) {
    const f = (this.filter_ ?? "").toUpperCase();
    return getName(r).toUpperCase().includes(f) || getId(r).toUpperCase().includes(f);
  }

  sortItems() {
    return (this.list ?? []).sort((a, b) => getName(a).localeCompare(getName(b)));
  }
}
customElements.define('globular-searchable-role-list', SearchableRoleList);

/* -----------------------------------------------------------------------------
 * Groups
 * -------------------------------------------------------------------------- */
export class SearchableGroupList extends SearchableList {
  constructor(title, list, ondeletegroup, onaddgroup) {
    const onadd = async () => {
      await _setupAddPanelLogic(
        this,
        "add-list-group-panel",
        "Add Group",
        "Search Group",
        async () => {
          const { items } = await listGroups({ pageSize: 1000 });
          return items ?? [];
        },
        (all, value) => {
          const V = value.toUpperCase();
          return all.filter(g =>
            getName(g).toUpperCase().includes(V) || getId(g).toUpperCase().includes(V)
          );
        },
        (group) => this.createGroupDiv(group)
      );
    };
    super(title, list, ondeletegroup, onaddgroup, onadd);
  }

  createGroupDiv(group) {
    const id = getId(group);
    const uuid = `_${id}`;
    const mainText = `${id}${getDomain(group) ? `@${getDomain(group)}` : ""}`;
    return _createGenericItemDiv(uuid, mainText, "", "", "social:people");
  }

  removeItem(g) {
    const id = getId(g);
    this.list = (this.list ?? []).filter(el => getId(el) !== id);
  }

  displayItem(g) {
    const div = this.createGroupDiv(g);
    const del = div.querySelector(".item-delete-btn");
    if (this.ondeleteitem) {
      del.addEventListener('click', () => {
        div.parentNode?.removeChild(div);
        this.ondeleteitem(g);
      });
    } else {
      del.style.display = "none";
    }
    return div;
  }

  filter(g) {
    const f = (this.filter_ ?? "").toUpperCase();
    return getName(g).toUpperCase().includes(f) || getId(g).toUpperCase().includes(f);
  }

  sortItems() {
    return (this.list ?? []).sort((a, b) => getName(a).localeCompare(getName(b)));
  }
}
customElements.define('globular-searchable-group-list', SearchableGroupList);

/* -----------------------------------------------------------------------------
 * Organizations
 * -------------------------------------------------------------------------- */
export class SearchableOrganizationList extends SearchableList {
  constructor(title, list, ondeleteorganization, onaddorganization) {
    const onadd = async () => {
      await _setupAddPanelLogic(
        this,
        "add-list-organization-panel",
        "Add Organization",
        "Search Organization",
        async () => {
          const { items } = await listOrganizations({ pageSize: 1000 });
          return items ?? [];
        },
        (all, value) => {
          const V = value.toUpperCase();
          return all.filter(o =>
            getName(o).toUpperCase().includes(V) || getId(o).toUpperCase().includes(V)
          );
        },
        (organization) => this.createOrganizationDiv(organization)
      );
    };
    super(title, list, ondeleteorganization, onaddorganization, onadd);
  }

  createOrganizationDiv(organization) {
    const id = getId(organization);
    const uuid = `_${id}`;
    const mainText = `${id}${getDomain(organization) ? `@${getDomain(organization)}` : ""}`;
    return _createGenericItemDiv(uuid, mainText, "", "", "social:domain");
  }

  removeItem(o) {
    const id = getId(o);
    this.list = (this.list ?? []).filter(el => getId(el) !== id);
  }

  displayItem(o) {
    const div = this.createOrganizationDiv(o);
    const del = div.querySelector(".item-delete-btn");
    if (this.ondeleteitem) {
      del.addEventListener('click', () => {
        div.parentNode?.removeChild(div);
        this.ondeleteitem(o);
      });
    } else {
      del.style.display = "none";
    }
    return div;
  }

  filter(o) {
    const f = (this.filter_ ?? "").toUpperCase();
    return getName(o).toUpperCase().includes(f) || getId(o).toUpperCase().includes(f);
  }

  sortItems() {
    return (this.list ?? []).sort((a, b) => getName(a).localeCompare(getName(b)));
  }
}
customElements.define('globular-searchable-organization-list', SearchableOrganizationList);

/* -----------------------------------------------------------------------------
 * Peers (uses new listPeers(): Promise<PeerVM[]>; identity = mac when id missing)
 * -------------------------------------------------------------------------- */
export class SearchablePeerList extends SearchableList {
  constructor(title, list, ondeletepeer, onaddpeer) {
    const onadd = async () => {
      await _setupAddPanelLogic(
        this,
        "add-list-peer-panel",
        "Add Peer",
        "Search Peer",
        async () => {
          const items = await listPeers(); // ← now returns PeerVM[]
          return items ?? [];
        },
        (all, value) => {
          const V = value.toUpperCase();
          return all.filter(p =>
            (getHostname(p) || "").toUpperCase().includes(V) ||
            (getMac(p) || "").toUpperCase().includes(V)
          );
        },
        (peer) => this.createPeerDiv(peer),
        "text"
      );
    };
    super(title, list, ondeletepeer, onaddpeer, onadd);
  }

  createPeerDiv(peer) {
    const key = getPeerKey(peer);
    const uuid = `_${key}`;
    const host = getHostname(peer);
    const dom  = getDomain(peer);
    const mainText = `${host}${dom ? `.${dom}` : ""}`;
    const subText  = getMac(peer) ? `(${getMac(peer)})` : "";
    return _createGenericItemDiv(uuid, mainText, subText, "", "hardware:computer");
  }

  removeItem(p) {
    const key = getPeerKey(p);
    this.list = (this.list ?? []).filter(el => (getPeerKey(el)) !== key);
  }

  displayItem(p) {
    const div = this.createPeerDiv(p);
    const del = div.querySelector(".item-delete-btn");
    if (this.ondeleteitem) {
      del.addEventListener('click', () => {
        div.parentNode?.removeChild(div);
        this.ondeleteitem(p);
      });
    } else {
      del.style.display = "none";
    }
    return div;
  }

  filter(p) {
    const f = (this.filter_ ?? "").toUpperCase();
    return (getHostname(p) || "").toUpperCase().includes(f) || (getMac(p) || "").toUpperCase().includes(f);
  }

  sortItems() {
    return (this.list ?? []).sort((a, b) => (getHostname(a) || "").localeCompare(getHostname(b) || ""));
  }
}
customElements.define('globular-searchable-peer-list', SearchablePeerList);
