/**
 * Runtime patch for undici in Cloudflare Workers
 * This patches the global module cache to replace undici with our stub
 */

import * as undiciStub from "../stubs/undici";

// Patch the module cache if we're in a Node-like environment
if (typeof globalThis !== "undefined") {
  // Try to patch require.cache if it exists (Node.js)
  if (
    typeof require !== "undefined" &&
    require.cache &&
    typeof require.cache === "object"
  ) {
    const undiciPath = require.resolve("undici");
    if (undiciPath) {
      require.cache[undiciPath] = {
        id: undiciPath,
        exports: undiciStub,
        loaded: true,
      };
    }
  }

  // Also try to patch import.meta.resolve if available
  // This is a more modern approach
  if (typeof globalThis.undici === "undefined") {
    (globalThis as { undici?: typeof undiciStub }).undici = undiciStub;
  }
}

export {};

