import { ClientFetchError } from "./error.js";

const SCRIPT_URL_PATTERN =
  /<script\s+crossorigin\s+src=["'](https?:\/\/[^"']+)["']><\/script>/gi;
const CLIENT_ID_PATTERN = /\bclient_id:\s*["']([^"']+)["']/i;

function matchLast(str: string, pattern: RegExp): RegExpMatchArray | null {
  let current: RegExpMatchArray | null;
  let last: RegExpMatchArray | null = null;
  do {
    current = pattern.exec(str);
    if (current) {
      last = current;
    }
  } while (current);
  return last;
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  errorMessage: string
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ClientFetchError(errorMessage, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchClientID(): Promise<string> {
  const initial = await fetchWithTimeout(
    "https://soundcloud.com/",
    5000,
    "Initial request timed out after 5 seconds"
  );
  if (!initial.ok) {
    throw new ClientFetchError(
      `Initial request failed: ${initial.status} ${initial.statusText}`
    );
  }
  const initialBody = await initial.text();
  const results = matchLast(initialBody, SCRIPT_URL_PATTERN);
  const scriptUrl = results?.[1];
  if (!scriptUrl) {
    throw new ClientFetchError("Failed to parse script URL");
  }
  const script = await fetchWithTimeout(
    scriptUrl,
    5000,
    "Script request timed out after 5 seconds"
  );
  if (!script.ok) {
    throw new ClientFetchError(
      `Script request failed: ${script.status} ${script.statusText}`
    );
  }
  const scriptBody = await script.text();
  const result = scriptBody.match(CLIENT_ID_PATTERN);
  const clientId = result?.[1];
  if (!clientId) {
    throw new ClientFetchError("Failed to parse client ID from script");
  }
  return clientId;
}
