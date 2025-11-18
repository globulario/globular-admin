// /backend/rbac/organizations.ts
import { getBaseUrl } from "../core/endpoints";
import { unary, stream } from "../core/rpc";

// ---- Generated stubs (adjust paths if needed) ----
import { ResourceServiceClient } from "globular-web-client/resource/resource_grpc_web_pb";
import * as resource from "globular-web-client/resource/resource_pb";

/** UI-friendly shape for organizations (parallel to Accounts VM) */
export type OrganizationVM = {
  id: string;
  name: string;
  email: string;
  description?: string;
  icon?: string;
  accounts: string[];
  roles?: string[];
  groups: string[];
  domain?: string;
};

// Back-compat alias
export type Organization = OrganizationVM;

type CreateOrgInput = {
  name: string;
  email: string;
  description?: string;
  icon?: string;
  domain?: string;
  roles?: string[];
};

type UpdateOrgInput = Partial<CreateOrgInput>;

// ---- Known RPC + message names (covering minor gen diffs) ----
const SERVICE_METHODS = {
  list: {
    method: ["getOrganizations"],
    rq: ["GetOrganizationsRqst"],
    // GetOrganizationsRsp => repeated Organization organizations = 1
    rspListGetter: ["getOrganizationsList", "getOrganizations", "organizations"],
  },
  create: {
    method: ["createOrganization"],
    rq: ["CreateOrganizationRqst"],
  },
  update: {
    method: ["updateOrganization"],
    rq: ["UpdateOrganizationRqst"],
  },
  delete: {
    method: ["deleteOrganization"],
    rq: ["DeleteOrganizationRqst"],
  },
  addAccount: {
    method: ["addOrganizationAccount"],
    rq: ["AddOrganizationAccountRqst"],
  },
  removeAccount: {
    method: ["removeOrganizationAccount"],
    rq: ["RemoveOrganizationAccountRqst"],
  },
  addGroup: {
    method: ["addOrganizationGroup"],
    rq: ["AddOrganizationGroupRqst"],
  },
  removeGroup: {
    method: ["removeOrganizationGroup"],
    rq: ["RemoveOrganizationGroupRqst"],
  },
} as const;

/* ------------------------------ helpers ------------------------------ */

function clientFactory(): ResourceServiceClient {
  const base = getBaseUrl() ?? "";
  return new ResourceServiceClient(base, null, { withCredentials: true });
}

/** Same header style as accounts.ts (resource service expects { token }) */
async function meta(): Promise<Record<string, string>> {
  try {
    const t = sessionStorage.getItem("__globular_token__");
    return t ? { token: t } : {};
  } catch {
    return {};
  }
}

/** Try multiple names for a request class; fall back to a plain {} if not found. */
function newRq(names: readonly string[]): any {
  for (const n of names) {
    const Ctor: any = (resource as any)[n];
    if (typeof Ctor === "function") return new Ctor();
  }
  return {};
}

/** Pick the first method that exists on the client. */
function pickMethod(c: any, names: readonly string[]): string {
  for (const n of names) if (typeof c[n] === "function") return n;
  return names[0];
}

/** Safe getters from proto (defensive against gen variations) */
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

/** Map proto Organization → OrganizationVM */
function toOrganizationVM(o: any): OrganizationVM {
  return {
    id: getStr(o, ["getId", "id"], ""),
    name: getStr(o, ["getName", "name"], ""),
    email: getStr(o, ["getEmail", "email"], ""),
    description: getStr(o, ["getDescription", "description"], "") || undefined,
    icon: getStr(o, ["getIcon", "icon"], "") || undefined,
    accounts: getArr(o, ["getAccountsList", "accounts", "getAccounts"]) || [],
    groups: getArr(o, ["getGroupsList", "groups", "getGroups"]) || [],
    domain: getStr(o, ["getDomain", "domain"], "") || undefined,
  };
}

/** Build {"$set": {...}} for UpdateOrganizationRqst.values */
function toPartialUpdateValues(patch: UpdateOrgInput) {
  const $set: Record<string, any> = {};
  if (patch.name !== undefined) $set["name"] = patch.name;
  if (patch.email !== undefined) $set["email"] = patch.email;
  if (patch.description !== undefined) $set["description"] = patch.description;
  if (patch.icon !== undefined) $set["icon"] = patch.icon;
  if (patch.domain !== undefined) $set["domain"] = patch.domain;
  return { $set };
}

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

/* ------------------------------ API ------------------------------ */

