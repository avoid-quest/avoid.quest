import type { BandcampSearchResult } from "../bandcamp/search.js";
import type { BandcampMetadata } from "../bandcamp/types.js";
import type { RadioGardenSearchResult } from "../radiogarden/types.js";
import type { SoundCloudSearchResult } from "../soundcloud/search.js";
import type { SoundCloudMetadata } from "../soundcloud/types.js";
import { isLoopbackHttpUrl, isPublicHttpUrl } from "../url-policy/index.js";
import { ResolverAdapterError } from "./errors.js";
import { sanitizeResolverId } from "./identity.js";
import {
  isResolverCapability,
  type ResolverManifest,
  type ResolverProvider,
  type ResolverResolution,
  type ResolverSearchResultMap,
  type ResolverStreamFormat,
} from "./types.js";

type UnknownRecord = Record<string, unknown>;

const BANDCAMP_ITEM_TYPES = new Set([
  "album",
  "artist",
  "collection",
  "label",
  "track",
]);
const BANDCAMP_SEARCH_TYPES = new Set(["album", "artist", "track"]);
const SOUNDCLOUD_ITEM_TYPES = new Set(["playlist", "track", "user"]);
const RESOLVER_STREAM_FORMATS = new Set<ResolverStreamFormat>([
  "hls",
  "progressive",
]);
const RELATIVE_STREAM_BASE_URL = "https://app.invalid";

export type ResolverResponseParserOptions = {
  allowLoopbackUrls?: boolean;
  allowRelativeStreamUrls?: boolean;
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNonEmptyString(value: unknown): value is string {
  return isString(value) && value.trim().length > 0;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || isString(value);
}

function isFiniteNonNegativeNumber(
  value: unknown
): value is number | undefined {
  return (
    value === undefined ||
    (typeof value === "number" && Number.isFinite(value) && value >= 0)
  );
}

function isAllowedUrl(
  value: unknown,
  options: ResolverResponseParserOptions
): value is string {
  if (!isNonEmptyString(value)) {
    return false;
  }
  return (
    isPublicHttpUrl(value) ||
    (options.allowLoopbackUrls === true && isLoopbackHttpUrl(value))
  );
}

function isAllowedStreamUrl(
  value: unknown,
  options: ResolverResponseParserOptions
): value is string {
  if (!isNonEmptyString(value)) {
    return false;
  }
  if (options.allowRelativeStreamUrls === true && value.startsWith("/")) {
    try {
      if (
        new URL(value, RELATIVE_STREAM_BASE_URL).origin ===
        RELATIVE_STREAM_BASE_URL
      ) {
        return true;
      }
    } catch {
      return false;
    }
  }
  return isAllowedUrl(value, options);
}

function isOptionalAllowedUrl(
  value: unknown,
  options: ResolverResponseParserOptions
): value is string | undefined {
  return value === undefined || value === "" || isAllowedUrl(value, options);
}

function isResolverStreamFormat(
  value: unknown
): value is ResolverStreamFormat | undefined {
  return (
    value === undefined ||
    (typeof value === "string" &&
      RESOLVER_STREAM_FORMATS.has(value as ResolverStreamFormat))
  );
}

function schemaError(adapterId: string): ResolverAdapterError {
  return new ResolverAdapterError(
    "Resolver response has an unexpected schema",
    { adapterId, code: "invalid-schema" }
  );
}

export function parseResolverManifest(
  value: unknown,
  adapterId: string
): ResolverManifest {
  if (
    !isRecord(value) ||
    value.protocol !== "avoid-radio-resolver" ||
    value.version !== 1 ||
    !isNonEmptyString(value.name) ||
    !Array.isArray(value.capabilities) ||
    !value.capabilities.every(isResolverCapability) ||
    new Set(value.capabilities).size !== value.capabilities.length
  ) {
    throw schemaError(adapterId);
  }
  return value as ResolverManifest;
}

function isBandcampSearchResult(
  value: unknown,
  options: ResolverResponseParserOptions
): value is BandcampSearchResult {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.type) &&
    BANDCAMP_SEARCH_TYPES.has(value.type) &&
    isString(value.title) &&
    isString(value.artist) &&
    isAllowedUrl(value.url, options) &&
    isOptionalAllowedUrl(value.thumbnail, options) &&
    isOptionalString(value.albumTitle)
  );
}

function isSoundCloudSearchResult(
  value: unknown,
  options: ResolverResponseParserOptions
): value is SoundCloudSearchResult {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.id) &&
    isString(value.title) &&
    isString(value.artist) &&
    isAllowedUrl(value.url, options) &&
    isFiniteNonNegativeNumber(value.duration) &&
    value.duration !== undefined &&
    isOptionalAllowedUrl(value.thumbnail, options)
  );
}

function isRadioGardenSearchResult(
  value: unknown,
  options: ResolverResponseParserOptions
): value is RadioGardenSearchResult {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.channelId) &&
    isString(value.title) &&
    isString(value.subtitle) &&
    isAllowedUrl(value.url, options) &&
    isOptionalAllowedUrl(value.website, options) &&
    isString(value.placeTitle) &&
    isString(value.countryTitle)
  );
}

