import { describe, expect, test } from "bun:test";
import {
  createLocalNamModelId,
  deleteNamModel,
  getCachedNamModel,
  saveNamModel,
} from "./nam-model-store";

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
});
