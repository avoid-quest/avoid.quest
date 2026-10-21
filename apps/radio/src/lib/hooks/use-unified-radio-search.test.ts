import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import type { Radio } from "@/lib/audio";
import type {
  StationDiscoveryInput,
  StationDiscoverySnapshot,
} from "@/lib/stations/station-discovery";
import {
  playbackRuntimeStore,
  updatePlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";

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

const inputs: StationDiscoveryInput[] = [];
const cancel = mock(() => undefined);
const search = mock(
  (
    input: StationDiscoveryInput,
    publish: (snapshot: StationDiscoverySnapshot) => void
  ) => {
    inputs.push(input);
    if (inputs.length === 1) {
      publish({ duplicateCount: 0, isSearching: false, results: [] });
    }
    return cancel;
  }
);

mock.module("@/lib/stations/station-discovery-adapters", () => ({
  createProductionStationDiscovery: () => ({ search }),
}));

let useUnifiedRadioSearch: typeof import("./use-unified-radio-search")["useUnifiedRadioSearch"];

beforeAll(async () => {
  ({ useUnifiedRadioSearch } = await import("./use-unified-radio-search"));
});

afterEach(() => {
  cleanup();
  inputs.length = 0;
  search.mockClear();
  cancel.mockClear();
  playbackRuntimeStore.setState(() => ({ channels: {} }));
});

function TestHarness({ stationName }: { stationName: string }) {
  useUnifiedRadioSearch("rome", [
    {
      name: stationName,
      streamUrl: "https://radio.example/live",
    } satisfies Radio,
  ]);
  return null;
}

describe("useUnifiedRadioSearch", () => {
  test("restarts discovery only when inline station contents change", async () => {
    const view = render(createElement(TestHarness, { stationName: "Rome" }));

    await act(async () => Promise.resolve());

    expect(search).toHaveBeenCalledTimes(1);

    view.rerender(createElement(TestHarness, { stationName: "Rome" }));
    await act(async () => Promise.resolve());

    expect(search).toHaveBeenCalledTimes(1);

    view.rerender(createElement(TestHarness, { stationName: "Roma" }));
    await act(async () => Promise.resolve());

    expect(search).toHaveBeenCalledTimes(2);
    expect(inputs.at(-1)?.knownStations[0]?.name).toBe("Roma");
  });
});

test("buffering changes update the probe policy without restarting discovery", async () => {
  render(createElement(TestHarness, { stationName: "Rome" }));
  await act(async () => Promise.resolve());
  expect(search).toHaveBeenCalledTimes(1);
  await act(() => {
    updatePlaybackChannelRuntime("test-buffering", () => ({
      isBuffering: true,
    }));
  });
  await act(() => {
    updatePlaybackChannelRuntime("test-buffering", () => ({
      isBuffering: false,
      isLoading: true,
    }));
  });
  await act(() => {
    updatePlaybackChannelRuntime("test-buffering", () => ({
      isLoading: false,
    }));
  });
  expect(search).toHaveBeenCalledTimes(1);
  expect(cancel).not.toHaveBeenCalled();
});

test("closing the surface cancels the current lifecycle and reopening starts a fresh search", async () => {
  function Surface({ enabled }: { enabled: boolean }) {
    useUnifiedRadioSearch("rome", [], enabled);
    return null;
  }
  const view = render(createElement(Surface, { enabled: true }));
  await act(async () => Promise.resolve());
  view.rerender(createElement(Surface, { enabled: false }));
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(search).toHaveBeenCalledTimes(1);
  view.rerender(createElement(Surface, { enabled: true }));
  expect(search).toHaveBeenCalledTimes(2);
});
