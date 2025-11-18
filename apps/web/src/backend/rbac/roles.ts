// /backend/rbac/roles.ts
import { getBaseUrl } from "../core/endpoints";
import { unary, stream } from "../core/rpc";

// ---- Generated stubs ----
import { ResourceServiceClient } from "globular-web-client/resource/resource_grpc_web_pb";
import * as resource from "globular-web-client/resource/resource_pb";

/** UI-friendly shape for roles */
export type RoleVM = {
  id: string;
  name: string;
  description?: string;
  domain?: string;
  members: string[];        // accounts
  organizations: string[];  // orgs
  actions: string[];
  groups: string[];         // <-- NEW
};

// Back-compat alias
export type Role = RoleVM;

type CreateRoleInput = {
  name: string;
  description?: string;
  domain?: string;
  actions?: string[];
};

type UpdateRoleInput = Partial<CreateRoleInput>;

type BasicListOptions = string | {
  query?: object | string;
  pageSize?: number;
  page?: number;
  limit?: number;
  offset?: number;
  options?: object | string;
};

type ListResult<T> = T[] & { items: T[]; total: number };
const LIST_OPTION_KEYS = new Set(["query","pageSize","page","limit","offset","options"]);

function normalizeListOptions(input?: BasicListOptions) {
  if (input == null) return {};
  if (typeof input === "string") return { query: input };
  const keys = Object.keys(input);
  const hasKnown = keys.some(k => LIST_OPTION_KEYS.has(k));
  return {
    query: hasKnown ? input.query : input,
    pageSize: input.pageSize ?? input.limit,
    page: input.page,
    offset: input.offset,
    options: input.options,
  };
}

function toJsonString(value: any): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return undefined; }
}

function withListResult<T>(items: T[], total = items.length): ListResult<T> {
  const arr: any = items;
  arr.items = items;
  arr.total = total;
  return arr;
}

function buildOptionsPayload(opts: { pageSize?: number; page?: number; offset?: number; options?: any }) {
  if (opts.options !== undefined) return opts.options;
  const payload: any = {};
  if (typeof opts.pageSize === "number" && opts.pageSize > 0) payload.pageSize = opts.pageSize;
  if (typeof opts.page === "number" && opts.page >= 0) payload.page = opts.page;
  if (typeof opts.offset === "number" && opts.offset >= 0) payload.offset = opts.offset;
  return Object.keys(payload).length ? payload : undefined;
}

/* ---------------- known RPC + message names (defensive against gen diffs) --------------- */
const SERVICE_METHODS = {
  list: {
    method: ["getRoles"],
    rq: ["GetRolesRqst"],
    // GetRolesRsp => repeated Role roles = 1
    rspListGetter: ["getRolesList", "getRoles", "roles"],
  },
  create: {
    method: ["createRole"],
    rq: ["CreateRoleRqst"],
  },
  update: {
    method: ["updateRole"],
    rq: ["UpdateRoleRqst"],
  },
  delete: {
    method: ["deleteRole"],
    rq: ["DeleteRoleRqst"],
  },
  // membership (accounts)
  addAccount: {
    method: ["addAccountRole"],
    rq: ["AddAccountRoleRqst"],
  },
  removeAccount: {
    method: ["removeAccountRole"],
    rq: ["RemoveAccountRoleRqst"],
  },
  // membership (organizations)
  addOrganization: {
    method: ["addOrganizationRole"],
    rq: ["AddOrganizationRoleRqst"],
  },
  removeOrganization: {
    method: ["removeOrganizationRole"],
    rq: ["RemoveOrganizationRoleRqst"],
  },
  // actions
  addActions: {
    method: ["addRoleActions"],
    rq: ["AddRoleActionsRqst"],
  },
  removeAction: {
    method: ["removeRoleAction"],
    rq: ["RemoveRoleActionRqst"],
  },
    addGroup: {
    method: ["addGroupRole"],
    rq: ["AddGroupRoleRqst"],
  },
  removeGroup: {
    method: ["removeGroupRole"],
    rq: ["RemoveGroupRoleRqst"],
  },
} as const;

/* ---------------------------------- helpers ---------------------------------- */

function clientFactory(): ResourceServiceClient {
  const base = getBaseUrl() ?? "";
  return new ResourceServiceClient(base, null, { withCredentials: true });
}

/** Same token header convention used elsewhere */
async function meta(): Promise<Record<string, string>> {
  try {
    const t = sessionStorage.getItem("__globular_token__");
    return t ? { token: t } : {};
  } catch {
    return {};
  }
}

/** Try multiple names for a request class; fallback to {} */
function newRq(names: readonly string[]): any {
  for (const n of names) {
    const Ctor: any = (resource as any)[n];
    if (typeof Ctor === "function") return new Ctor();
  }
  return {};
}

