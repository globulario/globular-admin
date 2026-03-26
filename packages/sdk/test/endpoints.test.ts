import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  setBaseUrl,
  requireBaseUrl,
  clearBaseUrl,
  serviceUrl,
  refreshEndpoints,
  serviceSubdomainUrl,
  grpcWebHostUrl,
} from "./../src/core/endpoints";

// Reset fetch mock before each test
beforeEach(() => {
  (globalThis as any).fetch = vi.fn();
});

afterEach(() => {
  clearBaseUrl();
  vi.clearAllMocks();
});

import { getConfiguredBaseUrl } from "./../src/core/endpoints";

describe("endpoints", () => {
  it("normalizes base URL trailing slash", () => {
    setBaseUrl("https://www.globular.cloud/");
    // getConfiguredBaseUrl returns the raw stored value (ignoring dev-mode override)
    expect(getConfiguredBaseUrl()).toBe("https://www.globular.cloud");
  });

  it("serviceUrl fallback uses /serviceId when config not loaded", () => {
    setBaseUrl("https://www.globular.cloud");
    (globalThis as any).fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) }));
    // In test env (happy-dom, hostname=localhost), getBaseUrl() returns page origin.
    // serviceUrl uses requireBaseUrl() which goes through the same path.
    const base = getConfiguredBaseUrl()!;
    const url = serviceUrl("file.FileService", base);
    expect(url).toBe("https://www.globular.cloud/file.FileService");
  });

  it("refreshEndpoints loads /config and maps services", async () => {
    setBaseUrl("https://www.globular.cloud");
    const cfg = {
      Services: {
        svc1: { Name: "file.FileService" },
        svc2: { Name: "authentication.AuthenticationService" },
      },
    };
    (globalThis as any).fetch = vi.fn(async (url: string) => {
      return { ok: true, json: async () => cfg, status: 200 } as any;
    });

    const base = getConfiguredBaseUrl()!;
    await refreshEndpoints(base);
    expect(fetch).toHaveBeenCalledWith("https://www.globular.cloud/config");
    const url = serviceUrl("file.FileService", base);
    expect(url).toBe("https://www.globular.cloud/file.FileService");
  });

  it("serviceSubdomainUrl behavior", () => {
    const base = "https://www.globular.cloud";
    expect(serviceSubdomainUrl("authentication.AuthenticationService", base)).toBe(
      "https://authentication.globular.cloud"
    );
    expect(serviceSubdomainUrl("resource.ResourceService", base)).toBe(
      "https://resource.globular.cloud"
    );
    expect(serviceSubdomainUrl("any", "http://localhost:5174")).toBe("http://localhost:5174");
  });

  it("grpcWebHostUrl strips service path and enforces host-only", () => {
    const base = "https://www.globular.cloud/authentication.AuthenticationService";
    expect(grpcWebHostUrl(base)).toBe("https://www.globular.cloud");
  });
});
