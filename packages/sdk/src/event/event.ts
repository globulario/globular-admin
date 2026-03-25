// backend/event.ts
import * as eventGrpc from "globular-web-client/event/event_grpc_web_pb";
import { grpcWebHostUrl, getBaseUrl } from "../core/endpoints"
import * as eventPb from "globular-web-client/event/event_pb";

/** RFC4122 v4-ish (matches behavior of the legacy file). */
function randomUUID(): string {
  const itoh = "0123456789abcdef";
  const s = new Array<string>(36);
  for (let i = 0; i < 36; i++) s[i] = itoh[Math.floor(Math.random() * 0x10)];
  s[8] = s[13] = s[18] = s[23] = "-";
  s[14] = "4";
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  s[19] = itoh[(parseInt(s[19]!, 16) & 0x3) | 0x8];
  return s.join("");
}

type OnSubscribe = (uuid: string) => void;
type OnEvent = (data: any) => void;

type Subscriber = {
  onsubscribe: OnSubscribe;
  onevent: OnEvent;
  local: boolean;
};

/** Simple shape for optional config */
type EventClientOptions = {
  baseUrl?: string
  token?: string | null
}

/**
 * Returns a configured EventServicePromiseClient.
 * - Sends cookies (withCredentials: true)
 * - If a token is provided, adds Authorization/Token headers to every call via interceptors
 */
export function getEventClient(opts: EventClientOptions = {}): eventGrpc.EventServicePromiseClient | undefined {
  const rawBase = opts.baseUrl ?? getBaseUrl()
  if (!rawBase) return undefined
  const base = grpcWebHostUrl(rawBase)
  if (!base) return undefined

  // Minimal options: send cookies for domains using cookie auth
  const options: any = { withCredentials: true }

  // If you use header-based auth for Event RPCs, inject it here.
  // grpc-web supports unary & stream interceptors via options.*Interceptors
  if (opts.token) {
    const injectAuth = (method: any, request: any, metadata: any, invoker: any) => {
      const md = { ...(metadata || {}) }
      // Both headers are common in your codebase; keep both for compatibility.
      md["authorization"] = "Bearer " + opts.token
      md["token"] = opts.token
      return invoker(method, request, md)
    }
    options.unaryInterceptors = [injectAuth]
    options.streamInterceptors = [injectAuth]
  }

  return new eventGrpc.EventServicePromiseClient(base, null, options)
}

export type GetEventClient = () => eventGrpc.EventServicePromiseClient | undefined;

export class EventHub {
  /** Injected accessor that returns the current EventService client (or undefined if not available). */
  private getEventClient: GetEventClient;

  /** Local subscribers indexed by event name, then subscription uuid. */
  private subscribers: Record<string, Record<string, Subscriber>> = {};

  /** Keep refs to owners (for auto-unsubscribe on GC-ish patterns). */
  private refs: Record<string, any> = {};

  /** This client instance UUID (used by Event service). */
  private uuid = randomUUID();

  /** Active stream cancel fn from the underlying grpc-web client (if the client exposes one). */
  private stream: any | null = null;

  /** Handle to KA timeout for reconnection. */
  private keepAliveTimer: number | null = null;

  /** Exponential backoff delay (ms) for reconnects; resets to 1s on successful data. */
  private reconnectDelay = 1_000;

  constructor(getEventClient: GetEventClient) {
    this.getEventClient = getEventClient;
    this.connect();
    this.removeDeletedListeners();
  }

  /** Periodically remove listeners whose ref has been nulled. */
  private removeDeletedListeners(): void {
    setInterval(() => {
      Object.keys(this.refs).forEach((k) => {
        if (this.refs[k] == null) {
          const [name, uuid] = k.split(":");
          this.unSubscribe(name, uuid);
        }
      });
    }, 5000);
  }

  /** Re-subscribe remote topics after reconnect. */
  private reinitRemoteListeners(): void {
    const names = Object.keys(this.subscribers).filter((name) =>
      Object.values(this.subscribers[name]).some((s) => !s.local)
    );
    const client = this.getEventClient();
    if (!client || names.length === 0) return;

    const subscribeNext = () => {
      const name = names.pop();
      if (!name) return;
      const rq = new eventPb.SubscribeRequest();
      rq.setName(name);
      rq.setUuid(this.uuid);
      client
        .subscribe(rq, {})
        .then(() => subscribeNext())
        .catch(() => {
          // swallow; a new connect() will try again later
        });
    };
    subscribeNext();
  }

