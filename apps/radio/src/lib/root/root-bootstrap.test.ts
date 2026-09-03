import { describe, expect, mock, test } from "bun:test";
import type { SyncChanges } from "@/lib/collections";
import {
  applyRootSyncChanges,
  createRootQueryClient,
  loadRootSyncChanges,
  reportRootBootstrapError,
} from "./root-bootstrap";

const sampleChanges: SyncChanges = {
  additions: [
    {
      name: "New Radio",
      order: 1,
      enabled: true,
      isSystem: false,
      streamUrl: "https://radio.example/live.mp3",
    },
  ],
  updates: [],
  deletions: [],
};

describe("createRootQueryClient", () => {
  test("creates the expected cache defaults", () => {
    const client = createRootQueryClient();

    const queryDefaults = client.getDefaultOptions().queries;
    expect(queryDefaults?.staleTime).toBe(60_000);
    expect(queryDefaults?.gcTime).toBe(300_000);
  });
});

describe("loadRootSyncChanges", () => {
  test("returns sync changes from collection initialization", async () => {
    const initialize = mock(async () => sampleChanges);

    await expect(loadRootSyncChanges(initialize)).resolves.toEqual(
      sampleChanges
    );
  });

  test("normalizes missing changes to null", async () => {
    const initialize = mock(async () => null);

    await expect(loadRootSyncChanges(initialize)).resolves.toBeNull();
  });
});

describe("applyRootSyncChanges", () => {
  test("delegates to radio sync application", () => {
    const applyChanges = mock((_changes: SyncChanges) => undefined);

    applyRootSyncChanges(sampleChanges, applyChanges);

    expect(applyChanges).toHaveBeenCalledWith(sampleChanges);
  });
});

describe("reportRootBootstrapError", () => {
  test("logs the bootstrap failure with the shared prefix", () => {
    const log = mock((_message: string, _error: unknown) => undefined);
    const error = new Error("boot failed");

    reportRootBootstrapError(error, log);

    expect(log).toHaveBeenCalledWith(
      "[radio] Failed to initialize collections:",
      error
    );
  });
});
