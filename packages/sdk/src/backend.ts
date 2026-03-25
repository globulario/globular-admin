// backend/backend.ts
import { EventHub, GetEventClient } from "./event/event";

type OnSubscribe = (uuid: string) => void;
type OnEvent = (data: any) => void;

export class Backend {
  /** Static singleton instance. */
  private static _instance: Backend | null = null;

  /** Static shared EventHub (global bus). */
  public static eventHub: EventHub | null = null;

  /** Mutable getter used by EventHub to fetch a current Event client. */
  private _getEventClient: GetEventClient;

  constructor(getEventClient: GetEventClient) {
    this._getEventClient = getEventClient;
    const hub = new EventHub(() => this._getEventClient());
    Backend.eventHub = hub; // assign to static field
  }

  // -------- Singleton helpers --------
  static init(getEventClient: GetEventClient): Backend {
    this._instance = new Backend(getEventClient);
    return this._instance;
  }

  static instance(): Backend {
    if (!this._instance) {
      throw new Error("Backend not initialized. Call Backend.init(getEventClient) first.");
    }
    return this._instance;
  }

  // -------- Runtime reconfiguration --------
  reconfigure(getEventClient: GetEventClient): void {
    this._getEventClient = getEventClient;
  }

  // -------- Legacy passthroughs --------
  static subscribe(
    name: string,
    onsubscribe: OnSubscribe,
    onevent: OnEvent,
    local = true,
    ref: any = null
  ): void {
    if (!Backend.eventHub) throw new Error("Backend.eventHub not initialized");
    Backend.eventHub.subscribe(name, onsubscribe, onevent, local, ref);
  }

  static unsubscribe(name: string, uuid: string): void {
    if (!Backend.eventHub) return;
    Backend.eventHub.unsubscribe(name, uuid);
  }

  static publish(name: string, data: any, local: boolean): void {
    if (!Backend.eventHub) return;
    Backend.eventHub.publish(name, data, local);
  }
}
