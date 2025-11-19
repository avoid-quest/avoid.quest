/**
 * Stub for undici - provides a minimal fetch-compatible implementation
 * for Cloudflare Workers that uses the standard fetch API
 */

// Log to verify this stub module is being loaded
if (typeof console !== "undefined" && console.log) {
  console.log("[undici-stub] Stub module loaded");
}

// Workers-compatible fetch that strips unsupported options
function workersFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  // Remove unsupported Node.js-specific options
  const cleanedInit: RequestInit | undefined = init ? { ...init } : undefined;

  if (cleanedInit) {
    // Remove ALPNProtocols and other Node.js-specific options
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

    for (const key of unsupportedKeys) {
      if (key in cleanedInit) {
        delete (cleanedInit as Record<string, unknown>)[key];
      }
    }

    // Also check nested options object
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

  return globalThis.fetch(input, cleanedInit);
}

// Export fetch using the cleaned version
export const fetch = workersFetch;

// Stub for undici's Agent class - must have request method
export class Agent {
  request(url: string | URL, options?: RequestInit): Promise<Response> {
    return workersFetch(url, options);
  }

  dispatch(_options: unknown, _handler: unknown): Promise<void> {
    // Stub implementation
    return Promise.resolve();
  }

  close(): Promise<void> {
    // Stub implementation
    return Promise.resolve();
  }

  destroy(): Promise<void> {
    // Stub implementation
    return Promise.resolve();
  }
}

// Stub for undici's Client class - must have request method
export class Client {
  request(url: string | URL, options?: RequestInit): Promise<Response> {
    return workersFetch(url, options);
  }

  dispatch(_options: unknown, _handler: unknown): Promise<void> {
    // Stub implementation
    return Promise.resolve();
  }

  close(): Promise<void> {
    // Stub implementation
    return Promise.resolve();
  }

  destroy(): Promise<void> {
    // Stub implementation
    return Promise.resolve();
  }
}

// Stub for undici's Pool class - must have request method
export class Pool {
  request(url: string | URL, options?: RequestInit): Promise<Response> {
    return workersFetch(url, options);
  }

  dispatch(_options: unknown, _handler: unknown): Promise<void> {
    // Stub implementation
    return Promise.resolve();
  }

  close(): Promise<void> {
    // Stub implementation
    return Promise.resolve();
  }

  destroy(): Promise<void> {
    // Stub implementation
    return Promise.resolve();
  }
}

// Stub for undici's ProxyAgent class (not used in Workers)
export class ProxyAgent {
  constructor() {
    // Empty stub
  }
}

// Stub for undici's BalancedPool class (not used in Workers)
export class BalancedPool {
  constructor() {
    // Empty stub
  }
}

// Stub for getGlobalDispatcher - returns a minimal dispatcher-like object
export function getGlobalDispatcher() {
  return {
    dispatch: (options: unknown, handler: unknown) => {
      // Stub implementation - not used in Workers
      return Promise.resolve();
    },
  };
}

// Stub for getAgent - returns an Agent instance
export function getAgent(): Agent {
  // Log to verify this stub is being used
  if (typeof console !== "undefined" && console.log) {
    console.log("[undici-stub] getAgent() called - using stub implementation");
  }
  const agent = new Agent();
  // Ensure the agent has the request method
  if (!agent.request) {
    throw new Error("Agent instance missing request method");
  }
  return agent;
}

// Stub for setGlobalDispatcher - no-op in Workers
export function setGlobalDispatcher(_dispatcher: unknown) {
  // No-op in Workers
}

// Stub for request - uses our cleaned fetch
export function request(
  url: string | URL,
  options?: RequestInit
): Promise<Response> {
  return workersFetch(url, options);
}

// Stub for stream - uses our cleaned fetch
export function stream(
  url: string | URL,
  options?: RequestInit
): Promise<ReadableStream> {
  return workersFetch(url, options).then((response) => response.body || new ReadableStream());
}

// Stub for pipeline - not used in Workers
export function pipeline(
  _source: unknown,
  _destination: unknown,
  _callback?: unknown
): Promise<void> {
  return Promise.resolve();
}

// Stub for connect - not used in Workers
export function connect(_url: string | URL, _options?: unknown): Promise<unknown> {
  return Promise.resolve({});
}

// Stub for upgrade - not used in Workers
export function upgrade(_url: string | URL, _options?: unknown): Promise<unknown> {
  return Promise.resolve({});
}

// Export a default object with the cleaned fetch
export default {
  fetch: workersFetch,
  request,
  stream,
  pipeline,
  connect,
  upgrade,
  Agent,
  Client,
  Pool,
  ProxyAgent,
  BalancedPool,
  getGlobalDispatcher,
  setGlobalDispatcher,
  getAgent,
};