  /** Schedule a reconnect with the current backoff delay, then increase it. */
  private scheduleReconnect(): void {
    const delay = this.reconnectDelay;
    // Cap at 60s; double each attempt
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 60_000);
    setTimeout(() => this.connect(), delay);
  }

  /** Open/maintain the OnEvent stream. */
  private connect(): void {
    const client = this.getEventClient();
    if (!client) {
      // No base URL yet (e.g. DNS not configured); retry quietly with backoff.
      this.scheduleReconnect();
      return;
    }

    const rq = new eventPb.OnEventRequest();
    rq.setUuid(this.uuid);

    const stream = client.onEvent(rq, {});
    this.stream = stream;
    this.reinitRemoteListeners();

    stream.on("data", (rsp: any) => {
      if (rsp.hasEvt && rsp.hasEvt()) {
        // Successful data — reset backoff
        this.reconnectDelay = 1_000;
        const evt = rsp.getEvt();
        const name: string = evt.getName();
        const bytes: Uint8Array | null = evt.getData();
        let data: any = "";
        if (bytes && bytes.length > 0) {
          const s = new TextDecoder("utf-8").decode(bytes);
          // Try to JSON.parse; fall back to string
          try {
            data = JSON.parse(s);
          } catch {
            data = s;
          }
        }
        this.dispatch(name, data);
      } else if (rsp.hasKa && rsp.hasKa()) {
        // Keep-alive received — reset backoff and arm the dead-stream detector
        this.reconnectDelay = 1_000;
        if (this.keepAliveTimer) {
          clearTimeout(this.keepAliveTimer);
          this.keepAliveTimer = null;
        }
        // if no KA comes back in 25s, assume dead and reconnect
        this.keepAliveTimer = window.setTimeout(() => {
          try {
            stream.cancel && stream.cancel();
          } catch {
            /* noop */
          }
          this.stream = null;
          this.connect();
        }, 25_000);
      }
    });

    stream.on("status", (_status: any) => {
      // ignore non-zero codes; reconnect logic handled by KA timer / end event
    });

    stream.on("error", (_err: any) => {
      // Network / DNS error — back off before retrying
      if (this.keepAliveTimer) {
        clearTimeout(this.keepAliveTimer);
        this.keepAliveTimer = null;
      }
      this.stream = null;
      this.scheduleReconnect();
    });

    stream.on("end", () => {
      // Stream ended; try to reconnect with backoff.
      if (this.keepAliveTimer) {
        clearTimeout(this.keepAliveTimer);
        this.keepAliveTimer = null;
      }
      this.stream = null;
      this.scheduleReconnect();
    });
  }

  /**
   * Subscribe to an event.
   * @param name   event name
   * @param onsubscribe  called with the generated subscription uuid
   * @param onevent      called when event is received
   * @param local        if false, also registers on the server; default true
   * @param ref          an owning object; if ref[name] is later unset/GCed, we auto-unsubscribe
   */
  subscribe(
    name: string,
    onsubscribe: OnSubscribe,
    onevent: OnEvent,
    local = true,
    ref: any = null
  ): void {
    const uuid = randomUUID();

    if (ref) {
      // Avoid duplicate subscription per ref+name
      if ((ref as any)[name]) return;
      this.refs[`${name}:${uuid}`] = ref;
      (ref as any)[name] = uuid;
    }

    if (!this.subscribers[name]) this.subscribers[name] = {};
    this.subscribers[name][uuid] = { onsubscribe, onevent, local };

    const client = this.getEventClient();

    if (!local && client) {
    const rq = new eventPb.SubscribeRequest();
      rq.setName(name);
      rq.setUuid(this.uuid);
      client
        .subscribe(rq, {})
        .then(() => onsubscribe(uuid))
        .catch(() => {
          // If server subscribe fails, keep local to avoid breaking UI flow.
          onsubscribe(uuid);
        });
    } else {
      onsubscribe(uuid);
    }
  }

  /**
   * Unsubscribe from an event.
   */
  unSubscribe(name: string, uuid: string): void {
    const subs = this.subscribers[name];
    if (!subs || !subs[uuid]) return;

    // Clean owning ref if present.
    const refKey = `${name}:${uuid}`;
    const ref = this.refs[refKey];
    if (ref) {
      try {
        delete (ref as any)[name];
      } catch {
        /* noop */
      }
      delete this.refs[refKey];
    }

    const subscription = subs[uuid];
    delete subs[uuid];

    if (Object.keys(subs).length === 0) {
      delete this.subscribers[name];
      // If that was the last remote subscriber for this name, send UnSubscribe.
      if (!subscription.local) {
        const client = this.getEventClient();
        if (client) {
    const rq = new eventPb.UnSubscribeRequest();
          rq.setName(name);
          rq.setUuid(this.uuid);
          client.unSubscribe(rq, {}).catch(() => {
            /* noop */
          });
        }
      }
    }
  }

  /** Alias with lowercase 's' so `Backend.eventHub.unsubscribe(...)` keeps working. */
  unsubscribe(name: string, uuid: string): void {
    this.unSubscribe(name, uuid);
  }

  /**
   * Publish an event.
   * If local === true, dispatch locally only.
   * If local === false, send to server (data auto-JSON-serialized).
   */
  publish(name: string, data: any, local: boolean): void {
    if (local === true) {
      this.dispatch(name, data);
      return;
    }

    const client = this.getEventClient();
    if (!client) {
      // Fallback to local dispatch if no remote available
      this.dispatch(name, data);
      return;
    }

    const rq = new eventPb.PublishRequest();
    const evt = new eventPb.Event();
    evt.setName(name);

    // Always serialize as JSON for symmetry with receiver.
    const str =
      typeof data === "string" ? data : JSON.stringify(data ?? "", null, 0);
    if (str && str.length > 0) {
      evt.setData(new TextEncoder().encode(str));
    }
    rq.setEvt(evt);

    client.publish(rq, {}).catch(() => {
      // Ignore publish failure; local apps can still work
    });
  }

  /** Dispatch locally to all matching subscribers. */
  dispatch(name: string, data: any): void {
    const subs = this.subscribers[name];
    if (!subs) return;
    Object.keys(subs).forEach((uuid) => {
      const s = subs[uuid];
      try {
        s.onevent(data);
      } catch (e) {
        // Don’t let 1 bad handler kill the bus.
        console.error(`event "${name}" handler error:`, e);
      }
    });
  }
}
