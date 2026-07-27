import type { EffectConfig } from "./types.js";

const DATABASE_NAME = "avoid-quest-audio-models";
const STORE_NAME = "nam-models";
const LOCAL_NAM_PREFIX = "local-nam:";
const cache = new Map<string, string>();
let databasePromise: Promise<IDBDatabase> | null = null;

export type LocalNamModelMetadata = {
  modelData: null;
  modelId: string;
  modelName: string;
  modelUrl: null;
};

function openDatabase(): Promise<IDBDatabase> | null {
  if (typeof indexedDB === "undefined") {
    return null;
  }
  databasePromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return databasePromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function createLocalNamModelId(): string {
  return `${LOCAL_NAM_PREFIX}${crypto.randomUUID()}`;
}

export function parseNamModel(
  modelName: string,
  modelData: string
): { modelData: string; modelName: string } {
  const parsed = JSON.parse(modelData) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("NAM model must contain a JSON object.");
  }
  return { modelName, modelData };
}

export async function ingestLocalNamModel(
  modelName: string,
  modelData: string
): Promise<LocalNamModelMetadata> {
  const model = parseNamModel(modelName, modelData);
  const modelId = createLocalNamModelId();
  await saveNamModel(modelId, model.modelData);
  return {
    modelData: null,
    modelId,
    modelName: model.modelName,
    modelUrl: null,
  };
}

export function collectLocalNamModelIds(
  effects: readonly EffectConfig[]
): Set<string> {
  const modelIds = new Set<string>();
  const visit = (current: readonly EffectConfig[]): void => {
    for (const effect of current) {
      if (
        effect.type === "neuralAmp" &&
        effect.modelId?.startsWith(LOCAL_NAM_PREFIX)
      ) {
        modelIds.add(effect.modelId);
      }
      if ("chains" in effect) {
        for (const chain of effect.chains) {
          visit(chain.effects);
        }
      }
    }
  };
  visit(effects);
  return modelIds;
}

export async function deleteUnreferencedNamModels(
  candidates: Iterable<string>,
  referenced: ReadonlySet<string>
): Promise<void> {
  await Promise.all(
    [...new Set(candidates)]
      .filter(
        (modelId) =>
          modelId.startsWith(LOCAL_NAM_PREFIX) && !referenced.has(modelId)
      )
      .map(deleteNamModel)
  );
}

export function getCachedNamModel(modelId: string | null): string | null {
  return modelId ? (cache.get(modelId) ?? null) : null;
}

export async function getNamModel(
  modelId: string | null
): Promise<string | null> {
  if (!modelId) {
    return null;
  }
  const cached = cache.get(modelId);
  if (cached) {
    return cached;
  }
  const database = await openDatabase();
  if (!database) {
    return null;
  }
  const model = await requestResult(
    database.transaction(STORE_NAME).objectStore(STORE_NAME).get(modelId)
  );
  if (typeof model !== "string") {
    return null;
  }
  cache.set(modelId, model);
  return model;
}

export async function saveNamModel(
  modelId: string,
  modelData: string
): Promise<void> {
  cache.set(modelId, modelData);
  const database = await openDatabase();
  if (!database) {
    return;
  }
  try {
    await requestResult(
      database
        .transaction(STORE_NAME, "readwrite")
        .objectStore(STORE_NAME)
        .put(modelData, modelId)
    );
  } catch (error) {
    cache.delete(modelId);
    throw error;
  }
}

export async function deleteNamModel(modelId: string | null): Promise<void> {
  if (!modelId) {
    return;
  }
  cache.delete(modelId);
  const database = await openDatabase();
  if (database) {
    await requestResult(
      database
        .transaction(STORE_NAME, "readwrite")
        .objectStore(STORE_NAME)
        .delete(modelId)
    );
  }
}
