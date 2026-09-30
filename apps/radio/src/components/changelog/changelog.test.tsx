import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ChangelogEntry } from "@avoid.quest/ui/lib/changelog";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://radio.test",
});

class ObserverStub {
  observe() {
    // The popover's position is irrelevant here.
  }
  unobserve() {
    // No measurements to release.
  }
  disconnect() {
    // No measurements to release.
  }
}

for (const [key, value] of Object.entries({
  CustomEvent: dom.window.CustomEvent,
  DocumentFragment: dom.window.DocumentFragment,
  document: dom.window.document,
  Element: dom.window.Element,
  Event: dom.window.Event,
  getComputedStyle: dom.window.getComputedStyle,
  HTMLElement: dom.window.HTMLElement,
  HTMLInputElement: dom.window.HTMLInputElement,
  KeyboardEvent: dom.window.KeyboardEvent,
  localStorage: dom.window.localStorage,
  MutationObserver: dom.window.MutationObserver,
  Node: dom.window.Node,
  NodeFilter: dom.window.NodeFilter,
  navigator: dom.window.navigator,
  PointerEvent: dom.window.PointerEvent,
  ResizeObserver: ObserverStub,
  window: dom.window,
})) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value,
    writable: true,
  });
}

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
  writable: true,
});

// Radix picks its layout effect when it loads, so it loads after the DOM.
const { cleanup, fireEvent, render } = await import("@testing-library/react");
const { Changelog } = await import("@avoid.quest/ui/components/changelog");

const KEY = "test-changelog-seen";
const ENTRIES: ChangelogEntry[] = [
  { date: "2026-09-20T12:00:00Z", id: "b", text: "Node mode" },
  { date: "2026-09-07T12:00:00Z", id: "a", text: "Metadata preview" },
];

/** Queries cover document.body, where the list is portalled. */
function renderChangelog(entries = ENTRIES) {
  const view = render(<Changelog entries={entries} storageKey={KEY} />);
  return { ...view, trigger: view.getByRole("button") };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(cleanup);

describe("Changelog", () => {
  test("flags changes after the last visit and marks them seen on open", () => {
    localStorage.setItem(KEY, "2026-09-10T00:00:00Z");
    const { getByText, trigger } = renderChangelog();
    expect(trigger.getAttribute("aria-label")).toBe("What's new (unread)");

    fireEvent.click(trigger);

    expect(getByText("Node mode").textContent).toBe("New: Node mode");
    expect(getByText("Metadata preview").textContent).toBe("Metadata preview");
    expect(localStorage.getItem(KEY)).toBe("2026-09-20T12:00:00Z");
    expect(trigger.getAttribute("aria-label")).toBe("What's new");
  });

  test("shows the dot, but flags nothing, for a browser that never looked", () => {
    const { queryByText, trigger } = renderChangelog();
    expect(trigger.getAttribute("aria-label")).toBe("What's new (unread)");

    fireEvent.click(trigger);

    expect(queryByText("New:", { exact: false })).toBeNull();
    expect(localStorage.getItem(KEY)).toBe("2026-09-20T12:00:00Z");
  });

  test("never moves a later mark back", () => {
    localStorage.setItem(KEY, "2026-09-30T00:00:00Z");
    const { trigger } = renderChangelog();
    expect(trigger.getAttribute("aria-label")).toBe("What's new");

    fireEvent.click(trigger);

    expect(localStorage.getItem(KEY)).toBe("2026-09-30T00:00:00Z");
  });

  test("says so when there is nothing to list", () => {
    const { getByText, trigger } = renderChangelog([]);
    fireEvent.click(trigger);
    expect(getByText("Nothing new yet.")).toBeTruthy();
  });
});
