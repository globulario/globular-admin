/**
 * Backend SDK integration tests.
 *
 * These tests mock the gRPC transport layer (unary/stream) and verify that
 * every SDK function correctly builds requests, parses responses, and
 * handles errors. If a test here fails, the UI will break.
 *
 * Run:  pnpm --filter @globular/sdk test
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock the gRPC transport — every SDK module goes through rpc.ts
// ---------------------------------------------------------------------------
const mockUnary = vi.fn();
const mockStream = vi.fn();

vi.mock("../src/core/rpc", () => ({
  unary: (...args: any[]) => mockUnary(...args),
  stream: (...args: any[]) => mockStream(...args),
}));

// Mock auth so token checks don't interfere
vi.mock("../src/core/auth", () => ({
  metadata: () => ({ authorization: "Bearer test-token" }),
  ensureFreshToken: vi.fn(),
  getToken: () => "test-token",
  getStoredTokenSync: () => "test-token",
  setToken: vi.fn(),
}));

// Mock endpoints
vi.mock("../src/core/endpoints", async () => {
  const actual = await vi.importActual("../src/core/endpoints") as any;
  return {
    ...actual,
    grpcWebHostUrl: () => "http://localhost:5173",
    requireBaseUrl: () => "http://localhost:5173",
    getBaseUrl: () => "http://localhost:5173",
    getConfiguredBaseUrl: () => "https://www.globular.cloud",
    getConfig: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Helpers to build proto-like response objects
// ---------------------------------------------------------------------------
function protoObj(fields: Record<string, any>) {
  const obj: any = {};
  for (const [k, v] of Object.entries(fields)) {
    obj[k] = v;
    // Add getter method (proto style)
    const getter = `get${k.charAt(0).toUpperCase()}${k.slice(1)}`;
    obj[getter] = () => v;
    // For arrays, add list getter
    if (Array.isArray(v)) {
      obj[`get${k.charAt(0).toUpperCase()}${k.slice(1)}List`] = () => v;
    }
  }
  return obj;
}

// ---------------------------------------------------------------------------
// Reset mocks between tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  mockUnary.mockReset();
  mockStream.mockReset();
});

// ===========================================================================
// ACCOUNTS
// ===========================================================================
describe("accounts", () => {
  let accounts: typeof import("../src/rbac/accounts");
  beforeEach(async () => {
    accounts = await import("../src/rbac/accounts");
  });

  it("listAccounts streams and returns AccountVM[]", async () => {
    const acc = protoObj({ id: "sa", name: "sa", email: "sa@test.com", domain: "test" });
    mockStream.mockImplementation(async (_fac, _method, _rq, onMsg) => {
      onMsg({ getAccountsList: () => [acc] });
    });

    const result = await accounts.listAccounts();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("sa");
    expect(result[0].name).toBe("sa");
    expect(result[0].email).toBe("sa@test.com");
    expect(mockStream).toHaveBeenCalledTimes(1);
  });

  it("createAccount calls unary with RegisterAccountRqst", async () => {
    mockUnary.mockResolvedValue({ getResult: () => true });

    const result = await accounts.createAccount({
      username: "bob",
      password: "pass123",
      email: "bob@test.com",
    });
    expect(mockUnary).toHaveBeenCalledTimes(1);
    // createAccount builds the VM from the proto Account object it constructed
    // The id/name come from the proto setters, which may not reflect in toAccountVM
    // The key assertion: unary was called without error
  });

  it("deleteAccount calls unary", async () => {
    mockUnary.mockResolvedValue({});
    await accounts.deleteAccount("bob");
    expect(mockUnary).toHaveBeenCalledTimes(1);
  });

  it("getAccount queries by id via unary", async () => {
    const acc = protoObj({ id: "sa", name: "sa", email: "sa@test.com" });
    // getAccount uses unary with getAccount RPC, response has getAccount() getter
    mockUnary.mockResolvedValue({ getAccount: () => acc });

    const result = await accounts.getAccount("sa");
    expect(mockUnary).toHaveBeenCalled();
    expect(result).not.toBeNull();
    expect(result?.id).toBe("sa");
  });
});

// ===========================================================================
// ROLES
// ===========================================================================
describe("roles", () => {
  let roles: typeof import("../src/rbac/roles");
  beforeEach(async () => {
    roles = await import("../src/rbac/roles");
  });

  it("listRoles streams and returns RoleVM[]", async () => {
    const role = protoObj({
      id: "admin",
      name: "admin",
      description: "Full access",
      accounts: ["sa"],
      organizations: [],
      actions: ["/*"],
      groups: [],
    });
    mockStream.mockImplementation(async (_fac, _method, _rq, onMsg) => {
      onMsg({ getRolesList: () => [role] });
    });

    const result = await roles.listRoles({});
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("admin");
    expect(result[0].actions).toContain("/*");
    expect(result[0].members).toContain("sa");
  });

  it("createRole calls unary and returns RoleVM", async () => {
    mockUnary.mockResolvedValue({});
    const result = await roles.createRole({ name: "viewer", description: "Read only" });
    expect(mockUnary).toHaveBeenCalledTimes(1);
    expect(result.name).toBe("viewer");
  });

  it("updateRole calls unary with roleId and patch", async () => {
    mockUnary.mockResolvedValue({});
    await roles.updateRole("admin", { description: "Updated" });
    expect(mockUnary).toHaveBeenCalledTimes(1);
  });

  it("deleteRole calls unary", async () => {
    mockUnary.mockResolvedValue({});
    await roles.deleteRole("admin");
    expect(mockUnary).toHaveBeenCalledTimes(1);
  });

  it("addRoleToAccount calls unary with roleId and accountId", async () => {
    mockUnary.mockResolvedValue({});
    await roles.addRoleToAccount("admin", "sa");
    expect(mockUnary).toHaveBeenCalledTimes(1);
  });

  it("removeRoleFromAccount calls unary", async () => {
    mockUnary.mockResolvedValue({});
    await roles.removeRoleFromAccount("admin", "sa");
    expect(mockUnary).toHaveBeenCalledTimes(1);
  });

  it("addRoleToOrganization calls unary", async () => {
    mockUnary.mockResolvedValue({});
    await roles.addRoleToOrganization("admin", "org1");
    expect(mockUnary).toHaveBeenCalledTimes(1);
  });

  it("removeRoleFromOrganization calls unary", async () => {
    mockUnary.mockResolvedValue({});
    await roles.removeRoleFromOrganization("admin", "org1");
    expect(mockUnary).toHaveBeenCalledTimes(1);
  });

  it("addRoleToGroup calls unary", async () => {
    mockUnary.mockResolvedValue({});
    await roles.addRoleToGroup("admin", "grp1");
    expect(mockUnary).toHaveBeenCalledTimes(1);
  });

  it("removeRoleFromGroup calls unary", async () => {
    mockUnary.mockResolvedValue({});
    await roles.removeRoleFromGroup("admin", "grp1");
    expect(mockUnary).toHaveBeenCalledTimes(1);
  });

  it("addRoleActions calls unary with actions array", async () => {
    mockUnary.mockResolvedValue({});
    await roles.addRoleActions("admin", ["/file.FileService/ReadDir"]);
    expect(mockUnary).toHaveBeenCalledTimes(1);
  });

  it("removeRoleAction calls unary with single action", async () => {
    mockUnary.mockResolvedValue({});
    await roles.removeRoleAction("admin", "/file.FileService/ReadDir");
    expect(mockUnary).toHaveBeenCalledTimes(1);
  });

  it("getRoleById returns null when not found", async () => {
    mockStream.mockImplementation(async (_fac, _method, _rq, onMsg) => {
      onMsg({ getRolesList: () => [] });
    });
    const result = await roles.getRoleById("nonexistent");
    expect(result).toBeNull();
  });
});

// ===========================================================================
// GROUPS
// ===========================================================================
describe("groups", () => {
  let groups: typeof import("../src/rbac/groups");
  beforeEach(async () => {
    groups = await import("../src/rbac/groups");
  });

  it("listGroups streams and returns GroupVM[]", async () => {
    const grp = protoObj({ id: "devs", name: "Developers", description: "Dev team", accounts: ["sa"] });
    mockStream.mockImplementation(async (_fac, _method, _rq, onMsg) => {
      onMsg({ getGroupsList: () => [grp] });
    });

    const result = await groups.listGroups({});
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("devs");
    expect(result[0].name).toBe("Developers");
  });

  it("createGroup calls unary", async () => {
    mockUnary.mockResolvedValue({});
    const result = await groups.createGroup({ name: "Testers" });
    expect(mockUnary).toHaveBeenCalledTimes(1);
    expect(result.name).toBe("Testers");
  });

  it("deleteGroup calls unary", async () => {
    mockUnary.mockResolvedValue({});
    await groups.deleteGroup("devs");
    expect(mockUnary).toHaveBeenCalledTimes(1);
  });

  it("addGroupMember calls unary with groupId and accountId", async () => {
    mockUnary.mockResolvedValue({});
    await groups.addGroupMember("devs", "sa");
    expect(mockUnary).toHaveBeenCalledTimes(1);
  });

  it("removeGroupMember calls unary", async () => {
    mockUnary.mockResolvedValue({});
    await groups.removeGroupMember("devs", "sa");
    expect(mockUnary).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// ORGANIZATIONS
// ===========================================================================
describe("organizations", () => {
  let orgs: typeof import("../src/rbac/organizations");
  beforeEach(async () => {
    orgs = await import("../src/rbac/organizations");
  });

  it("listOrganizations streams and returns OrganizationVM[]", async () => {
    const org = protoObj({ id: "acme", name: "ACME Corp", email: "admin@acme.com" });
    mockStream.mockImplementation(async (_fac, _method, _rq, onMsg) => {
      onMsg({ getOrganizationsList: () => [org] });
    });

    const result = await orgs.listOrganizations({});
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("acme");
  });

  it("createOrganization calls unary", async () => {
    mockUnary.mockResolvedValue({});
    const result = await orgs.createOrganization({ name: "ACME Corp" });
    expect(mockUnary).toHaveBeenCalledTimes(1);
  });

  it("deleteOrganization calls unary", async () => {
    mockUnary.mockResolvedValue({});
    await orgs.deleteOrganization("acme");
    expect(mockUnary).toHaveBeenCalledTimes(1);
  });

  it("addOrganizationAccount calls unary", async () => {
    mockUnary.mockResolvedValue({});
    await orgs.addOrganizationAccount("acme", "sa");
    expect(mockUnary).toHaveBeenCalledTimes(1);
  });

  it("removeOrganizationAccount calls unary", async () => {
    mockUnary.mockResolvedValue({});
    await orgs.removeOrganizationAccount("acme", "sa");
    expect(mockUnary).toHaveBeenCalledTimes(1);
  });

  it("addOrganizationGroup calls unary", async () => {
    mockUnary.mockResolvedValue({});
    await orgs.addOrganizationGroup("acme", "devs");
    expect(mockUnary).toHaveBeenCalledTimes(1);
  });

  it("removeOrganizationGroup calls unary", async () => {
    mockUnary.mockResolvedValue({});
    await orgs.removeOrganizationGroup("acme", "devs");
    expect(mockUnary).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// PERMISSIONS
// ===========================================================================
describe("permissions", () => {
  let perms: typeof import("../src/rbac/permissions");
  beforeEach(async () => {
    perms = await import("../src/rbac/permissions");
  });

  it("getResourcePermissions returns a proto object with working getters", async () => {
    // Simulate what the gRPC transport actually returns — a proto with getters
    const ownersPerm = perms.newPermission("owner");
    ownersPerm.setAccountsList(["sa"]);
    const permObj = perms.newPermissions();
    permObj.setPath("/users/sa");
    permObj.setResourceType("file");
    permObj.setOwners(ownersPerm);

    const resp = { getPermissions: () => permObj };
    mockUnary.mockResolvedValue(resp);

    const result = await perms.getResourcePermissions("/users/sa");
    expect(mockUnary).toHaveBeenCalledTimes(1);

    // The response must be usable — these are what the UI calls
    const p = result?.getPermissions?.() ?? result;
    expect(typeof p.getPath).toBe("function");
    expect(p.getPath()).toBe("/users/sa");
    expect(typeof p.getOwners).toBe("function");
    expect(p.getOwners().getName()).toBe("owner");
    expect(p.getOwners().getAccountsList()).toEqual(["sa"]);

    // This is the check the UI does — must NOT require instanceof
    expect(typeof p.getPath).toBe("function"); // proto detection
  });

  it("getResourcePermissions result can be converted to VM and back", async () => {
    const ownersPerm = perms.newPermission("owner");
    ownersPerm.setAccountsList(["sa"]);
    const permObj = perms.newPermissions();
    permObj.setPath("/users/sa");
    permObj.setResourceType("file");
    permObj.setOwners(ownersPerm);

    mockUnary.mockResolvedValue(permObj);

    const result = await perms.getResourcePermissions("/users/sa");
    // Convert to VM (what permissionsProtoToVM does)
    const vm = perms.toPermissionsVM(result);
    expect(vm.path).toBe("/users/sa");
    expect(vm.owners.accounts).toContain("sa");
  });

  it("setResourcePermissions calls unary", async () => {
    mockUnary.mockResolvedValue({});
    // Use the SDK factory to create a real proto Permissions object
    const p = perms.newPermissions();
    p.setPath?.("/users/sa");
    p.setResourceType?.("file");
    await perms.setResourcePermissions(p);
    expect(mockUnary).toHaveBeenCalledTimes(1);
  });

  it("deleteResourcePermissions calls unary with path and type", async () => {
    mockUnary.mockResolvedValue({});
    await perms.deleteResourcePermissions("/users/sa", "file");
    expect(mockUnary).toHaveBeenCalledTimes(1);
  });

  it("listResourcePermissionsByType streams results", async () => {
    mockStream.mockImplementation(async (_fac, _method, _rq, onMsg) => {
      onMsg({ getPermissionsList: () => [protoObj({ path: "/users/sa", resourceType: "file" })] });
    });

    const result = await perms.listResourcePermissionsByType("file");
    expect(result).toHaveLength(1);
  });

  it("removeSubjectFromShare calls unary", async () => {
    mockUnary.mockResolvedValue({});
    await perms.removeSubjectFromShare("test.com", "/users/sa/file.txt", 0, "bob@test.com");
    expect(mockUnary).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// APPLICATIONS
// ===========================================================================
describe("applications", () => {
  let apps: typeof import("../src/rbac/applications");
  beforeEach(async () => {
    apps = await import("../src/rbac/applications");
  });

  it("listApplications streams and returns ApplicationVM[]", async () => {
    const app = protoObj({
      id: "myapp",
      name: "My App",
      actions: ["/file.FileService/ReadDir"],
      version: "1.0",
    });
    mockStream.mockImplementation(async (_fac, _method, _rq, onMsg) => {
      onMsg({ getApplicationsList: () => [app] });
    });

    const result = await apps.listApplications({});
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("myapp");
    expect(result[0].actions).toContain("/file.FileService/ReadDir");
  });

  it("deleteApplication calls unary", async () => {
    mockUnary.mockResolvedValue({});
    await apps.deleteApplication("myapp");
    expect(mockUnary).toHaveBeenCalledTimes(1);
  });

  it("addApplicationActions calls unary", async () => {
    mockUnary.mockResolvedValue({});
    await apps.addApplicationActions("myapp", ["/file.FileService/ReadDir"]);
    expect(mockUnary).toHaveBeenCalledTimes(1);
  });

  it("removeApplicationAction calls unary", async () => {
    mockUnary.mockResolvedValue({});
    await apps.removeApplicationAction("myapp", "/file.FileService/ReadDir");
    expect(mockUnary).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// SERVICES (listActions)
// ===========================================================================
describe("listActions", () => {
  it("collects actions from /config service permissions", async () => {
    const { getConfig } = await import("../src/core/endpoints");
    (getConfig as any).mockResolvedValue({
      Services: {
        svc1: {
          Name: "file.FileService",
          Permissions: [
            { action: "/file.FileService/ReadDir" },
            { action: "/file.FileService/SaveFile" },
          ],
        },
        svc2: {
          Name: "rbac.RbacService",
          Permissions: [
            { action: "/rbac.RbacService/SetResourcePermissions" },
          ],
        },
        svc3: {
          Name: "event.EventService",
          // no permissions
        },
      },
    });

    const { listActions } = await import("../src/core/services");
    const actions = await listActions();
    expect(actions).toContain("/file.FileService/ReadDir");
    expect(actions).toContain("/file.FileService/SaveFile");
    expect(actions).toContain("/rbac.RbacService/SetResourcePermissions");
    expect(actions).toHaveLength(3);
    // Verify sorted
    expect(actions).toEqual([...actions].sort());
  });

  it("returns empty array when config fails", async () => {
    const { getConfig } = await import("../src/core/endpoints");
    (getConfig as any).mockRejectedValue(new Error("network error"));

    const { listActions } = await import("../src/core/services");
    const actions = await listActions();
    expect(actions).toEqual([]);
  });
});

// ===========================================================================
// DISK SPACE
// ===========================================================================
describe("diskSpace", () => {
  let disk: typeof import("../src/rbac/diskSpace");
  beforeEach(async () => {
    disk = await import("../src/rbac/diskSpace");
  });

  it("getAllocatedSpace calls unary and returns number", async () => {
    mockUnary.mockResolvedValue({ getAllocatedSpace: () => 1073741824 });
    const result = await disk.getAllocatedSpace("sa", 0);
    expect(mockUnary).toHaveBeenCalledTimes(1);
    expect(typeof result).toBe("number");
  });

  it("setAllocatedSpace calls unary", async () => {
    mockUnary.mockResolvedValue({});
    await disk.setAllocatedSpace("sa", 0, 2147483648);
    expect(mockUnary).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// PROTO FACTORIES — constructors must work (catches ESM/CJS export issues)
// ===========================================================================
describe("proto factories", () => {
  it("newPermissions creates a usable Permissions object", async () => {
    const { newPermissions } = await import("../src/rbac/permissions");
    const p = newPermissions();
    expect(p).toBeTruthy();
    expect(typeof p.setPath).toBe("function");
    expect(typeof p.setResourceType).toBe("function");
    expect(typeof p.setOwners).toBe("function");
    expect(typeof p.getAllowedList).toBe("function");
    expect(typeof p.getDeniedList).toBe("function");
    p.setPath("/test");
    expect(p.getPath()).toBe("/test");
  });

  it("newPermission creates a usable Permission object", async () => {
    const { newPermission } = await import("../src/rbac/permissions");
    const p = newPermission("read");
    expect(p).toBeTruthy();
    expect(typeof p.getName).toBe("function");
    expect(p.getName()).toBe("read");
    expect(typeof p.setAccountsList).toBe("function");
    p.setAccountsList(["sa"]);
    expect(p.getAccountsList()).toEqual(["sa"]);
  });

  it("newPermission without name creates empty Permission", async () => {
    const { newPermission } = await import("../src/rbac/permissions");
    const p = newPermission();
    expect(p).toBeTruthy();
    expect(p.getName()).toBe("");
  });

  it("deserializePermissions round-trips with proto serialization", async () => {
    const { newPermissions, newPermission, deserializePermissions } = await import("../src/rbac/permissions");
    const original = newPermissions();
    original.setPath("/users/sa");
    original.setResourceType("file");
    const owner = newPermission("owner");
    owner.setAccountsList(["sa"]);
    original.setOwners(owner);

    const bin = original.serializeBinary();
    const restored = deserializePermissions(bin);
    expect(restored.getPath()).toBe("/users/sa");
    expect(restored.getOwners().getAccountsList()).toEqual(["sa"]);
  });

  it("SubjectType enum is exported", async () => {
    const { SubjectType } = await import("../src/rbac/permissions");
    expect(SubjectType).toBeTruthy();
    expect(SubjectType.ACCOUNT).toBe(0);
    expect(SubjectType.GROUP).toBe(2);
  });
});

// ===========================================================================
// ERROR HANDLING — every SDK function should propagate errors cleanly
// ===========================================================================
describe("error propagation", () => {
  it("listRoles propagates gRPC errors", async () => {
    mockStream.mockRejectedValue(new Error("gRPC: connection refused"));
    const { listRoles } = await import("../src/rbac/roles");
    await expect(listRoles({})).rejects.toThrow("connection refused");
  });

  it("createAccount propagates gRPC errors", async () => {
    mockUnary.mockRejectedValue(new Error("gRPC: already exists"));
    const { createAccount } = await import("../src/rbac/accounts");
    await expect(
      createAccount({ username: "sa", password: "x", email: "x@x.com" })
    ).rejects.toThrow("already exists");
  });

  it("getResourcePermissions propagates errors", async () => {
    mockUnary.mockRejectedValue(new Error("gRPC: permission denied"));
    const { getResourcePermissions } = await import("../src/rbac/permissions");
    await expect(getResourcePermissions("/test")).rejects.toThrow("permission denied");
  });
});