/** Pick the first client method that exists */
function pickMethod(c: any, names: readonly string[]): string {
  for (const n of names) if (typeof c[n] === "function") return n;
  return names[0];
}

/** Safe getters from proto (handles minor gen variations) */
const getStr = (obj: any, names: string[], alt?: any) => {
  for (const n of names) {
    const fn = obj?.[n];
    if (typeof fn === "function") return String(fn.call(obj));
    if (n in (obj || {})) return String(obj[n]);
  }
  return alt === undefined ? "" : String(alt);
};
const getArr = (obj: any, names: string[]): string[] => {
  for (const n of names) {
    const fn = obj?.[n];
    const v = typeof fn === "function" ? fn.call(obj) : obj?.[n];
    if (Array.isArray(v)) return v.map(String);
  }
  return [];
};

/** Map proto Role → RoleVM */
function toRoleVM(r: any): RoleVM {
  return {
    id: getStr(r, ["getId", "id"], ""),
    name: getStr(r, ["getName", "name"], ""),
    description: getStr(r, ["getDescription", "description"], "") || undefined,
    domain: getStr(r, ["getDomain", "domain"], "") || undefined,
    members: getArr(r, ["getAccountsList", "accounts", "getAccounts"]) || [],
    organizations: getArr(r, ["getOrganizationsList", "organizations", "getOrganizations"]) || [],
    actions: getArr(r, ["getActionsList", "actions", "getActions"]) || [],
    groups: getArr(r, ["getGroupsList", "groups", "getGroups"]) || [],  // <-- NEW
  };
}

/** Build {"$set": {...}} for UpdateRoleRqst.values */
function toPartialUpdateValues(patch: UpdateRoleInput) {
  const $set: Record<string, any> = {};
  if (patch.name !== undefined) $set["name"] = patch.name;
  if (patch.description !== undefined) $set["description"] = patch.description;
  if (patch.domain !== undefined) $set["domain"] = patch.domain;
  // actions are managed via add/remove endpoints — not in $set by default
  return { $set };
}

/* ----------------------------------- API ----------------------------------- */

export async function listRoles(opts: BasicListOptions = {}): Promise<ListResult<RoleVM>> {
  const normalized = normalizeListOptions(opts);
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.list.rq);
  const queryString = toJsonString(normalized.query);
  if (queryString) rq.setQuery?.(queryString);
  const optPayload = buildOptionsPayload(normalized);
  const optionsString = toJsonString(optPayload);
  if (optionsString && typeof (rq as any).setOptions === "function") {
    (rq as any).setOptions(optionsString);
  }
  const out: RoleVM[] = [];

  const takeFromMsg = (msg: any) => {
    for (const getter of SERVICE_METHODS.list.rspListGetter) {
      const maybe = (typeof msg?.[getter] === "function") ? msg[getter]() : msg?.[getter];
      if (Array.isArray(maybe)) {
        for (const r of maybe) out.push(toRoleVM(r));
        return;
      }
    }
    // Defensive fallback (single object)
    if (typeof msg?.getId === "function" || msg?.id) {
      out.push(toRoleVM(msg));
    }
  };

  const SERVICE_NAME = "resource.ResourceService";
  await stream(
    clientFactory,
    pickMethod(clientFactory(), SERVICE_METHODS.list.method),
    rq,
    (m: any) => takeFromMsg(m),
    SERVICE_NAME
  );

  const total = out.length;
  const limit = typeof normalized.pageSize === "number" && normalized.pageSize > 0 ? normalized.pageSize : undefined;
  let items = out;
  if (limit !== undefined) {
    const start = typeof normalized.offset === "number" ? Math.max(0, normalized.offset)
      : (typeof normalized.page === "number" && normalized.page >= 0 ? normalized.page * limit : 0);
    items = out.slice(start, start + limit);
  }

  return withListResult(items, total);
}

export async function getRoleById(id: string): Promise<RoleVM | null> {
  // depending on server, id key might be _id or id
  const list = await listRoles({ $or: [{ _id: id }, { id }] });
  return list[0] || null;
}

export async function createRole(input: CreateRoleInput): Promise<RoleVM> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.create.rq);

  // Ensure Role submessage
  let role = (rq.getRole?.() ?? null);
  if (!role) {
    const Ctor: any = (resource as any)["Role"];
    role = Ctor ? new Ctor() : {};
    if (typeof rq.setRole === "function") rq.setRole(role);
    else rq.role = role;
  }

  // Fill fields
  const id = input.name.toLowerCase().replace(/\s+/g, "-");
  role.setId?.(id);
  role.setName?.(input.name);
  if (input.description) role.setDescription?.(input.description);
  if (input.domain) role.setDomain?.(input.domain);
  if (Array.isArray(input.actions) && role.setActionsList) {
    role.setActionsList(input.actions);
  }

  const method = pickMethod(clientFactory(), SERVICE_METHODS.create.method);
  await unary(clientFactory, method, rq, undefined, md);

  return toRoleVM(role);
}

