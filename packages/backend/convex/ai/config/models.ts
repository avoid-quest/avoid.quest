/**
 * AI Model Configuration
 *
 * Type-safe model IDs from Groq provider.
 */

import type { groq } from "@ai-sdk/groq";

// Extract model ID type from Groq provider
export type ModelId = Parameters<typeof groq>[0];

/**
 * Default model ID
 * Using moonshotai/kimi-k2-instruct as it supports structured outputs (json_schema)
 * which is required for Convex Agent's generateObject functionality
 *
 * Note: Not all Groq models support json_schema. Only moonshotai/kimi-k2-instruct
 * is confirmed to support structured outputs based on Groq documentation.
 */
export const DEFAULT_MODEL_ID: ModelId = "moonshotai/kimi-k2-instruct";

/**
 * Parse model identifier string
 * Supports "provider:model-id" or just "model-id" format
 */
export function parseModelId(modelString: string | undefined | null): {
  provider: "groq" | null;
  modelId: string;
} {
  if (!modelString) {
    return { provider: null, modelId: DEFAULT_MODEL_ID };
  }

  // Check if it's in "provider:model-id" format
  const colonIndex = modelString.indexOf(":");
  if (colonIndex > 0) {
    const modelId = modelString.substring(colonIndex + 1);
    return { provider: "groq", modelId };
  }

  return { provider: null, modelId: modelString };
}
