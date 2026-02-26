import { vi } from "vitest";

// atob/btoa for jwt parsing
if (!(globalThis as any).atob) {
  (globalThis as any).atob = (b64: string) => Buffer.from(b64, "base64").toString("binary");
}
if (!(globalThis as any).btoa) {
  (globalThis as any).btoa = (s: string) => Buffer.from(s, "binary").toString("base64");
}

// default fetch mock (override per-test as needed)
if (!(globalThis as any).fetch) {
  (globalThis as any).fetch = vi.fn();
}
