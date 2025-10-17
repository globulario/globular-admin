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

/* ------------------------------ API ------------------------------ */

export async function listOrganizations(query: object = {}): Promise<OrganizationVM[]> {
  const md = await meta();
  const rq = newRq(SERVICE_METHODS.list.rq);
  rq.setQuery?.(JSON.stringify(query));
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

  return out;
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
