import { describe, expect, test } from "bun:test";
import {
  collectLocalNamModelIds,
  createLocalNamModelId,
  deleteNamModel,
  deleteUnreferencedNamModels,
  getCachedNamModel,
  ingestLocalNamModel,
  parseNamModel,
  saveNamModel,
} from "./nam-model-store";
import { createDefaultEffectConfig } from "./registry";

describe("NAM model storage", () => {
  test("ingests a local model and returns persisted effect metadata", async () => {
    const modelData = '{"version":"0.5.2"}';
    const model = await ingestLocalNamModel("amp.nam", modelData);

    expect(model).toEqual({
      modelData: null,
      modelId: model.modelId,
      modelName: "amp.nam",
      modelUrl: null,
    });
    expect(model.modelId.startsWith("local-nam:")).toBe(true);
    expect(getCachedNamModel(model.modelId)).toBe(modelData);

    await deleteNamModel(model.modelId);
  });

  test("rejects non-object NAM data before ingestion", () => {
    expect(() => parseNamModel("amp.nam", "[]")).toThrow(
      "NAM model must contain a JSON object."
    );
  });

  test("keeps model bytes behind a bounded local identifier", async () => {
    const modelId = createLocalNamModelId();
    const modelData = '{"version":"0.5.2"}';

    await saveNamModel(modelId, modelData);

    expect(modelId.startsWith("local-nam:")).toBe(true);
    expect(getCachedNamModel(modelId)).toBe(modelData);

    await deleteNamModel(modelId);
    expect(getCachedNamModel(modelId)).toBeNull();
  });

  test("collects nested local model references and preserves shared blobs", async () => {
    const sharedId = createLocalNamModelId();
    const removedId = createLocalNamModelId();
    await saveNamModel(sharedId, '{"shared":true}');
    await saveNamModel(removedId, '{"removed":true}');

    const nested = createDefaultEffectConfig("neuralAmp", "nested", 0);
    nested.modelId = sharedId;
    const container = createDefaultEffectConfig("fxComposite", "container", 0);
    const [firstChain] = container.chains;
    if (!firstChain) {
      throw new Error("Default composite requires a chain");
    }
    firstChain.effects = [nested];

    const references = collectLocalNamModelIds([container]);
    await deleteUnreferencedNamModels([sharedId, removedId], references);

    expect(getCachedNamModel(sharedId)).toBe('{"shared":true}');
    expect(getCachedNamModel(removedId)).toBeNull();
    await deleteNamModel(sharedId);
  });

  test("does not publish model bytes before an IndexedDB transaction commits", async () => {
    const modulePath = "./nam-model-store.ts?transaction-test";
    const isolated = (await import(
      modulePath
    )) as typeof import("./nam-model-store");
    const priorIndexedDb = globalThis.indexedDB;
    const modelId = isolated.createLocalNamModelId();
    await isolated.saveNamModel(modelId, '{"prior":true}');
    const transaction = {
      error: new Error("Storage transaction aborted"),
      objectStore: () => ({ delete: () => ({}), put: () => ({}) }),
      onabort: null as (() => void) | null,
      oncomplete: null as (() => void) | null,
      onerror: null as (() => void) | null,
    };
    const request = {
      onerror: null as (() => void) | null,
      onsuccess: null as (() => void) | null,
      result: { transaction: () => transaction },
    };
    globalThis.indexedDB = {
      open: () => {
        queueMicrotask(() => request.onsuccess?.());
        return request;
      },
    } as unknown as IDBFactory;
    try {
      const pending = isolated.saveNamModel(modelId, '{"new":true}');
      await Promise.resolve();
      await Promise.resolve();
      expect(isolated.getCachedNamModel(modelId)).toBe('{"prior":true}');
      transaction.onabort?.();
      await expect(pending).rejects.toThrow("Storage transaction aborted");
      expect(isolated.getCachedNamModel(modelId)).toBe('{"prior":true}');
      let deletionCommitted = false;
      const deletion = isolated.deleteNamModel(modelId).then(() => {
        deletionCommitted = true;
      });
      await Promise.resolve();
      await Promise.resolve();
      expect(deletionCommitted).toBe(false);
      transaction.oncomplete?.();
      await deletion;
      expect(deletionCommitted).toBe(true);
    } finally {
      globalThis.indexedDB = priorIndexedDb;
    }
  });
});
