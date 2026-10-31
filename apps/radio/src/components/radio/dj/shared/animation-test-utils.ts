import { spyOn } from "bun:test";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import { browserTestGlobals } from "@/test-utils/browser-globals";

/** Deterministic DOM and animation clock for transport and meter regressions. */
export function installAnimationTestEnvironment() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    pretendToBeVisual: true,
    url: "https://radio.test",
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: () => undefined,
  });
  class ObserverStub {
    disconnect() {
      /* jsdom does not perform layout. */
    }
    observe() {
      /* jsdom does not perform layout. */
    }
    unobserve() {
      /* jsdom does not perform layout. */
    }
  }
  Object.defineProperty(dom.window, "matchMedia", {
    value: (query: string) => ({
      addEventListener: () => undefined,
      addListener: () => undefined,
      matches: false,
      media: query,
      removeEventListener: () => undefined,
      removeListener: () => undefined,
    }),
  });
  let now = 0;
  let nextFrame = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    ...browserTestGlobals(dom.window),
    CSS: { escape: (identifier: string) => identifier.replaceAll(":", "\\:") },
    CustomEvent: dom.window.CustomEvent,
    cancelAnimationFrame: (id: number) => frames.delete(id),
    DOMRect: dom.window.DOMRect,
    DocumentFragment: dom.window.DocumentFragment,
    document: dom.window.document,
    Element: dom.window.Element,
    Event: dom.window.Event,
    getComputedStyle: dom.window.getComputedStyle,
    HTMLElement: dom.window.HTMLElement,
    HTMLFormElement: dom.window.HTMLFormElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    IntersectionObserver: ObserverStub,
    IS_REACT_ACT_ENVIRONMENT: true,
    MutationObserver: dom.window.MutationObserver,
    Node: dom.window.Node,
    NodeFilter: dom.window.NodeFilter,
    navigator: dom.window.navigator,
    ResizeObserver: ObserverStub,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      nextFrame += 1;
      const id = nextFrame;
      frames.set(id, callback);
      return id;
    },
    SVGElement: dom.window.SVGElement,
    window: dom.window,
  })) {
    originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value,
      writable: true,
    });
  }
  const clock = spyOn(performance, "now").mockImplementation(() => now);
  return {
    advance(ms: number) {
      now += ms;
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) {
        callback(now);
      }
    },
    frames,
    restore() {
      clock.mockRestore();
      frames.clear();
      dom.window.close();
      for (const [key, descriptor] of originalGlobals) {
        if (descriptor) {
          Object.defineProperty(globalThis, key, descriptor);
        } else {
          Reflect.deleteProperty(globalThis, key);
        }
      }
    },
  };
}
