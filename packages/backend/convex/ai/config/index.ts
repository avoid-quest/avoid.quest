/**
 * AI Configuration
 *
 * Simple Groq configuration - no abstraction, just what we need.
 */

import { createGroq } from "@ai-sdk/groq";
import type { LanguageModel } from "ai";
import { InvalidArgumentError } from "ai";

/**
 * Groq model ID
 * Using moonshotai/kimi-k2-instruct as it supports structured outputs (json_schema)
 * which is required for Convex Agent's generateObject functionality
 */
export const GROQ_MODEL_ID = "moonshotai/kimi-k2-instruct";

/**
 * Model identifier string for storage/logging
 */
export const MODEL_IDENTIFIER = `groq:${GROQ_MODEL_ID}`;

/**
 * Get Groq model instance
 * ONLY works in Action contexts (where process.env is available)
 * @throws {InvalidArgumentError} If API key is missing
 */
export function getGroqModel(): LanguageModel {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length === 0) {
    throw new InvalidArgumentError({
      parameter: "GROQ_API_KEY",
      value: apiKey,
      message: "GROQ_API_KEY environment variable is required but not set.",
    });
  }

  const groq = createGroq({
    apiKey,
  });

  return groq(GROQ_MODEL_ID);
}
