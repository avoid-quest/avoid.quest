import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import type { ReactNode } from "react";
import type { LoadPlatformItemResult } from "@/lib/platform-item-loader";

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

let platformItemLoader: typeof import("@/lib/platform-item-loader");
let usePlatformLoad: typeof import("./use-platform-query")["usePlatformLoad"];
let loadPlatformItemMock: ReturnType<
  typeof spyOn<typeof platformItemLoader, "loadPlatformItem">
>;
let queryClient: QueryClient;

function QueryProvider({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

beforeAll(async () => {
  platformItemLoader = await import("@/lib/platform-item-loader");
  ({ usePlatformLoad } = await import("./use-platform-query"));
});

beforeEach(() => {
  queryClient = new QueryClient();
  loadPlatformItemMock = spyOn(
    platformItemLoader,
    "loadPlatformItem"
  ).mockImplementation(
    () => new Promise<LoadPlatformItemResult>(() => undefined)
  );
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  loadPlatformItemMock.mockRestore();
});

function loadSignal(call: number): AbortSignal | undefined {
  return loadPlatformItemMock.mock.calls[call]?.[1]?.signal;
}

describe("usePlatformLoad", () => {
  test("aborts a load once a newer one starts", async () => {
    const { result } = renderHook(() => usePlatformLoad(), {
      wrapper: QueryProvider,
    });

    await act(async () => {
      result.current.load("https://open.spotify.com/playlist/first");
      await Promise.resolve();
    });
    expect(loadSignal(0)?.aborted).toBe(false);

    await act(async () => {
      result.current.load("https://open.spotify.com/playlist/second");
      await Promise.resolve();
    });
    expect(loadSignal(0)?.aborted).toBe(true);
    expect(loadSignal(1)?.aborted).toBe(false);
  });

  test("aborts the load in flight on unmount", async () => {
    const { result, unmount } = renderHook(() => usePlatformLoad(), {
      wrapper: QueryProvider,
    });

    await act(async () => {
      result.current.load("https://open.spotify.com/playlist/first");
      await Promise.resolve();
    });
    unmount();
    expect(loadSignal(0)?.aborted).toBe(true);
  });
});
