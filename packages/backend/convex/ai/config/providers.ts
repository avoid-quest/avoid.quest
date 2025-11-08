/**
 * AI Provider Configuration
 *
 * Groq provider factory.
 */

import { groq } from "@ai-sdk/groq";

export type ProviderName = "groq";

/**
 * Create Groq provider instance
 * Reads API key from GROQ_API_KEY environment variable
 */
export function createProvider(apiKey?: string): typeof groq {
  const key = apiKey ?? process.env.GROQ_API_KEY;
  if (!key) {
    throw new Error(
      "GROQ_API_KEY environment variable is required for Groq provider"
    );
  }
  // Groq provider reads from GROQ_API_KEY env var automatically
  if (apiKey && !process.env.GROQ_API_KEY) {
    process.env.GROQ_API_KEY = apiKey;
  }
  return groq;
}
