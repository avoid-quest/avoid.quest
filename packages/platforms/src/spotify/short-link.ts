import { parseHttpUrl } from "../url-policy/hostname.js";
import {
  getSpotifyUrl,
  needsSpotifyResolution,
  parseSpotifyRef,
} from "./detect.js";
import { isSpotifyShortLinkHostname } from "./url-policy.js";

const MAX_REDIRECTS = 5;
const MAX_PAGE_BYTES = 256 * 1024;
const TIMEOUT_MS = 10_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const OPEN_SPOTIFY_LINK_PATTERN =
  /https:\/\/open\.spotify\.com\/(?:intl-[\w-]+\/)?(?:track|album|playlist)\/[0-9A-Za-z]{22}/;

export type SpotifyShortLinkOptions = {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
};

const NOT_AN_ITEM_MESSAGE =
  "Spotify short link does not point to a track, album or playlist";

async function readBoundedText(response: Response): Promise<string> {
  if (!response.body) {
    return "";
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    while (bytes < MAX_PAGE_BYTES) {
      // biome-ignore lint/performance/noAwaitInLoops: stream chunks must be read sequentially
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const chunk = value.subarray(0, MAX_PAGE_BYTES - bytes);
      bytes += chunk.byteLength;
      text += decoder.decode(chunk, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return text + decoder.decode();
}

function resolveLocation(location: string | null, base: string): URL | null {
  if (!location) {
    return null;
  }
  try {
    return parseHttpUrl(new URL(location, base).href);
  } catch {
    return null;
  }
}

/** The first `open.spotify.com` item link in a share-link landing page. */
export function findSpotifyLinkInPage(html: string): string | null {
  const match = OPEN_SPOTIFY_LINK_PATTERN.exec(html)?.[0];
  const ref = match ? parseSpotifyRef(match) : null;
  return ref ? getSpotifyUrl(ref) : null;
}

/**
 * Resolves a `spotify.link` share link to a canonical
 * `https://open.spotify.com/<type>/<id>` URL. Server-side only: it reads
 * redirects manually, which browsers hide.
 *
 * The link redirects to `spotify.app.link`, which either redirects to
 * `open.spotify.com` or serves a landing page that links to it.
 */
export async function resolveSpotifyShortLink(
  url: string,
  { fetchImpl = fetch, signal }: SpotifyShortLinkOptions = {}
): Promise<string> {
  if (!needsSpotifyResolution(url)) {
    throw new Error("Invalid Spotify short link");
  }
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)])
    : AbortSignal.timeout(TIMEOUT_MS);

  let current = url.trim();
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: each hop depends on the previous Location
    const response = await fetchImpl(current, {
      headers: { accept: "text/html" },
      redirect: "manual",
      signal: requestSignal,
    });

    if (REDIRECT_STATUSES.has(response.status)) {
      await response.body?.cancel().catch(() => undefined);
      const next = resolveLocation(response.headers.get("location"), current);
      if (!next) {
        throw new Error("Spotify short link redirect has no valid location");
      }
      const ref = parseSpotifyRef(next.href);
      if (ref) {
        return getSpotifyUrl(ref);
      }
      if (
        !(
          next.protocol === "https:" &&
          isSpotifyShortLinkHostname(next.hostname)
        )
      ) {
        throw new Error(NOT_AN_ITEM_MESSAGE);
      }
      current = next.href;
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(
        `Failed to resolve Spotify short link: HTTP ${response.status}`
      );
    }
    const resolved = findSpotifyLinkInPage(await readBoundedText(response));
    if (!resolved) {
      throw new Error(NOT_AN_ITEM_MESSAGE);
    }
    return resolved;
  }

  throw new Error("Spotify short link redirected too many times");
}
