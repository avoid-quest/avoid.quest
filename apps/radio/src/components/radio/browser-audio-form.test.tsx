// biome-ignore-all lint/performance/noJsxPropsBind: test handlers
import { afterEach, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import { DisplayAudioError } from "@/lib/audio/playback/display-audio";
import { BrowserAudioForm } from "./browser-audio-form";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://radio.test",
});

for (const [key, value] of Object.entries({
  document: dom.window.document,
  Element: dom.window.Element,
  getComputedStyle: dom.window.getComputedStyle,
  HTMLElement: dom.window.HTMLElement,
  MutationObserver: dom.window.MutationObserver,
  Node: dom.window.Node,
  navigator: dom.window.navigator,
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

afterEach(cleanup);

test("Cancel is held while a share loads, so the share cannot land after it", async () => {
  const pending = Promise.withResolvers<void>();
  const onCancel = mock(() => undefined);
  const view = render(
    <BrowserAudioForm
      onCancel={onCancel}
      onLoad={() => pending.promise}
      source="radio-shows"
    />
  );
  const cancel = view.getByRole("button", { name: "Cancel" });

  fireEvent.click(view.getByRole("button", { name: "Share tab audio" }));

  expect(cancel).toHaveProperty("disabled", true);
  await act(async () => {
    pending.resolve();
    await pending.promise;
  });
  expect(cancel).toHaveProperty("disabled", false);
});

test("closing the share picker leaves the form without an error", async () => {
  const view = render(
    <BrowserAudioForm
      onLoad={() =>
        Promise.reject(
          new DisplayAudioError("Sharing was cancelled.", { cancelled: true })
        )
      }
      source="browser-audio"
    />
  );

  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Share tab audio" }));
    await Promise.resolve();
  });

  expect(view.queryByText("Sharing was cancelled.")).toBeNull();
});
