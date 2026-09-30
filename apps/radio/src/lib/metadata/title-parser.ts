const HTML_ENTITY_PATTERN = /&(#\d+|#x[\da-f]+|[a-z][a-z\d]*);/gi;

// HTML 4 names for U+00A0–U+00FF, in code point order.
const LATIN_1_ENTITY_NAMES =
  "nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml".split(
    " "
  );

const HTML_ENTITY_REPLACEMENTS = new Map<string, string>([
  ...LATIN_1_ENTITY_NAMES.map(
    (name, index) => [name, String.fromCharCode(0xa0 + index)] as const
  ),
  ["amp", "&"],
  ["apos", "'"],
  ["bdquo", "„"],
  ["bull", "•"],
  ["dagger", "†"],
  ["euro", "€"],
  ["gt", ">"],
  ["hellip", "…"],
  ["ldquo", "“"],
  ["lsaquo", "‹"],
  ["lsquo", "‘"],
  ["lt", "<"],
  ["mdash", "—"],
  ["nbsp", " "],
  ["ndash", "–"],
  ["OElig", "Œ"],
  ["oelig", "œ"],
  ["permil", "‰"],
  ["quot", '"'],
  ["rdquo", "”"],
  ["rsaquo", "›"],
  ["rsquo", "’"],
  ["sbquo", "‚"],
  ["Scaron", "Š"],
  ["scaron", "š"],
  ["trade", "™"],
  ["Yuml", "Ÿ"],
]);

// Values stations send when a field is unset. Kept deliberately short: a real
// title or genre must never match.
const PLACEHOLDER_VALUES = new Set([
  "",
  "-",
  "various",
  "misc",
  "other",
  "unknown",
  "n/a",
  "none",
  "null",
  "undefined",
  "radio",
  "libretime!",
]);
// Generated mount/account ids such as "78cxy6wkxtzuv": one lowercase token of
// 10+ characters mixing letters and digits.
const GENERATED_SLUG_PATTERN = /^(?=[a-z\d]*[a-z])(?=[a-z\d]*\d)[a-z\d]{10,}$/;
// Icecast mount paths leaking into icy-name, e.g. "/blackout.mp3".
const MOUNT_PATH_PATTERN = /^\/[\w.-]*$/;
// Encoders put "radio" in the artist slot; a song can still be called "Radio".
const ARTIST_ONLY_PLACEHOLDERS = new Set(["radio"]);
const TITLE_LABEL_PATTERN = /^(?:now\s+playing|on\s+air)\s*:\s*/i;
const EDGE_SEPARATOR_PATTERN = /^[\s\-–—]+|[\s\-–—]+$/g;
const TITLE_SEPARATOR_PATTERN = /\s+[-–—]\s+/g;
const WHITESPACE_PATTERN = /\s+/g;
const QUOTE_PAIRS = new Map([
  ['"', '"'],
  ["“", "”"],
  ["„", "“"],
  ["«", "»"],
]);

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
    return (
      HTML_ENTITY_REPLACEMENTS.get(name) ??
      HTML_ENTITY_REPLACEMENTS.get(normalized) ??
      entity
    );
  });
}

export type ParsedRadioTitle = {
  title: string | null;
  artist: string | null;
  rawTitle: string | null;
};

const EMPTY_TITLE: ParsedRadioTitle = {
  artist: null,
  rawTitle: null,
  title: null,
};

/** Decodes HTML entities once, removes NUL padding and trims. */
export function cleanMetadataText(value: string | null | undefined): string {
  return decodeHtmlEntities(value ?? "")
    .replace(/\0/g, "")
    .trim();
}

/**
 * Whether a metadata value carries no information: empty, a value stations
 * send for unset fields ("various", "LibreTime!"), or a generated slug.
 */
export function isPlaceholderMetadataValue(
  value: string | null | undefined
): boolean {
  const text = (value ?? "").trim();
  return (
    PLACEHOLDER_VALUES.has(text.toLowerCase()) ||
    GENERATED_SLUG_PATTERN.test(text) ||
    MOUNT_PATH_PATTERN.test(text)
  );
}

