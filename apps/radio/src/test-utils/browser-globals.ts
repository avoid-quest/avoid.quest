/** Browser APIs used by Base UI that JSDOM does not install on Bun's globals. */
export function browserTestGlobals(window: Window & typeof globalThis) {
  Object.defineProperty(window.Element.prototype, "getAnimations", {
    configurable: true,
    // JSDOM does not animate elements or expose the Web Animations API.
    value: () => [],
  });
  function isWindowAbortSignal(signal: AbortSignal): boolean {
    return signal instanceof window.AbortSignal;
  }
  const { addEventListener } = window.EventTarget.prototype;
  Object.defineProperty(window.EventTarget.prototype, "addEventListener", {
    configurable: true,
    value(
      this: EventTarget,
      type: string,
      callback: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions
    ) {
      // Keep Bun's AbortController native for fetch and audio tests. JSDOM
      // validates signals against its own window, so bridge native cancellation.
      if (
        options &&
        typeof options === "object" &&
        options.signal &&
        !isWindowAbortSignal(options.signal)
      ) {
        const { signal, ...rest } = options;
        if (signal.aborted) {
          return;
        }
        addEventListener.call(this, type, callback, rest);
        signal.addEventListener(
          "abort",
          () => this.removeEventListener(type, callback, rest),
          { once: true }
        );
        return;
      }
      addEventListener.call(this, type, callback, options);
    },
  });
  return {
    CSS: {
      escape: (identifier: string) =>
        identifier.replaceAll(/[^a-zA-Z0-9_-]/g, "\\$&"),
    },
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    DOMRect: window.DOMRect,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
  };
}
