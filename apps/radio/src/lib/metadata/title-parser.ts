const EMPTY_TITLES = new Set(["", "-", "unknown"]);

const HTML_ENTITY_PATTERN = /&(#\d+|#x[\da-f]+|amp|lt|gt|quot|apos);/gi;
const HTML_ENTITY_REPLACEMENTS: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  quot: '"',
};

function decodeCodePoint(codePoint: number, fallback: string): string {
  return Number.isInteger(codePoint) &&
    codePoint >= 0 &&
    codePoint <= 0x10_ff_ff
    ? String.fromCodePoint(codePoint)
    : fallback;
}

function decodeHtmlEntities(value: string): string {
  return value.replace(HTML_ENTITY_PATTERN, (entity, name: string) => {
    const normalized = name.toLowerCase();
    if (normalized.startsWith("#x")) {
      return decodeCodePoint(Number.parseInt(normalized.slice(2), 16), entity);
    }
    if (normalized.startsWith("#")) {
      return decodeCodePoint(Number.parseInt(normalized.slice(1), 10), entity);
    }
    return HTML_ENTITY_REPLACEMENTS[normalized] ?? entity;
  });
}

export type ParsedRadioTitle = {
  title: string | null;
  artist: string | null;
  rawTitle: string | null;
};

export function cleanMetadataText(value: string | null | undefined): string {
  return decodeHtmlEntities(value ?? "")
    .replace(/\0/g, "")
    .trim();
}

export function normalizeRawTitle(
  value: string | null | undefined
): string | null {
  const cleaned = cleanMetadataText(value);
  return EMPTY_TITLES.has(cleaned.toLowerCase()) ? null : cleaned;
}

export function parseRadioTitle(
  value: string | null | undefined
): ParsedRadioTitle {
  const rawTitle = normalizeRawTitle(value);
  if (!rawTitle) {
    return { artist: null, rawTitle: null, title: null };
  }

  const separatorIndex = rawTitle.indexOf(" - ");
  if (separatorIndex > 0) {
    const artist = cleanMetadataText(rawTitle.slice(0, separatorIndex));
    const title = cleanMetadataText(rawTitle.slice(separatorIndex + 3));
    if (artist && title) {
      return { artist, rawTitle, title };
    }
  }

  return { artist: null, rawTitle, title: rawTitle };
}
