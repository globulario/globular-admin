import { AuthenticationServiceClient } from "globular-web-client/authentication/authentication_grpc_web_pb";
import * as authpb from "globular-web-client/authentication/authentication_pb";
import { unary } from "./rpc";
import { serviceHost } from '../core/endpoints';

let _token: string | undefined;
let _refreshTimer: number | undefined;

const TOKEN_KEY = "__globular_token__";

// Service + client factory
const SERVICE = "authentication.AuthenticationService"
const factory = () =>
  new AuthenticationServiceClient(serviceHost(), null, { withCredentials: false })

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

function scheduleRefresh(token: string) {
  safeClearTimer();
  const expMs = jwtExpMs(token);
  if (!expMs) return;
  const refreshAt = expMs - 30_000; // refresh 30s before expiry
  const delay = Math.max(5_000, refreshAt - Date.now());

  _refreshTimer = window.setTimeout(async () => {
    try {
      await refresh();
    } catch {
      console.warn("Token refresh failed; keeping current token until it expires.");
    }
  }, delay);
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
  const m: Record<string, string> = {};
  if (_token) m["authorization"] = "Bearer " + _token;
  return m;
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
  _token = token

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
      const token  = _token || sessionStorage.getItem(TOKEN_KEY);
      
      if (!token) throw new Error("No refresh token available");

      rq.setToken(token);
      return rq;
    })(),
    SERVICE
  );

  const token = rsp.getToken();
  _token = token

  sessionStorage.setItem(TOKEN_KEY, token);

  // Reset the refresh timer
  scheduleRefresh(token);

  return token;
}

// --- replace your current forceRefresh with this ---
export async function forceRefresh(): Promise<string> {
  // Same as refresh(), but kept as an explicit API for callers that want to force it.
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
    scheduleRefresh(token);
  }
}

export function logout() {
  safeClearTimer();
  sessionStorage.removeItem(TOKEN_KEY);
}

