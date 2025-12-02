import { ClientFetchError } from "./error";

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

export async function fetchClientID(): Promise<string> {
  const initial = await fetch("https://soundcloud.com/");
  if (!initial.ok) {
    throw new ClientFetchError(
      `Initial request failed: ${initial.status} ${initial.statusText}`
    );
  }
  const initialBody = await initial.text();
  const results = matchLast(
    initialBody,
    /<script\s+crossorigin\s+src=["'](https?:\/\/[^"']+)["']><\/script>/gi
  );
  if (!results) {
    throw new ClientFetchError("Failed to parse script URL");
  }
  const script = await fetch(results[1]);
  if (!script.ok) {
    throw new ClientFetchError(
      `Script request failed: ${script.status} ${script.statusText}`
    );
  }
  const scriptBody = await script.text();
  const result = scriptBody.match(/\bclient_id:\s*["']([^"']+)["']/i);
  if (!result) {
    throw new ClientFetchError("Failed to parse client ID from script");
  }
  return result[1];
}
