import { afterEach, beforeAll, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import { createElement } from "react";

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

type ServerFnCall = { query: string; signal?: AbortSignal };
const calls: ServerFnCall[] = [];

// Stands in for the server-function RPC, which hands `signal` to fetch:
// the request stays open until that signal aborts it.
const pendingRequest = mock(
  ({ data, signal }: { data: { query: string }; signal?: AbortSignal }) => {
    calls.push({ query: data.query, signal });
    return new Promise<never>((_, reject) => {
      signal?.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
    });
  }
);

mock.module("@/utils/search.functions", () => ({
  bandcampSearch: pendingRequest,
  mixcloudSearch: pendingRequest,
  soundcloudSearch: pendingRequest,
}));

let useExternalSearch: typeof import("./use-external-search")["useExternalSearch"];

beforeAll(async () => {
  ({ useExternalSearch } = await import("./use-external-search"));
});

afterEach(() => {
  cleanup();
  calls.length = 0;
  pendingRequest.mockClear();
});

function renderSearch() {
  const hook: { current?: ReturnType<typeof useExternalSearch> } = {};
  function Harness() {
    hook.current = useExternalSearch();
    return null;
  }
  render(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(Harness)
    )
  );
  const current = () => {
    if (!hook.current) {
      throw new Error("Search hook did not render");
    }
    return hook.current;
  };
  return current;
}

test("a replaced search aborts its pending provider request", async () => {
  const search = renderSearch();
  let replaced!: Promise<unknown>;
  act(() => {
    replaced = search()
      .mutateAsync({ platform: "bandcamp", query: "old" })
      .catch((error: unknown) => error);
  });
  await waitFor(() => expect(calls).toHaveLength(1));

  act(() => {
    search().mutate({ platform: "bandcamp", query: "new" });
  });
  await waitFor(() => expect(calls).toHaveLength(2));

  expect(calls.map((call) => call.query)).toEqual(["old", "new"]);
  expect(calls[0]?.signal?.aborted).toBe(true);
  expect(calls[1]?.signal?.aborted).toBe(false);
  expect(await replaced).toMatchObject({ name: "AbortError" });
});

test("resetting a search aborts its pending provider request", async () => {
  const search = renderSearch();
  act(() => {
    search().mutate({ platform: "mixcloud", query: "ambient" });
  });
  await waitFor(() => expect(calls).toHaveLength(1));

  act(() => {
    search().reset();
  });

  expect(calls[0]?.signal?.aborted).toBe(true);
  expect(pendingRequest).toHaveBeenCalledTimes(1);
});
