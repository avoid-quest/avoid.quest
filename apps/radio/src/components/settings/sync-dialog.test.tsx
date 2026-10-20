import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import { toast } from "sonner";
import type { SyncChanges } from "@/lib/collections/radios";
import { applyRootSyncChanges } from "@/lib/root/root-bootstrap";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://radio.test",
});

const globals = {
  CustomEvent: dom.window.CustomEvent,
  DocumentFragment: dom.window.DocumentFragment,
  document: dom.window.document,
  Element: dom.window.Element,
  Event: dom.window.Event,
  getComputedStyle: dom.window.getComputedStyle,
  HTMLElement: dom.window.HTMLElement,
  HTMLInputElement: dom.window.HTMLInputElement,
  MutationObserver: dom.window.MutationObserver,
  Node: dom.window.Node,
  NodeFilter: dom.window.NodeFilter,
  window: dom.window,
};
const originalGlobals = new Map(
  Object.keys(globals).map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ])
);
for (const [key, value] of Object.entries(globals)) {
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

const { SyncDialog } = await import("./sync-dialog");
const changes: SyncChanges = {
  additions: [{ name: "New station", streamUrl: "https://example.com/live" }],
  deletions: [],
  updates: [],
};

afterEach(async () => {
  cleanup();
  // Flush Radix's deferred focus cleanup before restoring this DOM's globals.
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  mock.restore();
});

afterAll(() => {
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, key);
    }
  }
  dom.window.close();
});

test("keeps the dialog open and prevents another apply until persistence succeeds", async () => {
  const pending = Promise.withResolvers<void>();
  const onApply = mock((selected: SyncChanges) =>
    applyRootSyncChanges(selected, () => pending.promise)
  );
  const onOpenChange = mock((_open: boolean) => undefined);
  const view = render(
    <SyncDialog
      changes={changes}
      onApply={onApply}
      onOpenChange={onOpenChange}
      open
    />
  );

  fireEvent.click(view.getByRole("button", { name: "Apply (1)" }));
  const apply = view.getByRole("button", { name: "Applying…" });
  expect(apply.hasAttribute("disabled")).toBe(true);
  expect(
    view.getByRole("button", { name: "Skip" }).hasAttribute("disabled")
  ).toBe(true);
  fireEvent.click(apply);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onApply).toHaveBeenCalledTimes(1);
  expect(onOpenChange).not.toHaveBeenCalled();

  await act(async () => {
    pending.resolve();
    await pending.promise;
  });
  expect(onOpenChange).toHaveBeenCalledWith(false);
  expect(onApply).toHaveBeenCalledWith(changes);
});

test("shows a save error, keeps the dialog open and lets the listener retry", async () => {
  const onApply = mock(
    (): Promise<void> => Promise.reject(new Error("Storage full"))
  );
  const onOpenChange = mock((_open: boolean) => undefined);
  const errorToast = spyOn(toast, "error").mockImplementation(() => "toast-id");
  const view = render(
    <SyncDialog
      changes={changes}
      onApply={onApply}
      onOpenChange={onOpenChange}
      open
    />
  );

  fireEvent.click(view.getByRole("button", { name: "Apply (1)" }));
  await waitFor(() =>
    expect(errorToast).toHaveBeenCalledWith(
      "Couldn't update stations. Please try again."
    )
  );
  expect(onOpenChange).not.toHaveBeenCalled();
  expect(
    view.getByRole("button", { name: "Apply (1)" }).hasAttribute("disabled")
  ).toBe(false);

  onApply.mockImplementation(() => Promise.resolve());
  fireEvent.click(view.getByRole("button", { name: "Apply (1)" }));
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  expect(onApply).toHaveBeenCalledTimes(2);
});