export async function listOrganizations(opts: BasicListOptions = {}): Promise<ListResult<OrganizationVM>> {
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
  const out: OrganizationVM[] = [];

  const takeFromMsg = (msg: any) => {
    // Normal grpc-web: GetOrganizationsRsp has getOrganizationsList()
    for (const getter of SERVICE_METHODS.list.rspListGetter) {
      const maybe = (typeof msg?.[getter] === "function") ? msg[getter]() : msg?.[getter];
      if (Array.isArray(maybe)) {
        for (const o of maybe) out.push(toOrganizationVM(o));
        return;
      }
    }
    // Defensive single-message fallback
    if (typeof msg?.getId === "function" || msg?.id) {
      out.push(toOrganizationVM(msg));
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

export async function getOrganizationById(id: string): Promise<OrganizationVM | null> {
  const list = await listOrganizations({ _id: id });
  return list[0] || null;
}

export async function createOrganization(input: CreateOrgInput): Promise<OrganizationVM> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.create.rq);

  // Ensure Organization submessage
  let org = (rq.getOrganization?.() ?? null);
  if (!org) {
    const Ctor: any = (resource as any)["Organization"];
    org = Ctor ? new Ctor() : {};
    if (typeof rq.setOrganization === "function") rq.setOrganization(org);
    else rq.organization = org;
  }

  // Fill fields
  const id = input.name.toLowerCase().replace(/\s+/g, "-");
  org.setId?.(id);
  org.setName?.(input.name);
  org.setEmail?.(input.email);
  org.setDomain?.(input.domain);
  if (input.description) org.setDescription?.(input.description);
  if (input.icon) org.setIcon?.(input.icon);
  if (input.domain) org.setDomain?.(input.domain);

  const method = pickMethod(clientFactory(), SERVICE_METHODS.create.method);
  await unary(clientFactory, method, rq, undefined, md);

  return toOrganizationVM(org);
}

export async function updateOrganization(orgId: string, patch: UpdateOrgInput): Promise<void> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.update.rq);
  rq.setOrganizationid?.(orgId);
  rq.setOrganizationId?.(orgId);
  rq.setValues?.(JSON.stringify(toPartialUpdateValues(patch)));

  const method = pickMethod(clientFactory(), SERVICE_METHODS.update.method);
  await unary(clientFactory, method, rq, undefined, md);
}

export async function deleteOrganization(orgId: string): Promise<void> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.delete.rq);
  rq.setOrganization?.(orgId);
  rq.setOrganizationid?.(orgId);
  rq.setOrganizationId?.(orgId);

  const method = pickMethod(clientFactory(), SERVICE_METHODS.delete.method);
  await unary(clientFactory, method, rq, undefined, md);
}

/* -------------------- Members / Groups -------------------- */

export async function addOrganizationAccount(orgId: string, accountId: string): Promise<void> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.addAccount.rq);
  rq.setOrganizationid?.(orgId);
  rq.setOrganizationId?.(orgId);
  rq.setAccountid?.(accountId);
  rq.setAccountId?.(accountId);

  const method = pickMethod(clientFactory(), SERVICE_METHODS.addAccount.method);
  await unary(clientFactory, method, rq, undefined, md);
}

export async function removeOrganizationAccount(orgId: string, accountId: string): Promise<void> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.removeAccount.rq);
  rq.setOrganizationid?.(orgId);
  rq.setOrganizationId?.(orgId);
  rq.setAccountid?.(accountId);
  rq.setAccountId?.(accountId);

  const method = pickMethod(clientFactory(), SERVICE_METHODS.removeAccount.method);
  await unary(clientFactory, method, rq, undefined, md);
}

export async function addOrganizationGroup(orgId: string, groupId: string): Promise<void> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.addGroup.rq);
  rq.setOrganizationid?.(orgId);
  rq.setOrganizationId?.(orgId);
  rq.setGroupid?.(groupId);
  rq.setGroupId?.(groupId);

  const method = pickMethod(clientFactory(), SERVICE_METHODS.addGroup.method);
  await unary(clientFactory, method, rq, undefined, md);
}

export async function removeOrganizationGroup(orgId: string, groupId: string): Promise<void> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.removeGroup.rq);
  rq.setOrganizationid?.(orgId);
  rq.setOrganizationId?.(orgId);
  rq.setGroupid?.(groupId);
  rq.setGroupId?.(groupId);

  const method = pickMethod(clientFactory(), SERVICE_METHODS.removeGroup.method);
  await unary(clientFactory, method, rq, undefined, md);
}
