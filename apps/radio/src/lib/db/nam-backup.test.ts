import { describe, expect, test } from "bun:test";
import {
  collectLocalNamModelIds,
  createLocalNamModelId,
  deleteNamModel,
  getNamModel,
  saveNamModel,
} from "@/lib/audio/dsp/effects/nam-model-store";
import { createNodeEffectConfig } from "@/lib/node-graph/catalogue";
import { type NodeGraph, nodeGraphSchema } from "@/lib/node-graph/schema";
import {
  exportNamModels,
  prepareImportedNamModels,
  validateMissingNamModels,
  validateNamModelBackup,
} from "./nam-backup";

const INVALID_BACKUP = /Invalid NAM model backup/;
const INVALID_MODEL = /NAM model must contain a JSON object/;
const MISSING_MODEL = /Missing local NAM model/;
const INVALID_MISSING = /Invalid missing NAM model list/;
const modelData = '{"version":"0.5.2","weights":[1,2,3]}';

function modelGraph(modelId: string): NodeGraph {
  return nodeGraphSchema.parse({
    edges: [],
    nodes: [
      {
        data: {
          effect: {
            ...createNodeEffectConfig("neuralAmp", "amp"),
            modelData: null,
            modelId,
            modelName: "amp.nam",
            modelUrl: null,
          },
        },
        id: "amp",
        position: { x: 0, y: 0 },
        type: "neuralAmp",
      },
      {
        data: {},
        id: "speakers",
        position: { x: 300, y: 0 },
        type: "speakers",
      },
    ],
    version: 2,
  });
}

function graphModelId(graph: NodeGraph): string {
  const node = graph.nodes.find((candidate) => candidate.type === "neuralAmp");
  if (node?.type !== "neuralAmp" || node.data.effect.type !== "neuralAmp") {
    throw new Error("Expected NAM effect");
  }
  return node.data.effect.modelId as string;
}

describe("NAM file-backup assets", () => {
  test("bundles an unwired local model and restores it into an empty store", async () => {
    const id = createLocalNamModelId();
    const graph = modelGraph(id);
    await saveNamModel(id, modelData);
    const { missing, models: backup } = await exportNamModels(graph);
    expect(backup).toEqual({ [id]: modelData });
    expect(missing).toBeUndefined();
    await deleteNamModel(id);

    const imported = await prepareImportedNamModels(graph, backup);
    const restoredId = graphModelId(imported.graph);
    expect(restoredId).not.toBe(id);
    expect(await getNamModel(restoredId)).toBe(modelData);
    expect(graphModelId(graph)).toBe(id);
    await imported.rollback();
    expect(await getNamModel(restoredId)).toBeNull();
  });

  test("bundles and rewrites models inside effect containers", async () => {
    const id = createLocalNamModelId();
    const graph = modelGraph(id);
    const amp = graph.nodes.find((node) => node.type === "neuralAmp");
    if (amp?.type !== "neuralAmp") {
      throw new Error("Expected NAM effect");
    }
    const rack = createNodeEffectConfig("fxComposite", "rack");
    const [chain] = rack.chains;
    if (!chain) {
      throw new Error("Expected default effect chain");
    }
    chain.effects = [amp.data.effect];
    graph.nodes[0] = {
      data: { effect: rack },
      id: "rack",
      position: { x: 0, y: 0 },
      type: "fxComposite",
    };
    await saveNamModel(id, modelData);
    const { models: backup } = await exportNamModels(graph);
    await deleteNamModel(id);
    const imported = await prepareImportedNamModels(graph, backup);
    const [importedRack] = imported.graph.nodes;
    if (importedRack?.type !== "fxComposite") {
      throw new Error("Expected imported effect container");
    }
    const [restoredId] = collectLocalNamModelIds([importedRack.data.effect]);
    expect(restoredId).not.toBe(id);
    expect(await getNamModel(restoredId ?? null)).toBe(modelData);
    await imported.rollback();
  });

  test("uses fresh IDs so an imported backup cannot overwrite Undo resources", async () => {
    const id = createLocalNamModelId();
    await saveNamModel(id, '{"local":true}');
    const imported = await prepareImportedNamModels(modelGraph(id), {
      [id]: modelData,
    });
    expect(await getNamModel(id)).toBe('{"local":true}');
    expect(await getNamModel(graphModelId(imported.graph))).toBe(modelData);
    await imported.rollback();
    expect(await getNamModel(id)).toBe('{"local":true}');
    await deleteNamModel(id);
  });

  test("rejects invalid assets and missing references before staging", async () => {
    const id = createLocalNamModelId();
    const graph = modelGraph(id);
    expect(() => validateNamModelBackup([], graph)).toThrow(INVALID_BACKUP);
    expect(() => validateNamModelBackup({ [id]: "[]" }, graph)).toThrow(
      INVALID_MODEL
    );
    expect(() => validateNamModelBackup({}, graph)).toThrow(MISSING_MODEL);
    expect(() =>
      validateNamModelBackup({ "local-nam:unreferenced": modelData }, graph)
    ).toThrow(INVALID_BACKUP);
    await expect(prepareImportedNamModels(graph, undefined)).rejects.toThrow(
      MISSING_MODEL
    );
    expect(() => validateMissingNamModels(["local-nam:other"], graph)).toThrow(
      INVALID_MISSING
    );
    expect(() => validateMissingNamModels(id, graph)).toThrow(INVALID_MISSING);
    expect(await getNamModel(id)).toBeNull();
  });

  test("a model gone from this device is listed missing and imports without bytes", async () => {
    const id = createLocalNamModelId();
    const graph = modelGraph(id);

    const exported = await exportNamModels(graph);
    expect(exported).toEqual({ missing: [id], models: undefined });

    const missing = validateMissingNamModels(exported.missing, graph);
    expect(validateNamModelBackup(exported.models, graph, missing)).toBe(
      undefined
    );
    const imported = await prepareImportedNamModels(
      graph,
      exported.models,
      missing
    );
    const amp = imported.graph.nodes.find((node) => node.type === "neuralAmp");
    if (amp?.type !== "neuralAmp" || amp.data.effect.type !== "neuralAmp") {
      throw new Error("Expected NAM effect");
    }
    // The FX stays, without a model.
    expect(amp.data.effect.modelId).toBeNull();
    expect(amp.data.effect.modelData).toBeNull();
    await imported.rollback();
  });

  test("legacy graph-only backups use an available local model explicitly", async () => {
    const id = createLocalNamModelId();
    const graph = modelGraph(id);
    await saveNamModel(id, modelData);
    expect(validateNamModelBackup(undefined, graph)).toBeUndefined();
    const imported = await prepareImportedNamModels(graph, undefined);
    expect(await getNamModel(graphModelId(imported.graph))).toBe(modelData);
    await imported.rollback();
    await deleteNamModel(id);
  });
});
