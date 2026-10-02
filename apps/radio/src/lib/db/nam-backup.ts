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
import {
  EFFECT_NODE_TYPES,
  getNodeGraphReadOnlyVersion,
  type NodeGraph,
} from "@/lib/node-graph/schema";

export type NamModelBackup = Record<string, string>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A newer release's patch is kept as stored and never parsed, but its local
 * models still belong in a backup: that release reads them back. Its shape
 * is walked leniently, so one we don't know yields fewer models, not a throw.
 */
function graphNamModels(graph: NodeGraph | null): NeuralAmpConfig[] {
  const models: NeuralAmpConfig[] = [];
  const readOnly = getNodeGraphReadOnlyVersion(graph) !== null;
  const nodes: unknown = graph?.nodes;
  if (!Array.isArray(nodes)) {
    return models;
  }
  for (const node of nodes) {
    if (
      !(
        isRecord(node) &&
        EFFECT_NODE_TYPES.some((type) => type === node.type) &&
        isRecord(node.data) &&
        isRecord(node.data.effect)
      )
    ) {
      continue;
    }
    try {
      visitEffectTree([node.data.effect as EffectConfig], (effect) => {
        if (effect.type === "neuralAmp") {
          models.push(effect);
        }
      });
    } catch (error) {
      if (!readOnly) {
        throw error;
      }
    }
  }
  return models;
}

function localModels(graph: NodeGraph | null): NeuralAmpConfig[] {
  return graphNamModels(graph).filter(
    (model) =>
      typeof model.modelId === "string" &&
      model.modelId.startsWith("local-nam:")
  );
}

export type NamModelExport = {
  models: NamModelBackup | undefined;
  /** Local models the patch names whose bytes this browser no longer has. */
  missing: string[] | undefined;
};

/**
 * A local model's bytes, or null when this browser has none. A storage
 * error rejects rather than reading as missing.
 */
async function readLocalModel(model: NeuralAmpConfig): Promise<string | null> {
  const id = model.modelId as string;
  const data = model.modelData ?? (await getNamModel(id));
  if (!data) {
    return null;
  }
  try {
    return parseNamModel(model.modelName ?? id, data).modelData;
  } catch {
    return null;
  }
}

/**
 * File backups carry every local model, including unwired and nested FX.
 * One whose bytes are gone is listed as missing rather than failing the
 * backup, so stations, settings and the rest of the patch still export.
 * One that can't be read fails it: the bytes may still be here.
 */
export async function exportNamModels(
  graph: NodeGraph | null
): Promise<NamModelExport> {
  const entries = await Promise.all(
    localModels(graph).map(
      async (model) =>
        [model.modelId as string, await readLocalModel(model)] as const
    )
  );
  const models: NamModelBackup = {};
  const missing = new Set<string>();
  for (const [id, data] of entries) {
    if (data) {
      models[id] = data;
    } else {
      missing.add(id);
    }
  }
  for (const id of Object.keys(models)) {
    missing.delete(id);
  }
  return {
    missing: missing.size > 0 ? [...missing] : undefined,
    models: Object.keys(models).length > 0 ? models : undefined,
  };
}

/** Validate the list of models a backup says it could not carry. */
export function validateMissingNamModels(
  raw: unknown,
  graph: NodeGraph | null
): string[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const referenced = new Set(localModels(graph).map((model) => model.modelId));
  if (
    !(
      Array.isArray(raw) &&
      raw.every((id) => typeof id === "string" && referenced.has(id))
    )
  ) {
    throw new Error("Invalid missing NAM model list");
  }
  return raw.length > 0 ? [...new Set(raw as string[])] : undefined;
}

/**
 * Validate bytes and reference coverage before previewing or applying a
 * backup. A model the backup lists as `missing` may come without bytes.
 */
export function validateNamModelBackup(
  raw: unknown,
  graph: NodeGraph | null,
  missing: readonly string[] = []
): NamModelBackup | undefined {
  if (raw === undefined && missing.length === 0) {
    return undefined;
  }
  if (
    raw !== undefined &&
    (raw === null || typeof raw !== "object" || Array.isArray(raw))
  ) {
    throw new Error("Invalid NAM model backup");
  }
  const referenced = new Set(localModels(graph).map((model) => model.modelId));
  const models: NamModelBackup = {};
  for (const [id, data] of Object.entries(raw ?? {})) {
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
  const absent = new Set(missing);
  for (const model of localModels(graph)) {
    const id = model.modelId as string;
    if (!(model.modelData || models[id] || absent.has(id))) {
      throw new Error(`Missing local NAM model: ${model.modelName ?? id}`);
    }
  }
  return raw === undefined ? undefined : models;
}

export function hasLocalNamModels(graph: NodeGraph | null): boolean {
  return localModels(graph).length > 0;
}

/**
 * Fresh IDs preserve local/Undo assets even when a backup reuses their IDs.
 * Only newly staged models are removed if the following import fails. A
 * model the backup lists as missing, with no bytes here either, loads as
 * an FX without a model.
 */
export async function prepareImportedNamModels(
  graph: NodeGraph,
  backup: NamModelBackup | undefined,
  missing: readonly string[] = []
): Promise<{ graph: NodeGraph; rollback: () => Promise<void> }> {
  const absent = new Set(missing);
  const entries = await Promise.all(
    localModels(graph).map(async (model) => {
      const id = model.modelId as string;
      const bytes = backup?.[id] ?? model.modelData ?? (await getNamModel(id));
      if (!bytes) {
        if (absent.has(id)) {
          return null;
        }
        throw new Error(`Missing local NAM model: ${model.modelName ?? id}`);
      }
      return [
        id,
        parseNamModel(model.modelName ?? id, bytes).modelData,
      ] as const;
    })
  );
  const data = new Map(entries.filter((entry) => entry !== null));
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
      const replacement = replacements.get(model.modelId as string);
      if (!replacement) {
        // Missing from the backup: the FX stays, without a model.
        model.modelName = null;
      }
      model.modelId = replacement ?? null;
      model.modelData = null;
    }
    return { graph: prepared, rollback };
  } catch (error) {
    await rollback();
    throw error;
  }
}
