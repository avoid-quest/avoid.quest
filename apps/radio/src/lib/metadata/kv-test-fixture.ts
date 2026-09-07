import { mock } from "bun:test";
import type { MetadataKv } from "./cache";

export function createMetadataKvFixture() {
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
  return { entries, get, kv: { get, put } as unknown as MetadataKv, put };
}