function unwrapQuotes(value: string): string {
  const open = value.at(0) ?? "";
  const close = QUOTE_PAIRS.get(open);
  const inner = value.slice(1, -1);
  return close &&
    value.length >= 2 &&
    value.endsWith(close) &&
    !inner.includes(open) &&
    !inner.includes(close)
    ? inner
    : value;
}

function trimSeparatorsAndQuotes(value: string): string {
  let text = value;
  let next = unwrapQuotes(text.replace(EDGE_SEPARATOR_PATTERN, ""));
  while (next !== text) {
    text = next;
    next = unwrapQuotes(text.replace(EDGE_SEPARATOR_PATTERN, ""));
  }
  return text;
}

function titlePart(
  value: string,
  slot: "artist" | "title" = "title"
): string | null {
  const text = trimSeparatorsAndQuotes(value);
  if (slot === "title" && ARTIST_ONLY_PLACEHOLDERS.has(text.toLowerCase())) {
    return text;
  }
  return isPlaceholderMetadataValue(text) ? null : text;
}

function comparableName(value: string | null | undefined): string {
  return trimSeparatorsAndQuotes(value ?? "")
    .normalize("NFKC")
    .replace(WHITESPACE_PATTERN, " ")
    .toLowerCase();
}

function combineParts(
  artist: string | null,
  title: string | null,
  rawTitle?: string
): ParsedRadioTitle {
  const distinctArtist =
    artist && title && comparableName(artist) === comparableName(title)
      ? null
      : artist;
  const resolvedTitle = title ?? distinctArtist;
  if (!resolvedTitle) {
    return EMPTY_TITLE;
  }
  const resolvedArtist = title ? distinctArtist : null;
  return {
    artist: resolvedArtist,
    rawTitle:
      rawTitle ??
      (resolvedArtist ? `${resolvedArtist} - ${resolvedTitle}` : resolvedTitle),
    title: resolvedTitle,
  };
}

function separators(value: string): RegExpExecArray[] {
  return [...value.matchAll(TITLE_SEPARATOR_PATTERN)];
}

/** Drops a trailing " - Station Name" segment, e.g. "Show - Resonance EXTRA". */
function withoutTrailingStationName(
  value: string,
  stationNames: readonly (string | null | undefined)[]
): string {
  const names = new Set(stationNames.map(comparableName).filter(Boolean));
  const last = separators(value).at(-1);
  if (!(last && names.size > 0)) {
    return value;
  }
  const tail = value.slice(last.index + last[0].length);
  return names.has(comparableName(tail))
    ? trimSeparatorsAndQuotes(value.slice(0, last.index))
    : value;
}

/**
 * Splits a free-form "Artist - Title" string (ICY, SHOUTcast, show names).
 * Only spaced dashes separate; empty or placeholder halves count as missing.
 */
export function parseRadioTitle(
  value: string | null | undefined,
  options: { stationNames?: readonly (string | null | undefined)[] } = {}
): ParsedRadioTitle {
  const rawTitle = trimSeparatorsAndQuotes(
    trimSeparatorsAndQuotes(cleanMetadataText(value)).replace(
      TITLE_LABEL_PATTERN,
      ""
    )
  );
  if (isPlaceholderMetadataValue(rawTitle)) {
    return EMPTY_TITLE;
  }

  const text = withoutTrailingStationName(rawTitle, options.stationNames ?? []);
  const [separator] = separators(text);
  const parsed = separator
    ? combineParts(
        titlePart(text.slice(0, separator.index), "artist"),
        titlePart(text.slice(separator.index + separator[0].length)),
        rawTitle
      )
    : combineParts(null, titlePart(text), rawTitle);
  return parsed.title ? parsed : EMPTY_TITLE;
}

/**
 * Normalizes a provider's separate artist and title fields without
 * re-splitting them, so an artist such as "Simon & Garfunkel - Live" survives.
 */
export function parseRadioTitleParts(input: {
  artist?: string | null;
  title?: string | null;
}): ParsedRadioTitle {
  return combineParts(
    titlePart(cleanMetadataText(input.artist), "artist"),
    titlePart(cleanMetadataText(input.title))
  );
}
