import { afterEach, expect, mock, spyOn, test } from "bun:test";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import { act } from "react";
import { DeviceSource } from "../playback/device-source";
import { useAudioDevices } from "./use-audio-devices";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://radio.test",
});
for (const [key, value] of Object.entries({
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
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
const { cleanup, render } = await import("@testing-library/react");
afterEach(cleanup);

function Devices({ enabled = true }: { enabled?: boolean }) {
  useAudioDevices({ enabled, queryPermission: true });
  return null;
}

test.each(["unmount", "disable"])(
  "a permission query resolving after %s never attaches a listener",
  async (exit) => {
    const deferred = Promise.withResolvers<PermissionStatus>();
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: { query: mock(() => deferred.promise) },
    });
    const add = mock(() => undefined);
    const remove = mock(() => undefined);
    const inputs = spyOn(DeviceSource, "getInputDevices").mockResolvedValue([]);
    const outputs = spyOn(DeviceSource, "getOutputDevices").mockResolvedValue(
      []
    );
    try {
      const view = render(<Devices />);
      act(() => {
        if (exit === "unmount") {
          view.unmount();
        } else {
          view.rerender(<Devices enabled={false} />);
        }
      });
      await act(async () => {
        deferred.resolve({
          addEventListener: add,
          removeEventListener: remove,
          state: "granted",
        } as unknown as PermissionStatus);
        await deferred.promise;
      });
      expect(add).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      // Only the initial enumeration; the late permission cannot refresh it.
      expect(inputs).toHaveBeenCalledTimes(1);
      expect(outputs).toHaveBeenCalledTimes(1);
    } finally {
      inputs.mockRestore();
      outputs.mockRestore();
      Reflect.deleteProperty(navigator, "permissions");
    }
  }
);