export function parseResolverSearchResults<P extends ResolverProvider>(
  provider: P,
  value: unknown,
  adapterId: string,
  options: ResolverResponseParserOptions = {}
): ResolverSearchResultMap[P] {
  if (!Array.isArray(value)) {
    throw schemaError(adapterId);
  }
  const valid = (() => {
    switch (provider) {
      case "bandcamp":
        return value.every((result) => isBandcampSearchResult(result, options));
      case "radiogarden":
        return value.every((result) =>
          isRadioGardenSearchResult(result, options)
        );
      case "soundcloud":
        return value.every((result) =>
          isSoundCloudSearchResult(result, options)
        );
      default:
        return false;
    }
  })();
  if (!valid) {
    throw schemaError(adapterId);
  }
  return value as ResolverSearchResultMap[P];
}

function isBandcampTrack(
  value: unknown,
  options: ResolverResponseParserOptions
): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isString(value.name) &&
    isAllowedStreamUrl(value.streamUrl, options) &&
    isResolverStreamFormat(value.format) &&
    isFiniteNonNegativeNumber(value.duration) &&
    isFiniteNonNegativeNumber(value.trackNumber)
  );
}

function isBandcampMetadata(
  value: unknown,
  options: ResolverResponseParserOptions
): value is BandcampMetadata {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.platform === "bandcamp" &&
    isNonEmptyString(value.itemType) &&
    BANDCAMP_ITEM_TYPES.has(value.itemType) &&
    isAllowedUrl(value.url, options) &&
    isOptionalString(value.name) &&
    isOptionalString(value.artist) &&
    isOptionalAllowedUrl(value.artwork, options) &&
    isOptionalString(value.albumName) &&
    isFiniteNonNegativeNumber(value.trackNumber) &&
    isFiniteNonNegativeNumber(value.duration) &&
    isFiniteNonNegativeNumber(value.trackCount) &&
    (value.tracks === undefined ||
      (Array.isArray(value.tracks) &&
        value.tracks.every((track) => isBandcampTrack(track, options)))) &&
    (value.streamUrl === undefined ||
      isAllowedStreamUrl(value.streamUrl, options))
  );
}

function isSoundCloudTrack(
  value: unknown,
  options: ResolverResponseParserOptions
): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isString(value.name) &&
    isAllowedStreamUrl(value.streamUrl, options) &&
    isResolverStreamFormat(value.format) &&
    isFiniteNonNegativeNumber(value.duration)
  );
}

function isSoundCloudMetadata(
  value: unknown,
  options: ResolverResponseParserOptions
): value is SoundCloudMetadata {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.platform === "soundcloud" &&
    isNonEmptyString(value.itemType) &&
    SOUNDCLOUD_ITEM_TYPES.has(value.itemType) &&
    isAllowedUrl(value.url, options) &&
    isOptionalString(value.name) &&
    isOptionalString(value.artist) &&
    isOptionalAllowedUrl(value.artwork, options) &&
    isOptionalString(value.albumName) &&
    isFiniteNonNegativeNumber(value.duration) &&
    isFiniteNonNegativeNumber(value.trackCount) &&
    (value.tracks === undefined ||
      (Array.isArray(value.tracks) &&
        value.tracks.every((track) => isSoundCloudTrack(track, options)))) &&
    (value.streamUrl === undefined ||
      isAllowedStreamUrl(value.streamUrl, options))
  );
}

function isRadioGardenMetadata(
  value: unknown,
  options: ResolverResponseParserOptions
): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.platform === "radiogarden" &&
    value.itemType === "channel" &&
    isAllowedUrl(value.url, options) &&
    isNonEmptyString(value.channelId) &&
    isOptionalString(value.name) &&
    isOptionalString(value.subtitle) &&
    isOptionalAllowedUrl(value.website, options) &&
    isOptionalString(value.placeId) &&
    isOptionalString(value.placeTitle) &&
    isOptionalString(value.countryTitle)
  );
}

function isExpiresAt(value: unknown): value is string | undefined {
  return (
    value === undefined ||
    (isNonEmptyString(value) && Number.isFinite(Date.parse(value)))
  );
}

export function parseResolverResolution<P extends ResolverProvider>(
  provider: P,
  value: unknown,
  adapterId: string,
  options: ResolverResponseParserOptions = {}
): ResolverResolution<P> {
  if (
    !(
      isRecord(value) &&
      isAllowedStreamUrl(value.streamUrl, options) &&
      isResolverStreamFormat(value.format) &&
      isExpiresAt(value.expiresAt)
    )
  ) {
    throw schemaError(adapterId);
  }
  const validMetadata = (() => {
    switch (provider) {
      case "bandcamp":
        return isBandcampMetadata(value.metadata, options);
      case "radiogarden":
        return isRadioGardenMetadata(value.metadata, options);
      case "soundcloud":
        return isSoundCloudMetadata(value.metadata, options);
      default:
        return false;
    }
  })();
  if (!validMetadata) {
    throw schemaError(adapterId);
  }
  return {
    ...(value.expiresAt === undefined ? {} : { expiresAt: value.expiresAt }),
    ...(value.format === undefined ? {} : { format: value.format }),
    metadata: value.metadata,
    resolverId: sanitizeResolverId(adapterId),
    streamUrl: value.streamUrl,
  } as ResolverResolution<P>;
}
