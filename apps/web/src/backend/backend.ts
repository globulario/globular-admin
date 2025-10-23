
// backend/backend.ts
import { EventHub, GetEventClient } from "./event/event";

/** Keep these here so callers don't need to import from ./event just for types */
type OnSubscribe = (uuid: string) => void;
type OnEvent = (data: any) => void;

/**
 * Backend
 * - Holds a single EventHub instance (constructed with a client getter).
 * - Provides a module-level singleton via Backend.init() / Backend.instance().
 * - You can also `new Backend(getEventClient)` yourself if you need a scoped one (e.g., tests).
 */
export class Backend {
  /** Module-level singleton (optional). */
  private static _instance: Backend | null = null;

  /** Public bus for new code. */
  public readonly eventHub: EventHub;

  /** Mutable getter so we can hot-swap the underlying Event client without rebuilding the hub. */
  private _getEventClient: GetEventClient;

  /**
   * Construct a Backend with an EventService getter.
   * The getter is wrapped so you can later call `reconfigure()` and the hub will
   * pick up the new getter on the next reconnect without replacing the hub object.
   */
  constructor(getEventClient: GetEventClient) {
    this._getEventClient = getEventClient;
    // Wrap the getter so the EventHub always reads the *current* one.
    this.eventHub = new EventHub(() => this._getEventClient());
  }

  // -------- Singleton helpers (optional but convenient) --------

  /** Initialize the global Backend singleton. Call this once at app bootstrap. */
  static init(getEventClient: GetEventClient): Backend {
    this._instance = new Backend(getEventClient);
    return this._instance;
  }

  /** Get the global Backend singleton (after init). */
  static instance(): Backend {
    if (!this._instance) {
      throw new Error("Backend not initialized. Call Backend.init(getEventClient) first.");
    }
    return this._instance;
  }

  // -------- Runtime reconfiguration --------

  /**
   * Update how we obtain the EventService client (e.g., after login/domain change).
   * The existing EventHub will use the new getter on its next reconnect cycle.
   * If you need an immediate reconnect, you can briefly drop connectivity (e.g., rotate base URL)
   * or expose a small helper on EventHub to force a reconnect—left out here to keep EventHub unchanged.
   */
  reconfigure(getEventClient: GetEventClient): void {
    this._getEventClient = getEventClient;
  }

  // -------- Legacy pass-throughs (optional) --------
  // These let old code that called Backend.subscribe / publish / unsubscribe keep working.

  subscribe(
    name: string,
    onsubscribe: OnSubscribe,
    onevent: OnEvent,
    local = true,
    ref: any = null
  ): void {
    this.eventHub.subscribe(name, onsubscribe, onevent, local, ref);
  }

  unsubscribe(name: string, uuid: string): void {
    this.eventHub.unsubscribe(name, uuid);
  }

  publish(name: string, data: any, local: boolean): void {
    this.eventHub.publish(name, data, local);
  }
}

/* -----------------------
 * Example usage (either style works):
 *
 * // 1) Singleton style
 * import { Backend } from "./backend";
 * Backend.init(() => makeEventClient()); // at app startup
 * Backend.instance().eventHub.subscribe("__set_dir_event__", cb1, cb2, false, this);
 *
 * // 2) DI style
 * const backend = new Backend(() => makeEventClient());
 * backend.eventHub.publish("__set_dir_event__", { dir: "/x" }, false);
 * ---------------------- */
