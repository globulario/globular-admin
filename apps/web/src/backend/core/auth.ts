import { AuthenticationServiceClient } from "globular-web-client/authentication/authentication_grpc_web_pb";
import * as authpb from "globular-web-client/authentication/authentication_pb";
import { unary } from "./rpc";
import { serviceHost } from "../core/endpoints";

let _token: string | undefined;
let _refreshTimer: number | undefined;

const TOKEN_KEY = "__globular_token__";

// Service + client factory
const SERVICE = "authentication.AuthenticationService";
const factory = () =>
  new AuthenticationServiceClient(serviceHost(), null, { withCredentials: false });

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
function safeClearTimer() {
  if (_refreshTimer) {
    clearTimeout(_refreshTimer);
    _refreshTimer = undefined;
  }
}

function jwtExpMs(token: string): number | undefined {
  try {
    const [, payload] = token.split(".");
    if (!payload) return;
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    if (typeof json.exp === "number") return json.exp * 1000;
  } catch {
    /* ignore */
  }
}

export function tokenExpMs(): number | undefined {
  const t = _token || sessionStorage.getItem(TOKEN_KEY) || undefined;
  if (!t) return;
  return jwtExpMs(t);
}

export function isExpiringSoon(padMs = 60_000): boolean {
  const exp = tokenExpMs();
  if (!exp) return false;
  return Date.now() >= exp - padMs; // within pad window or expired
}

// Ensure a fresh token (rpc.unary will call this before each call)
export async function ensureFreshToken(minTtlMs = 60_000): Promise<void> {
  const t = _token || sessionStorage.getItem(TOKEN_KEY);
  if (!t) return; // not logged in; nothing to do
  const exp = tokenExpMs();
  if (!exp) return;
  if (Date.now() >= exp - minTtlMs) {
    await refresh(); // throws on failure
  }
}

function scheduleRefresh(token: string) {
  safeClearTimer();
  const expMs = jwtExpMs(token);
  if (!expMs) return;

  // Refresh 2 minutes early to avoid clock skew & network jitter
  const refreshAt = expMs - 120_000;
  const delay = Math.max(5_000, refreshAt - Date.now());

  _refreshTimer = window.setTimeout(async () => {
    try {
      // Best-effort auto refresh
      await refresh();
    } catch (e) {
      console.warn("[auth] token refresh failed; keeping current token until it expires.", e);
      // rpc.unary has a just-in-time refresh + retry, so we don't hard-fail here.
    }
  }, delay);
}

// Optional: call this once after restoreSession() at app startup
export function enableVisibilityAutoRefresh(padMs = 120_000) {
  const handler = async () => {
    if (document.visibilityState === "visible") {
      try {
        await ensureFreshToken(padMs);
      } catch {
        /* ignore — rpc layer will still try once more on demand */
      }
    }
  };
  window.addEventListener("visibilitychange", handler);
  return () => window.removeEventListener("visibilitychange", handler);
}

// ---------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------
export function setToken(t?: string) {
  _token = t;
  if (t) sessionStorage.setItem(TOKEN_KEY, t);
  else sessionStorage.removeItem(TOKEN_KEY);
}

export function getToken() {
  return _token;
}

export function metadata(): Record<string, string> {
  const t = _token || sessionStorage.getItem(TOKEN_KEY) || undefined;
  return t ? { authorization: "Bearer " + t } : {};
}

export async function login(username: string, password: string): Promise<string> {
  const rsp = await unary<authpb.AuthenticateRqst, authpb.AuthenticateRsp>(
    factory,
    "authenticate",
    (() => {
      const rq = new authpb.AuthenticateRqst();
      rq.setName(username);
      rq.setPassword(password);
      return rq;
    })(),
    SERVICE
  );

  const token = rsp.getToken();
  _token = token;
  sessionStorage.setItem(TOKEN_KEY, token);
  scheduleRefresh(token);
  return token;
}

export async function refresh(): Promise<string> {
  const rsp = await unary<authpb.RefreshTokenRqst, authpb.RefreshTokenRsp>(
    factory,
    "refreshToken",
    (() => {
      const rq = new authpb.RefreshTokenRqst();
      const token = _token || sessionStorage.getItem(TOKEN_KEY);
      if (!token) throw new Error("No refresh token available");
      rq.setToken(token);
      return rq;
    })(),
    SERVICE
  );

  const token = rsp.getToken();
  _token = token;
  sessionStorage.setItem(TOKEN_KEY, token);
  scheduleRefresh(token);
  return token;
}

// Explicit “force” refresh (same RPC; just a clearer intent for callers)
export async function forceRefresh(): Promise<string> {
  const rsp = await unary<authpb.RefreshTokenRqst, authpb.RefreshTokenRsp>(
    factory,
    "refreshToken",
    (() => {
      const rq = new authpb.RefreshTokenRqst();
      const token = _token || sessionStorage.getItem(TOKEN_KEY) || undefined;
      if (!token) throw new Error("No token available to refresh");
      rq.setToken(token);
      return rq;
    })(),
    SERVICE
  );

  const token = rsp.getToken();
  if (!token) throw new Error("Refresh returned no token");
  _token = token;
  sessionStorage.setItem(TOKEN_KEY, token);
  scheduleRefresh(token);
  return token;
}

export function restoreSession() {
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (token) {
    _token = token;           // ✅ keep local cache in sync
    scheduleRefresh(token);
  }
}

export function logout() {
  safeClearTimer();
  _token = undefined;         // ✅ clear local cache
  sessionStorage.removeItem(TOKEN_KEY);
}

/* --------------------------------------------------------------------
 * Password management
 * ------------------------------------------------------------------*/

/**
 * Change a user's password (server expects accountId, oldPassword, newPassword).
 * currentPassword can be "" when operator is 'sa'.
 */
export async function setPassword(
  accountId: string,
  currentPassword: string,
  newPassword: string
): Promise<authpb.SetPasswordResponse> {
  const md = metadata();
  const rsp = await unary<authpb.SetPasswordRequest, authpb.SetPasswordResponse>(
    factory,
    "setPassword",
    (() => {
      const rq = new authpb.SetPasswordRequest();
      // Cover common codegen variants:
      (rq as any).setAccountid?.(accountId);
      (rq as any).setAccountId?.(accountId);
      (rq as any).setOldpassword?.(currentPassword);
      (rq as any).setOldPassword?.(currentPassword);
      (rq as any).setNewpassword?.(newPassword);
      (rq as any).setNewPassword?.(newPassword);
      return rq;
    })(),
    SERVICE,
    md
  );
  return rsp;
}

/**
 * Set the root password (server expects oldPassword, newPassword).
 * oldPassword may be "" when operator is 'sa' per your rules.
 */
export async function setRootPassword(
  oldPassword: string,
  newPassword: string
): Promise<authpb.SetRootPasswordResponse> {
  const md = metadata();
  const rsp = await unary<
    authpb.SetRootPasswordRequest,
    authpb.SetRootPasswordResponse
  >(
    factory,
    "setRootPassword",
    (() => {
      const rq = new authpb.SetRootPasswordRequest();
      (rq as any).setOldpassword?.(oldPassword);
      (rq as any).setOldPassword?.(oldPassword);
      (rq as any).setNewpassword?.(newPassword);
      (rq as any).setNewPassword?.(newPassword);
      return rq;
    })(),
    SERVICE,
    md
  );
  return rsp;
}
