import {
  createLocalNamModelId,
  deleteNamModel,
  getNamModel,
  parseNamModel,
  saveNamModel,
} from "@/lib/audio/dsp/effects/nam-model-store";
import type {
  EffectConfig,
  NeuralAmpConfig,
} from "@/lib/audio/dsp/effects/types";
import { visitEffectTree } from "@/lib/audio/dsp/routing/effect-tree";
import { EFFECT_NODE_TYPES, type NodeGraph } from "@/lib/node-graph/schema";

export type NamModelBackup = Record<string, string>;

function graphNamModels(graph: NodeGraph | null): NeuralAmpConfig[] {
  const models: NeuralAmpConfig[] = [];
  for (const node of graph?.nodes ?? []) {
    if (
      EFFECT_NODE_TYPES.some((type) => type === node.type) &&
      "effect" in node.data
    ) {
      visitEffectTree([node.data.effect as EffectConfig], (effect) => {
        if (effect.type === "neuralAmp") {
          models.push(effect);
        }
      });
    }
  }
  return models;
}

function localModels(graph: NodeGraph | null): NeuralAmpConfig[] {
  return graphNamModels(graph).filter((model) =>
    model.modelId?.startsWith("local-nam:")
  );
}

/** File backups carry every local model, including unwired and nested FX. */
export async function exportNamModels(
  graph: NodeGraph | null
): Promise<NamModelBackup | undefined> {
  const entries = await Promise.all(
    localModels(graph).map(async (model) => {
      const id = model.modelId as string;
      const data = model.modelData ?? (await getNamModel(id));
      if (!data) {
        throw new Error(`Missing local NAM model: ${model.modelName ?? id}`);
      }
      return [
        id,
        parseNamModel(model.modelName ?? id, data).modelData,
      ] as const;
    })
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/** Validate bytes and reference coverage before previewing or applying a backup. */
export function validateNamModelBackup(
  raw: unknown,
  graph: NodeGraph | null
): NamModelBackup | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid NAM model backup");
  }
  const referenced = new Set(localModels(graph).map((model) => model.modelId));
  const models: NamModelBackup = {};
  for (const [id, data] of Object.entries(raw)) {
    if (
      !id.startsWith("local-nam:") ||
      id.length === "local-nam:".length ||
      !referenced.has(id) ||
      typeof data !== "string"
    ) {
      throw new Error("Invalid NAM model backup entry");
    }
    models[id] = parseNamModel(id, data).modelData;
  }
  for (const model of localModels(graph)) {
    if (!(model.modelData || models[model.modelId as string])) {
      throw new Error(
        `Missing local NAM model: ${model.modelName ?? model.modelId}`
      );
    }
  }
  return models;
}

export function hasLocalNamModels(graph: NodeGraph | null): boolean {
  return localModels(graph).length > 0;
}

/**
 * Fresh IDs preserve local/Undo assets even when a backup reuses their IDs.
 * Only newly staged models are removed if the following import fails.
 */
export async function prepareImportedNamModels(
  graph: NodeGraph,
  backup: NamModelBackup | undefined
): Promise<{ graph: NodeGraph; rollback: () => Promise<void> }> {
  const entries = await Promise.all(
    localModels(graph).map(async (model) => {
      const id = model.modelId as string;
      const bytes = backup?.[id] ?? model.modelData ?? (await getNamModel(id));
      if (!bytes) {
        throw new Error(`Missing local NAM model: ${model.modelName ?? id}`);
      }
      return [
        id,
        parseNamModel(model.modelName ?? id, bytes).modelData,
      ] as const;
    })
  );
  const data = new Map(entries);
  const replacements = new Map<string, string>();
  const rollback = async () => {
    await Promise.all([...replacements.values()].map(deleteNamModel));
  };
  try {
    const saved = await Promise.allSettled(
      [...data].map(async ([id, bytes]) => {
        const freshId = createLocalNamModelId();
        replacements.set(id, freshId);
        await saveNamModel(freshId, bytes);
      })
    );
    const failed = saved.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") {
      throw failed.reason;
    }
    const prepared = structuredClone(graph);
    for (const model of localModels(prepared)) {
      model.modelId = replacements.get(model.modelId as string) as string;
      model.modelData = null;
    }
    return { graph: prepared, rollback };
  } catch (error) {
    await rollback();
    throw error;
  }
}
