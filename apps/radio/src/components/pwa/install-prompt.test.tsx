import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://radio.test",
});
const previousGlobals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
  document: dom.window.document,
  Element: dom.window.Element,
  Event: dom.window.Event,
  HTMLElement: dom.window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
  localStorage: dom.window.localStorage,
  Node: dom.window.Node,
  navigator: dom.window.navigator,
  window: dom.window,
})) {
  previousGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value,
    writable: true,
  });
}

let standalone = false;
Object.defineProperty(window, "matchMedia", {
  value: () => ({ matches: standalone }),
});
const { act, cleanup, fireEvent, render } = await import(
  "@testing-library/react"
);
const { InstallPrompt } = await import("./install-prompt");
const KEY = "pwa-install-dismissed";
const MONTH = 30 * 24 * 60 * 60 * 1000;
let now = Date.parse("2026-10-20T12:00:00Z");
const nowSpy = spyOn(Date, "now").mockImplementation(() => now);

function offerInstall(outcome: "accepted" | "dismissed" = "accepted") {
  const prompt = mock(async () => undefined);
  const event = Object.assign(
    new Event("beforeinstallprompt", { cancelable: true }),
    { prompt, userChoice: Promise.resolve({ outcome }) }
  );
  fireEvent(window, event);
  return { event, prompt };
}

beforeEach(() => {
  localStorage.clear();
  standalone = false;
  now = Date.parse("2026-10-20T12:00:00Z");
});
afterEach(cleanup);
afterAll(() => {
  nowSpy.mockRestore();
  for (const [key, descriptor] of previousGlobals) {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, key);
    }
  }
  dom.window.close();
});

describe("InstallPrompt", () => {
  test("defers the browser prompt until Install and clears it after acceptance", async () => {
    const view = render(<InstallPrompt />);
    const { event, prompt } = offerInstall();
    expect(event.defaultPrevented).toBe(true);
    expect(prompt).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Install" }));
      await Promise.resolve();
    });
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(view.queryByText("Install radio as an app")).toBeNull();
  });

  test("Not now snoozes across visits for 30 days and retains an unconsumed event", async () => {
    const first = render(<InstallPrompt />);
    offerInstall();
    fireEvent.click(first.getByRole("button", { name: "Not now" }));
    const until = now + MONTH;
    expect(localStorage.getItem(KEY)).toBe(String(until));
    expect(first.queryByText("Install radio as an app")).toBeNull();
    first.unmount();

    const returning = render(<InstallPrompt />);
    const { event, prompt } = offerInstall();
    expect(event.defaultPrevented).toBe(true);
    expect(returning.queryByText("Install radio as an app")).toBeNull();
    now = until - 1;
    fireEvent.focus(window);
    expect(returning.queryByText("Install radio as an app")).toBeNull();
    now = until;
    fireEvent.focus(window);
    await act(async () => {
      fireEvent.click(returning.getByRole("button", { name: "Install" }));
      await Promise.resolve();
    });
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  test("migrates a legacy boolean once instead of immediately prompting or extending every visit", () => {
    localStorage.setItem(KEY, "true");
    const first = render(<InstallPrompt />);
    const until = now + MONTH;
    expect(localStorage.getItem(KEY)).toBe(String(until));
    offerInstall();
    expect(first.queryByText("Install radio as an app")).toBeNull();
    first.unmount();

    now += 24 * 60 * 60 * 1000;
    const returning = render(<InstallPrompt />);
    offerInstall();
    expect(localStorage.getItem(KEY)).toBe(String(until));
    expect(returning.queryByText("Install radio as an app")).toBeNull();
    now = until;
    fireEvent.focus(window);
    expect(returning.getByText("Install radio as an app")).toBeDefined();
  });

  test("native prompt dismissal also snoozes and waits for a fresh browser event", async () => {
    const view = render(<InstallPrompt />);
    offerInstall("dismissed");
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Install" }));
      await Promise.resolve();
    });
    expect(localStorage.getItem(KEY)).toBe(String(now + MONTH));
    now += MONTH;
    fireEvent.focus(window);
    expect(view.queryByText("Install radio as an app")).toBeNull();
    offerInstall();
    expect(view.getByText("Install radio as an app")).toBeDefined();
  });

  test.each(["expired", "invalid"])(
    "offers installation with an %s snooze",
    (value) => {
      localStorage.setItem(
        KEY,
        value === "expired" ? String(now - 1) : "invalid"
      );
      const view = render(<InstallPrompt />);
      offerInstall();
      expect(view.getByText("Install radio as an app")).toBeDefined();
    }
  );

  test("does not display an install offer in standalone mode", () => {
    standalone = true;
    const view = render(<InstallPrompt />);
    offerInstall();
    expect(view.queryByText("Install radio as an app")).toBeNull();
  });

  test("keeps the page's snooze when browser storage is unavailable", () => {
    const read = spyOn(window.Storage.prototype, "getItem").mockImplementation(
      () => {
        throw new Error("Storage unavailable");
      }
    );
    const write = spyOn(window.Storage.prototype, "setItem").mockImplementation(
      () => {
        throw new Error("Storage unavailable");
      }
    );
    try {
      const view = render(<InstallPrompt />);
      offerInstall();
      fireEvent.click(view.getByRole("button", { name: "Not now" }));
      fireEvent.focus(window);
      expect(view.queryByText("Install radio as an app")).toBeNull();
      now += MONTH;
      fireEvent.focus(window);
      expect(view.getByText("Install radio as an app")).toBeDefined();
    } finally {
      read.mockRestore();
      write.mockRestore();
    }
  });
});
