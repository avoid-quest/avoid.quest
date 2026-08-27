import { describe, expect, mock, test } from "bun:test";
import { createNamModelLoader, parseNamModel } from "./tone3000-model-params";

describe("parseNamModel", () => {
  test("keeps a valid local NAM JSON model for the official adapter", () => {
    expect(parseNamModel("amp.nam", '{"version":"0.5.2"}')).toEqual({
      modelData: '{"version":"0.5.2"}',
      modelName: "amp.nam",
    });
  });

  test("rejects non-object NAM data", () => {
    expect(() => parseNamModel("amp.nam", "[]")).toThrow(
      "NAM model must contain a JSON object."
    );
  });
});

describe("createNamModelLoader", () => {
  test("keeps only the latest selection and deletes the stale model", async () => {
    let resolveFirst:
      | ((value: {
          modelData: null;
          modelId: string;
          modelName: string;
          modelUrl: null;
        }) => void)
      | undefined;
    const discard = mock(async (_modelId: string) => undefined);
    const loader = createNamModelLoader({
      discard,
      ingest: (modelName) =>
        modelName === "old.nam"
          ? new Promise((resolve) => {
              resolveFirst = resolve;
            })
          : Promise.resolve({
              modelData: null,
              modelId: `local-nam:${modelName}`,
              modelName,
              modelUrl: null,
            }),
    });

    const stale = loader.load({
      name: "old.nam",
      text: async () => "old",
    });
    await Promise.resolve();
    const current = loader.load({
      name: "new.nam",
      text: async () => "new",
    });

    expect(await current).toMatchObject({ modelName: "new.nam" });
    resolveFirst?.({
      modelData: null,
      modelId: "local-nam:old.nam",
      modelName: "old.nam",
      modelUrl: null,
    });
    expect(await stale).toBeNull();
    expect(discard).toHaveBeenCalledWith("local-nam:old.nam");
  });

  test("deletes an ingested model when the request is invalidated", async () => {
    let resolveIngest:
      | ((value: {
          modelData: null;
          modelId: string;
          modelName: string;
          modelUrl: null;
        }) => void)
      | undefined;
    const discard = mock(async (_modelId: string) => undefined);
    const loader = createNamModelLoader({
      discard,
      ingest: () =>
        new Promise((resolve) => {
          resolveIngest = resolve;
        }),
    });

    const pending = loader.load({
      name: "removed.nam",
      text: async () => "model",
    });
    await Promise.resolve();
    loader.invalidate();
    resolveIngest?.({
      modelData: null,
      modelId: "local-nam:removed",
      modelName: "removed.nam",
      modelUrl: null,
    });

    expect(await pending).toBeNull();
    expect(discard).toHaveBeenCalledWith("local-nam:removed");
  });

  test("discards a pending model when the effect is reset", async () => {
    let resolveIngest:
      | ((value: {
          modelData: null;
          modelId: string;
          modelName: string;
          modelUrl: null;
        }) => void)
      | undefined;
    const discard = mock(async (_modelId: string) => undefined);
    const loader = createNamModelLoader({
      discard,
      ingest: () =>
        new Promise((resolve) => {
          resolveIngest = resolve;
        }),
    });
    loader.synchronize("selected");
    const pending = loader.load({
      name: "selected.nam",
      text: async () => "model",
    });
    await Promise.resolve();

    loader.synchronize("reset");
    resolveIngest?.({
      modelData: null,
      modelId: "local-nam:selected",
      modelName: "selected.nam",
      modelUrl: null,
    });

    expect(await pending).toBeNull();
    expect(discard).toHaveBeenCalledWith("local-nam:selected");
  });
});
