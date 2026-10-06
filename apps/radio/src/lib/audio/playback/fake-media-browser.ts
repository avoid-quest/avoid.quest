export class FakeAudioElement {
  autoplay = false;
  crossOrigin: string | null = null;
  currentTime = 0;
  duration = Number.POSITIVE_INFINITY;
  ended = false;
  error: MediaError | null = null;
  muted = false;
  paused = true;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  preservesPitch = true;
  preload = "";
  readyState = 0;
  volume = 1;
  nativeHlsSupport = "";
  readonly loadSources: string[] = [];
  readonly playPositions: number[] = [];
  #src = "";
  readonly #listeners = new Map<
    string,
    Set<{ listener: EventListener; once: boolean }>
  >();

  get src(): string {
    return this.#src;
  }

  set src(value: string) {
    this.#src = value;
    this.loadSources.push(value);
  }

  addEventListener(
    type: string,
    listener: EventListener,
    options?: AddEventListenerOptions | boolean
  ): void {
    const listeners = this.#listeners.get(type) ?? new Set();
    listeners.add({
      listener,
      once: typeof options === "object" && options.once === true,
    });
    this.#listeners.set(type, listeners);
  }

  canPlayType(type: string): string {
    return type === "application/vnd.apple.mpegurl"
      ? this.nativeHlsSupport
      : "";
  }

  emit(type: string): void {
    if (type === "canplay" || type === "playing") {
      this.readyState = HTMLMediaElement.HAVE_FUTURE_DATA;
      this.ended = false;
    } else if (type === "waiting" || type === "stalled") {
      this.readyState = HTMLMediaElement.HAVE_CURRENT_DATA;
    }
    const event = new Event(type);
    for (const entry of [...(this.#listeners.get(type) ?? [])]) {
      entry.listener.call(this, event);
      if (entry.once) {
        this.#listeners.get(type)?.delete(entry);
      }
    }
  }

  load(): void {
    // Tests drive readiness explicitly.
  }

  pause(): void {
    this.paused = true;
    this.emit("pause");
  }

  play(): Promise<void> {
    this.playPositions.push(this.currentTime);
    this.paused = false;
    return Promise.resolve();
  }

  removeAttribute(name: string): void {
    if (name === "src") {
      this.#src = "";
    }
  }

  removeEventListener(type: string, listener: EventListener): void {
    const listeners = this.#listeners.get(type);
    if (!listeners) {
      return;
    }
    for (const entry of listeners) {
      if (entry.listener === listener) {
        listeners.delete(entry);
      }
    }
  }

  setAttribute(): void {
    // Attribute values are not relevant to these tests.
  }
}

type InstalledBrowser = {
  audio: (index?: number) => FakeAudioElement;
  dispatchNetworkEvent: (type: "offline" | "online") => void;
  restore: () => void;
};

export function installBrowser(): InstalledBrowser {
  const descriptors = new Map(
    ["Audio", "HTMLMediaElement", "MediaError", "navigator"].map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ])
  );
  const originalAddEventListener = globalThis.addEventListener;
  const originalRemoveEventListener = globalThis.removeEventListener;
  const networkListeners = new Map<
    string,
    Set<EventListenerOrEventListenerObject>
  >();
  const elements: FakeAudioElement[] = [];

  Object.defineProperties(globalThis, {
    Audio: {
      configurable: true,
      value: class extends FakeAudioElement {
        constructor() {
          super();
          elements.push(this);
        }
      },
    },
    HTMLMediaElement: {
      configurable: true,
      value: {
        HAVE_CURRENT_DATA: 2,
        HAVE_ENOUGH_DATA: 4,
        HAVE_FUTURE_DATA: 3,
        HAVE_METADATA: 1,
        HAVE_NOTHING: 0,
      },
    },
    MediaError: {
      configurable: true,
      value: {
        MEDIA_ERR_ABORTED: 1,
        MEDIA_ERR_DECODE: 3,
        MEDIA_ERR_NETWORK: 2,
        MEDIA_ERR_SRC_NOT_SUPPORTED: 4,
      },
    },
    navigator: { configurable: true, value: { onLine: true } },
  });
  globalThis.addEventListener = (
    type: string,
    listener: EventListenerOrEventListenerObject
  ) => {
    const listeners = networkListeners.get(type) ?? new Set();
    listeners.add(listener);
    networkListeners.set(type, listeners);
  };
  globalThis.removeEventListener = (
    type: string,
    listener: EventListenerOrEventListenerObject
  ) => {
    networkListeners.get(type)?.delete(listener);
  };

  return {
    audio: (index = elements.length - 1) => {
      const audio = elements[index];
      if (!audio) {
        throw new Error("Audio element was not created");
      }
      return audio;
    },
    dispatchNetworkEvent: (type) => {
      Object.defineProperty(globalThis.navigator, "onLine", {
        configurable: true,
        value: type === "online",
      });
      const event = new Event(type);
      for (const listener of networkListeners.get(type) ?? []) {
        if (typeof listener === "function") {
          listener.call(globalThis, event);
        } else {
          listener.handleEvent(event);
        }
      }
    },
    restore: () => {
      globalThis.addEventListener = originalAddEventListener;
      globalThis.removeEventListener = originalRemoveEventListener;
      for (const [name, descriptor] of descriptors) {
        if (descriptor) {
          Object.defineProperty(globalThis, name, descriptor);
        } else {
          Reflect.deleteProperty(globalThis, name);
        }
      }
    },
  };
}
