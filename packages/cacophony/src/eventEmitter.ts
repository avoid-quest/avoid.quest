// biome-ignore lint/style/useFilenamingConvention: eventEmitter is a common naming pattern for event emitter classes
type EventMap = Record<string, unknown>;
type EventKey<T extends EventMap> = string & keyof T;
type EventListener<T> = (params: T) => void | Promise<void>;

/**
 * Type-safe event emitter.
 */
export class TypedEventEmitter<T extends EventMap> {
  private listeners: Partial<
    Record<keyof T, Array<{ fn: EventListener<T[keyof T]>; once: boolean }>>
  > = {};

  /**
   * Register event listener.
   * @returns Cleanup function
   * @example
   * const cleanup = emitter.on('play', (playback) => console.log(playback));
   * cleanup(); // Remove listener
   */
  on<K extends EventKey<T>>(eventName: K, fn: EventListener<T[K]>) {
    this.listeners[eventName] = this.listeners[eventName] ?? [];
    const listenerArray = this.listeners[eventName];
    if (listenerArray) {
      listenerArray.push({ fn: fn as EventListener<T[keyof T]>, once: false });
    }
    return () => this.off(eventName, fn);
  }

  /**
   * Register one-time event listener.
   * @returns Cleanup function
   */
  once<K extends EventKey<T>>(eventName: K, fn: EventListener<T[K]>) {
    this.listeners[eventName] = this.listeners[eventName] ?? [];
    const listenerArray = this.listeners[eventName];
    if (listenerArray) {
      listenerArray.push({ fn: fn as EventListener<T[keyof T]>, once: true });
    }
    return () => this.off(eventName, fn);
  }

  /**
   * Remove event listener.
   */
  off<K extends EventKey<T>>(eventName: K, fn: EventListener<T[K]>) {
    const listeners = this.listeners[eventName];
    if (listeners) {
      this.listeners[eventName] = listeners.filter(
        (listener) => listener.fn !== fn
      );
    }
  }

  /**
   * Emit event synchronously.
   */
  emit<K extends EventKey<T>>(eventName: K, params: T[K]) {
    const listeners = this.listeners[eventName];
    if (listeners) {
      for (const listener of listeners) {
        listener.fn(params);
      }
      this.listeners[eventName] = listeners.filter(
        (listener) => !listener.once
      );
    }
  }

  /**
   * Emit event asynchronously with error isolation.
   * Listener errors are logged but don't break other listeners.
   */
  emitAsync<K extends EventKey<T>>(eventName: K, params: T[K]): Promise<void> {
    const listeners = this.listeners[eventName];
    if (listeners) {
      const promises = listeners.map((listener) =>
        Promise.resolve()
          .then(() => listener.fn(params))
          .catch((error) =>
            console.error(`Error in listener for event ${eventName}:`, error)
          )
      );
      this.listeners[eventName] = listeners.filter(
        (listener) => !listener.once
      );
      return Promise.all(promises).then(() => {
        // All promises resolved
      });
    }
    return Promise.resolve();
  }

  /**
   * Remove all event listeners.
   */
  removeAllListeners() {
    this.listeners = {};
  }
}
