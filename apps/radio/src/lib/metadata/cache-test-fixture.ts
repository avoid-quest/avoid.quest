import { mock } from "bun:test";
import type { MetadataCache } from "./cache";

export function createMetadataCacheFixture() {
  const entries = new Map<string, string>();
  const get = mock((key: string) =>
    Promise.resolve(JSON.parse(entries.get(key) ?? "null"))
  );
  const put = mock(
    (key: string, value: string, _options: { expirationTtl: number }) => {
      entries.set(key, value);
      return Promise.resolve();
    }
  );
  return { cache: { get, put } as unknown as MetadataCache, entries, get, put };
}
