/**
 * Cloudflare Workers-compatible fetch wrapper
 * Strips out Node.js-specific options that aren't supported in Workers
 */

const originalFetch = globalThis.fetch;

/**
 * Wraps fetch to remove unsupported options for Cloudflare Workers
 * Specifically removes ALPNProtocols and other Node.js-specific options
 */
export function createWorkersCompatibleFetch(): typeof fetch {
  return async function workersFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    // Clone init to avoid mutating the original
    const cleanedInit: RequestInit | undefined = init
      ? { ...init }
      : undefined;

    // Remove unsupported options
    if (cleanedInit) {
      // Remove ALPNProtocols and other Node.js-specific options
      // These are typically in a nested options object or as direct properties
      const unsupportedKeys = [
        'ALPNProtocols',
        'keepAlive',
        'keepAliveMsecs',
        'keepAliveTimeout',
        'maxSockets',
        'maxFreeSockets',
        'scheduling',
        'family',
        'hints',
        'lookup',
        'localAddress',
        'localPort',
        'rejectUnauthorized',
        'servername',
        'session',
        'timeout',
      ];

      // Clean up the init object
      for (const key of unsupportedKeys) {
        if (key in cleanedInit) {
          delete (cleanedInit as Record<string, unknown>)[key];
        }
      }

      // Also check if there's a nested options object (undici might use this)
      if (
        'options' in cleanedInit &&
        typeof cleanedInit.options === 'object' &&
        cleanedInit.options !== null
      ) {
        const options = cleanedInit.options as Record<string, unknown>;
        for (const key of unsupportedKeys) {
          if (key in options) {
            delete options[key];
          }
        }
      }
    }

    return originalFetch(input, cleanedInit);
  };
}

/**
 * Patches the global fetch to be Workers-compatible
 * Call this before importing packages that use undici
 */
export function patchGlobalFetch(): void {
  if (typeof globalThis !== 'undefined') {
    globalThis.fetch = createWorkersCompatibleFetch();
  }
}

