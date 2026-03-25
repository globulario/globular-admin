import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  setToken,
  logout,
  restoreSession,
  getToken,
  metadata,
  clearToken,
} from "./../src/core/auth";

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  clearToken();
});

afterEach(() => {
  clearToken();
  sessionStorage.clear();
  vi.useRealTimers();
});

describe("auth token lifecycle", () => {
  it("setToken writes to sessionStorage", () => {
    setToken("abc");
    expect(sessionStorage.getItem("__globular_token__")).toBe("abc");
  });

  it("logout clears session and local cache", () => {
    setToken("abc");
    logout();
    expect(sessionStorage.getItem("__globular_token__")).toBeNull();
    expect(getToken()).toBeUndefined();
  });

  it("restoreSession loads token from storage", () => {
    sessionStorage.setItem("__globular_token__", "abc");
    restoreSession();
    expect(getToken()).toBe("abc");
  });

  it("metadata returns Bearer header", () => {
    setToken("abc");
    expect(metadata()).toEqual({ authorization: "Bearer abc" });
  });
});
