import { describe, expect, test } from "bun:test";
import {
  collectLocalNamModelIds,
  createLocalNamModelId,
  deleteNamModel,
  deleteUnreferencedNamModels,
  getCachedNamModel,
  saveNamModel,
} from "./nam-model-store";
import { createDefaultEffectConfig } from "./registry";

describe("NAM model storage", () => {
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
    const firstChain = container.chains[0];
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
});
