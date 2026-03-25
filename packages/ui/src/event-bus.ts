// Lightweight in-process event bus for component communication.
// Components use this instead of importing Backend.eventHub from @globular/sdk.
//
// At app boot, initGlobularApp() bridges this to the real SDK eventHub so
// events published here also reach the server when needed.

type Callback = (data: any) => void
type OnSubscribe = (uuid: string) => void

let idCounter = 0
function nextId(): string { return `evt_${++idCounter}_${Date.now()}` }

interface Subscriber {
  callback: Callback
  uuid: string
}

class EventBus {
  private subs: Record<string, Record<string, Subscriber>> = {}

  subscribe(name: string, onsubscribe: OnSubscribe, callback: Callback): void {
    const uuid = nextId()
    if (!this.subs[name]) this.subs[name] = {}
    this.subs[name][uuid] = { callback, uuid }
    onsubscribe(uuid)
  }

  unsubscribe(name: string, uuid: string): void {
    if (this.subs[name]) {
      delete this.subs[name][uuid]
    }
  }

  // Alias for backward compat
  unSubscribe(name: string, uuid: string): void {
    this.unsubscribe(name, uuid)
  }

  publish(name: string, data: any, _local?: boolean): void {
    const subs = this.subs[name]
    if (!subs) return
    for (const uuid of Object.keys(subs)) {
      try { subs[uuid].callback(data) } catch (e) { console.error(`EventBus [${name}]:`, e) }
    }
  }

  dispatch(name: string, data: any): void {
    this.publish(name, data, true)
  }
}

// Singleton — shared across all components
export const eventBus = new EventBus()
export type { EventBus }
