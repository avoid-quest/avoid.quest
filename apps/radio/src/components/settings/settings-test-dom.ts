// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";

export function installSettingsTestDom() {
  const dom = new JSDOM(
    "<!doctype html><html><head></head><body></body></html>",
    {
      pretendToBeVisual: true,
      url: "https://radio.test",
    }
  );
  for (const key of [
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "document",
    "Element",
    "Event",
    "CustomEvent",
    "HTMLElement",
    "HTMLFormElement",
    "Node",
    "MutationObserver",
    "DocumentFragment",
    "getComputedStyle",
    "navigator",
    "window",
  ]) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: dom.window[key],
      writable: true,
    });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
    writable: true,
  });
  return dom;
}
