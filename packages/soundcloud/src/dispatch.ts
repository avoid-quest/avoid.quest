/** biome-ignore-all lint/suspicious/useAwait: original lib */
import { getClientID, getOauthToken } from "./auth";
import { Queue } from "./queue";
import { RequestError, ScdlError } from "./utils/error";

const DEFAULT_TIMEOUT = 30_000;
const queue = new Queue();
let requestTimeout: number | null = null;

/**
 * Set the agent to use for requests
 *
 * No-op for Cloudflare Workers compatibility (fetch doesn't need a dispatcher)
 */
export function setAgent(_agent: unknown): void {
  // No-op: fetch API doesn't use agents
}

/**
 * Get the currently set agent
 *
 * Returns null for Cloudflare Workers compatibility
 */
export function getAgent(): null {
  return null;
}

/**
 * Set the timeout for requests in milliseconds
 *
 * Defaults to 30000 ms
 */
export function setRequestTimeout(timeout: number): void {
  requestTimeout = timeout;
}

/**
 * Get the timeout for requests in milliseconds
 */
export function getRequestTimeout(): number {
  return requestTimeout ?? DEFAULT_TIMEOUT;
}

/**
 * Create a timeout controller for fetch requests
 */
function createTimeoutController(timeout: number): AbortController {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeout);
  return controller;
}

/**
 * Response wrapper to match the expected interface
 */
interface ResponseWrapper {
  statusCode: number;
  body: {
    json(): Promise<any>;
    text(): Promise<string>;
  };
}

/**
 * Perform a GET request using fetch API
 */
export async function request(url: URL): Promise<ResponseWrapper> {
  await queue.enqueue();
  try {
    const timeout = getRequestTimeout();
    const controller = createTimeoutController(timeout);
    
    const response = await fetch(url.toString(), {
      method: "GET",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new RequestError(response.status);
    }

    // Create a wrapper that matches the expected interface
    const body = {
      json: async () => response.json(),
      text: async () => response.text(),
    };

    return {
      statusCode: response.status,
      body,
    };
  } finally {
    queue.dequeue();
  }
}

/**
 * Perform a GET request with authentication and parse as JSON
 */
export async function requestWithAuth(url: string | URL): Promise<any> {
  const parsedUrl = new URL(url);
  switch (true) {
    case !!getOauthToken():
      parsedUrl.searchParams.set("oauth_token", getOauthToken()!);
      break;
    case !!getClientID():
      parsedUrl.searchParams.set("client_id", getClientID()!);
      break;
    default:
      throw new ScdlError("Authentication not set");
  }
  parsedUrl.hash = "";
  const { body } = await request(parsedUrl);
  return body.json();
}

/**
 * Perform a GET request and output to an existing stream
 *
 * Stub implementation for Cloudflare Workers compatibility
 * Not used by the app - only needed for transcoding URL extraction
 * @param url The URL perform a request to
 * @param output The stream to write to
 * @param end Whether to end the writer on completion
 * @returns The output stream
 */
export async function streamThrough(
  url: URL,
  output: { emit: (event: string, ...args: any[]) => boolean; end: () => void; write: (chunk: any) => boolean },
  end = true
): Promise<{ emit: (event: string, ...args: any[]) => boolean; end: () => void; write: (chunk: any) => boolean }> {
  await queue.enqueue();
  try {
    const timeout = getRequestTimeout();
    const controller = createTimeoutController(timeout);
    
    const response = await fetch(url.toString(), {
      method: "GET",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new RequestError(response.status);
    }

    output.emit("connect");
    
    if (!response.body) {
      throw new Error("Response body is null");
    }

    const reader = response.body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        output.write(value);
      }
    } finally {
      reader.releaseLock();
    }

    if (end) {
      output.end();
    }

    return output;
  } finally {
    queue.dequeue();
  }
}
