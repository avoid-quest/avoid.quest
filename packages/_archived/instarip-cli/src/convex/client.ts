import { ConvexHttpClient } from "convex/browser";

export { api } from "@workspace/backend/convex/_generated/api";

const CONVEX_URL: string = process.env.CONVEX_URL ?? "";

function assertConvexUrl(url: string): void {
  if (!url) {
    throw new Error("CONVEX_URL environment variable is required");
  }
}

// Singleton Convex HTTP client for Bun per docs: https://docs.convex.dev/client/javascript/bun
let httpClient: ConvexHttpClient | null = null;
export function getHttpClient(): ConvexHttpClient {
  if (httpClient) {
    return httpClient;
  }
  assertConvexUrl(CONVEX_URL);
  httpClient = new ConvexHttpClient(CONVEX_URL);
  return httpClient;
}
