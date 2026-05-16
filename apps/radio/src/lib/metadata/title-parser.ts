const EMPTY_TITLES = new Set(["", "-", "unknown"]);

export type ParsedRadioTitle = {
  title: string | null;
  artist: string | null;
  rawTitle: string | null;
};

export function cleanMetadataText(value: string | null | undefined): string {
  return (value ?? "").replace(/\0/g, "").trim();
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
    return { title: null, artist: null, rawTitle: null };
  }

  const separatorIndex = rawTitle.indexOf(" - ");
  if (separatorIndex > 0) {
    const artist = cleanMetadataText(rawTitle.slice(0, separatorIndex));
    const title = cleanMetadataText(rawTitle.slice(separatorIndex + 3));
    if (artist && title) {
      return { title, artist, rawTitle };
    }
  }

  return { title: rawTitle, artist: null, rawTitle };
}
