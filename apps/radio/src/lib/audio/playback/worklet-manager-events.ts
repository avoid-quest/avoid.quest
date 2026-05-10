type EventCallback<T = unknown> = (payload: T) => void;

class WorkletEventEmitter {
  private readonly listeners = new Map<string, Set<EventCallback>>();

  on<T>(event: string, callback: EventCallback<T>): void {
    const existing = this.listeners.get(event);
    if (existing) {
      existing.add(callback as EventCallback);
    } else {
      this.listeners.set(event, new Set([callback as EventCallback]));
    }
  }

  off<T>(event: string, callback: EventCallback<T>): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.delete(callback as EventCallback);
      if (callbacks.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  emit<T>(event: string, payload: T): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback(payload);
        } catch (error) {
          console.error(
            `[WorkletEventEmitter] Error in listener for "${event}" (${callbacks.size} listeners):`,
            error
          );
        }
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

export type { EventCallback };
export { WorkletEventEmitter };