export async function updateRole(roleId: string, patch: UpdateRoleInput): Promise<void> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.update.rq);

  // accommodate different field names
  rq.setRoleid?.(roleId);
  rq.setRoleId?.(roleId);
  rq.setId?.(roleId);
  rq.setValues?.(JSON.stringify(toPartialUpdateValues(patch)));

  const method = pickMethod(clientFactory(), SERVICE_METHODS.update.method);
  await unary(clientFactory, method, rq, undefined, md);
}

export async function deleteRole(roleId: string): Promise<void> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.delete.rq);
  rq.setRole?.(roleId);
  rq.setRoleid?.(roleId);
  rq.setRoleId?.(roleId);
  rq.setId?.(roleId);

  const method = pickMethod(clientFactory(), SERVICE_METHODS.delete.method);
  await unary(clientFactory, method, rq, undefined, md);
}

/* -------------------------- Membership: Accounts -------------------------- */

export async function addRoleToAccount(roleId: string, accountId: string): Promise<void> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.addAccount.rq);
  rq.setRoleid?.(roleId);
  rq.setRoleId?.(roleId);
  rq.setAccountid?.(accountId);
  rq.setAccountId?.(accountId);

  const method = pickMethod(clientFactory(), SERVICE_METHODS.addAccount.method);
  await unary(clientFactory, method, rq, undefined, md);
}

export async function removeRoleFromAccount(roleId: string, accountId: string): Promise<void> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.removeAccount.rq);
  rq.setRoleid?.(roleId);
  rq.setRoleId?.(roleId);
  rq.setAccountid?.(accountId);
  rq.setAccountId?.(accountId);

  const method = pickMethod(clientFactory(), SERVICE_METHODS.removeAccount.method);
  await unary(clientFactory, method, rq, undefined, md);
}

/* ----------------------- Membership: Organizations ----------------------- */

export async function addRoleToOrganization(roleId: string, organizationId: string): Promise<void> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.addOrganization.rq);
  rq.setRoleid?.(roleId);
  rq.setRoleId?.(roleId);
  rq.setOrganizationid?.(organizationId);
  rq.setOrganizationId?.(organizationId);

  const method = pickMethod(clientFactory(), SERVICE_METHODS.addOrganization.method);
  await unary(clientFactory, method, rq, undefined, md);
}

export async function removeRoleFromOrganization(roleId: string, organizationId: string): Promise<void> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.removeOrganization.rq);
  rq.setRoleid?.(roleId);
  rq.setRoleId?.(roleId);
  rq.setOrganizationid?.(organizationId);
  rq.setOrganizationId?.(organizationId);

  const method = pickMethod(clientFactory(), SERVICE_METHODS.removeOrganization.method);
  await unary(clientFactory, method, rq, undefined, md);
}

/* ------------------------------- Actions ------------------------------- */

export async function addRoleActions(roleId: string, actions: string[]): Promise<void> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.addActions.rq);
  rq.setRoleid?.(roleId);
  rq.setRoleId?.(roleId);
  // handle list setter variations
  if (typeof rq.setActionsList === "function") rq.setActionsList(actions);
  else rq.actions = actions;

  const method = pickMethod(clientFactory(), SERVICE_METHODS.addActions.method);
  await unary(clientFactory, method, rq, undefined, md);
}

export async function removeRoleAction(roleId: string, action: string): Promise<void> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.removeAction.rq);
  rq.setRoleid?.(roleId);
  rq.setRoleId?.(roleId);
  rq.setAction?.(action);
  rq.action = rq.action ?? action; // fallback

  const method = pickMethod(clientFactory(), SERVICE_METHODS.removeAction.method);
  await unary(clientFactory, method, rq, undefined, md);
}

export async function addRoleToGroup(roleId: string, groupId: string): Promise<void> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.addGroup.rq);
  rq.setRoleid?.(roleId);
  rq.setRoleId?.(roleId);
  rq.setGroupid?.(groupId);
  rq.setGroupId?.(groupId);

  const method = pickMethod(clientFactory(), SERVICE_METHODS.addGroup.method);
  await unary(clientFactory, method, rq, undefined, md);
}

export async function removeRoleFromGroup(roleId: string, groupId: string): Promise<void> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.removeGroup.rq);
  rq.setRoleid?.(roleId);
  rq.setRoleId?.(roleId);
  rq.setGroupid?.(groupId);
  rq.setGroupId?.(groupId);

  const method = pickMethod(clientFactory(), SERVICE_METHODS.removeGroup.method);
  await unary(clientFactory, method, rq, undefined, md);
}
