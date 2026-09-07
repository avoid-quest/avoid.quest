import { expect, mock, test } from "bun:test";
import { cacheMetadata } from "./cache";
import { createMetadataEdgeStore } from "./edge-store";

test("reuses metadata across stores on the same origin and preserves expiry", async () => {
  const entries = new Map<string, Response>();
  const match = mock((key: RequestInfo | URL) =>
    Promise.resolve(entries.get(String(key))?.clone())
  );
  const put = mock((key: RequestInfo | URL, response: Response) => {
    entries.set(String(key), response.clone());
    return Promise.resolve();
  });
  const openCache = () => Promise.resolve({ match, put });
  let time = 1000;
  const retrieve = mock(() =>
    Promise.resolve({ expiresAt: time + 60_000, title: "Live" })
  );
  const read = (url: string) =>
    cacheMetadata({
      expiresAt: (value) => value.expiresAt,
      key: ["live", "https://provider.example/live?token=private"],
      now: () => time,
      retrieve,
      store: createMetadataEdgeStore(() => url, openCache),
      ttl: 60,
    });

  expect(
    await read("https://radio.example/api/radio-metadata?url=one")
  ).toEqual({ expiresAt: 61_000, title: "Live" });
  time = 60_999;
  expect(await read("https://radio.example/other")).toEqual({
    expiresAt: 61_000,
    title: "Live",
  });
  expect(retrieve).toHaveBeenCalledTimes(1);
  const [entry] = [...entries.entries()];
  if (!entry) {
    throw new Error("Expected a cached response");
  }
  const [storedKey, storedResponse] = entry;
  expect(storedKey).toStartWith(
    "https://radio.example/__radio_metadata_cache/"
  );
  expect(storedKey).not.toContain("private");
  expect(storedResponse.headers.get("Cache-Control")).toBe(
    "public, max-age=60"
  );

  time = 61_000;
  await read("https://radio.example/api/radio-metadata");
  expect(retrieve).toHaveBeenCalledTimes(2);
  await read("https://preview.example/api/radio-metadata");
  expect(retrieve).toHaveBeenCalledTimes(3);
});

test("cache unavailability falls back to providers", async () => {
  const store = createMetadataEdgeStore(
    () => "https://radio.example/",
    () => Promise.reject(new Error("Cache unavailable"))
  );
  expect(
    await cacheMetadata({
      key: ["live"],
      retrieve: () => Promise.resolve("live"),
      store,
      ttl: 60,
    })
  ).toBe("live");
});
