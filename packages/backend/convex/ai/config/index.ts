/**
 * Centralized AI Configuration
 *
 * Single source of truth for AI model configuration.
 */

import type { LanguageModel } from "ai";
import type { FunctionReference, FunctionReturnType } from "convex/server";
import { internal } from "../../_generated/api";
import type { Doc } from "../../_generated/dataModel";
import { DEFAULT_MODEL_ID, type ModelId, parseModelId } from "./models";
import { createProvider, type ProviderName } from "./providers";

/**
 * Model selection result
 */
export type AIModelResult = {
  model: LanguageModel;
  provider: ProviderName;
  modelId: string;
  displayName: string;
};

/**
 * Context interface for running queries
 * Compatible with both ActionCtx and WorkflowStep
 * WorkflowStep only accepts internal queries, so we restrict to internal
 */
type QueryRunner = {
  runQuery<Query extends FunctionReference<"query", "internal">>(
    query: Query,
    ...args: unknown[]
  ): Promise<FunctionReturnType<Query>>;
};

/**
 * Get AI model from settings or use defaults
 */
export async function getAIModelFromSettings(
  ctx: QueryRunner
): Promise<AIModelResult> {
  const settings = (await ctx.runQuery(
    internal.settings.getSettingsInternal
  )) as Doc<"settings"> | null;
  const modelString =
    settings?.ai_metadata_extraction?.model ?? DEFAULT_MODEL_ID;
  return getAIModel(modelString);
}

/**
 * Get AI model instance based on model identifier
 */
export function getAIModel(modelString?: string | null): AIModelResult {
  const { modelId } = parseModelId(modelString);
  const provider: ProviderName = "groq";
  const providerInstance = createProvider();
  const model = providerInstance(modelId as ModelId);

  return {
    model,
    provider,
    modelId,
    displayName: `${modelId} (${provider})`,
  };
}

/**
 * Get model identifier string for storage
 */
export function getModelIdentifier(result: AIModelResult): string {
  return `${result.provider}:${result.modelId}`;
}
