/**
 * Playlist Parser
 *
 * Parses M3U, M3U8, and PLS playlist formats.
 */

export type ParsedPlaylistTrack = {
  title: string;
  url: string;
  duration?: number;
};

export type ParsedPlaylist = {
  format: "m3u" | "pls";
  name?: string;
  tracks: ParsedPlaylistTrack[];
};

// Top-level regex patterns for performance
const LINE_SPLIT_RE = /\r?\n/;
const PLS_FILE_RE = /^file(\d+)$/;
const PLS_TITLE_RE = /^title(\d+)$/;
const PLS_LENGTH_RE = /^length(\d+)$/;
const SEPARATOR_RE = /[_-]+/g;

/**
 * Resolve a potentially relative URL against a base URL
 */
function resolveUrl(url: string, baseUrl?: string): string {
  // Already absolute
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }

  // No base to resolve against
  if (!baseUrl) {
    return url;
  }

  try {
    return new URL(url, baseUrl).href;
  } catch {
    return url;
  }
}

/**
 * Extract filename from a path/URL for fallback title
 */
function getFilenameFromPath(path: string): string {
  try {
    const url = new URL(path);
    const { pathname } = url;
    const lastSlash = pathname.lastIndexOf("/");
    const filename =
      lastSlash === -1 ? pathname : pathname.slice(lastSlash + 1);
    const lastDot = filename.lastIndexOf(".");
    const name = lastDot === -1 ? filename : filename.slice(0, lastDot);
    return (
      decodeURIComponent(name).replace(SEPARATOR_RE, " ").trim() ||
      "Unknown Track"
    );
  } catch {
    // Not a URL, try as path
    const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    const filename = lastSlash === -1 ? path : path.slice(lastSlash + 1);
    const lastDot = filename.lastIndexOf(".");
    const name = lastDot === -1 ? filename : filename.slice(0, lastDot);
    return name.replace(SEPARATOR_RE, " ").trim() || "Unknown Track";
  }
}

/**
 * Parse an M3U or M3U8 playlist
 *
 * Format:
 * #EXTM3U
 * #EXTINF:duration,title
 * url
 */
export function parseM3U(content: string, baseUrl?: string): ParsedPlaylist {
  const lines = content.split(LINE_SPLIT_RE).filter((line) => line.trim());
  const tracks: ParsedPlaylistTrack[] = [];

  let currentTitle = "";
  let currentDuration: number | undefined;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip header
    if (trimmed === "#EXTM3U") {
      continue;
    }

    // Parse extended info
    if (trimmed.startsWith("#EXTINF:")) {
      const info = trimmed.slice(8);
      const commaIndex = info.indexOf(",");

      if (commaIndex === -1) {
        currentTitle = info.trim();
      } else {
        const durationStr = info.slice(0, commaIndex).trim();
        const duration = Number.parseInt(durationStr, 10);
        currentDuration =
          Number.isNaN(duration) || duration < 0 ? undefined : duration;
        currentTitle = info.slice(commaIndex + 1).trim();
      }
      continue;
    }

    // Skip other directives
    if (trimmed.startsWith("#")) {
      continue;
    }

    // This is a URL line
    const url = resolveUrl(trimmed, baseUrl);
    tracks.push({
      duration: currentDuration,
      title: currentTitle || getFilenameFromPath(url),
      url,
    });

    // Reset for next track
    currentTitle = "";
    currentDuration = undefined;
  }

  return {
    format: "m3u",
    tracks,
  };
}

type PLSEntry = { url?: string; title?: string; duration?: number };

/**
 * Parse a single PLS key-value line and update entries map
 */
function parsePLSLine(
  key: string,
  value: string,
  entries: Map<number, PLSEntry>,
  baseUrl?: string
): void {
  const fileMatch = key.match(PLS_FILE_RE);
  if (fileMatch) {
    const index = Number.parseInt(fileMatch[1], 10);
    const entry = entries.get(index) ?? {};
    entry.url = resolveUrl(value, baseUrl);
    entries.set(index, entry);
    return;
  }

  const titleMatch = key.match(PLS_TITLE_RE);
  if (titleMatch) {
    const index = Number.parseInt(titleMatch[1], 10);
    const entry = entries.get(index) ?? {};
    entry.title = value;
    entries.set(index, entry);
    return;
  }

  const lengthMatch = key.match(PLS_LENGTH_RE);
  if (lengthMatch) {
    const index = Number.parseInt(lengthMatch[1], 10);
    const entry = entries.get(index) ?? {};
    const duration = Number.parseInt(value, 10);
    entry.duration =
      Number.isNaN(duration) || duration < 0 ? undefined : duration;
    entries.set(index, entry);
  }
}

/**
 * Parse a PLS playlist
 *
 * Format:
 * [playlist]
 * File1=url
 * Title1=title
 * Length1=duration
 * NumberOfEntries=n
 */
export function parsePLS(content: string, baseUrl?: string): ParsedPlaylist {
  const lines = content.split(LINE_SPLIT_RE).filter((line) => line.trim());
  const entries: Map<number, PLSEntry> = new Map();

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip section header and comments
    if (trimmed.startsWith("[") || trimmed.startsWith(";")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).toLowerCase();
    const value = trimmed.slice(equalsIndex + 1);

    parsePLSLine(key, value, entries, baseUrl);
  }

  // Convert to array, sorted by index
  const tracks: ParsedPlaylistTrack[] = [];
  const sortedIndices = [...entries.keys()].sort((a, b) => a - b);

  for (const index of sortedIndices) {
    const entry = entries.get(index);
    if (entry?.url) {
      tracks.push({
        duration: entry.duration,
        title: entry.title || getFilenameFromPath(entry.url),
        url: entry.url,
      });
    }
  }

  return {
    format: "pls",
    tracks,
  };
}

/**
 * Auto-detect playlist format and parse
 */
export function parsePlaylist(
  content: string,
  baseUrl?: string
): ParsedPlaylist {
  const trimmed = content.trim();

  // PLS starts with [playlist]
  if (trimmed.toLowerCase().startsWith("[playlist]")) {
    return parsePLS(content, baseUrl);
  }

  // Default to M3U
  return parseM3U(content, baseUrl);
}
