import {
  cacheMetadata,
  EPISODE_METADATA_TTL,
  type MetadataCache,
  RADIO_METADATA_SUCCESS_TTL_MS,
} from "./cache";
import { decodeIcyText } from "./icy-parser";
import {
  cleanMetadataText,
  type ParsedRadioTitle,
  parseRadioTitle,
  parseRadioTitleParts,
} from "./title-parser";
import type { RadioMetadataSource, RadioNowPlaying } from "./types";
import { RadioMetadataValidationError } from "./upstream-fetch";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const AZURACAST_LISTEN_PATH_PATTERN = /\/listen\/([^/]+)/;
const AIRTIME_STATION_NAMES: Record<string, string> = {
  "cashmereradio.out.airtime.pro": "Cashmere Radio",
  "radio.syg.ma": "Sygma Radio",
  "stream-relay-geo.internetpublicradio.live": "Internet Public Radio",
};
const CASHMERE_GRAPHQL_URL = "https://backstage.cashmereradio.com/graphql";
const CASHMERE_REST_URL = "https://backstage.cashmereradio.com/wp-json/wp/v2";
const CASHMERE_EPISODE_PATH_PATTERN = /^\/episode\/([^/]+)\/?$/;
const SHOW_PATH_PATTERN = /^\/shows\/([^/]+)\/?$/;
const AUDIO_EXTENSION_PATTERN = /\.(?:mp3|wav|flac|m4a|aac|ogg)$/i;
const CASHMERE_RECORDING_DATE_PATTERN = /\s+\d{2}\.\d{2}\.\d{4}$/;
const DATE_STAMP_PATTERN = /^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/;
const HKCR_SCHEDULE_URL = "https://cms.hkcr.live/schedule/range";
const HKCR_SHOW_URL = "https://cms.hkcr.live/shows";
const HKCR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const HKCR_TIME_PATTERN = /^\d{2}:\d{2}$/;
const HKCR_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
const HKCR_GUEST_SEPARATOR_PATTERN = /\s+w\/\s*/i;
const IPR_REPLAY_SUFFIX_PATTERN = /\s*\((?:r|replay)\)\s*$/i;
const IPR_SEARCH_URL = "https://www.internetpublicradio.live/api/search";
const INTEGER_FIELD_PATTERN = /^\d+$/;
const HTML_TAG_PATTERN = /<[^>]*>/g;
const HTML_BODY_PATTERN = /<body[^>]*>([\s\S]*?)<\/body>/i;
const MARKDOWN_LINK_PATTERN = /!?\[([^\]]*)\]\([^)]*\)/g;
const MARKDOWN_STRONG_PATTERN = /(\*\*|__)(?=\S)([\s\S]*?\S)\1/g;
const MARKDOWN_EMPHASIS_PATTERN =
  /(?<![\w*])([*_])(?=\S)([\s\S]*?\S)\1(?![\w*])/g;
const DAY_MS = 24 * 60 * 60 * 1000;
// A provider boundary never schedules a check sooner than this.
const MIN_BOUNDARY_TTL_MS = 30_000;
// A boundary already in the past means stale data; recheck like Alhara does.
const STALE_BOUNDARY_RECHECK_MS = 60_000;
const BLACKOUT_TIME_ZONE = "Europe/Rome";
const SLOT_TIME_PATTERN = /^(\d{2}):(\d{2})$/;
const RESONANCE_SCHEDULE_PATTERN =
  /^(?:[a-z]+\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\s+(\d{4})\s+(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})\s+(bst|gmt|utc)$/i;
const RESONANCE_MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const UK_ZONE_OFFSETS_MS = new Map([
  ["bst", 60 * 60 * 1000],
  ["gmt", 0],
  ["utc", 0],
]);
const AIRTIME_LOCAL_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const RADIO_ALHARA_NOW_PLAYING_URL =
  "https://ch2.radioalhara.net/api/now-playing";
const RESONANCE_EXTRA_API_URL =
  "https://x.resonance.fm/api/current_and_upcoming";
const SANITY_IMAGE_REF_PATTERN = /^image-([a-f\d]+)-(\d+x\d+)-([a-z\d]+)$/i;
const TRAILING_SLASH_PATTERN = /\/$/;
const WHITESPACE_PATTERN = /\s+/g;

export type ExternalMetadataProviderInput = {
  cache?: MetadataCache;
  now?: () => number;
  fetchImpl: FetchLike;
  streamUrl: string;
  sampledAt: number;
  expiresAt: number;
};

type AirtimeTrack = {
  album_artwork_image?: unknown;
  ends?: unknown;
  name?: unknown;
  metadata?: {
    artist_name?: unknown;
    track_title?: unknown;
    album_title?: unknown;
    genre?: unknown;
    artwork_url?: unknown;
    artwork?: unknown;
    url?: unknown;
    info_url?: unknown;
    audio_source_url?: unknown;
    buy_this_url?: unknown;
    comments?: unknown;
    description?: unknown;
  };
};

type AirtimeLiveInfo = {
  station?: { schedulerTime?: unknown; timezone?: unknown };
  tracks?: { current?: AirtimeTrack };
  current?: AirtimeTrack;
  shows?: { current?: AirtimeShow | AirtimeShow[] };
  currentShow?: AirtimeShow | AirtimeShow[];
};

type AirtimeShow = {
  name?: unknown;
  description?: unknown;
  image_path?: unknown;
  url?: unknown;
};

type AirtimeEnrichment = {
  complete: boolean;
  nowPlaying: RadioNowPlaying;
};

type CashmereEpisode = {
  databaseId?: unknown;
  featuredImage?: { node?: { sourceUrl?: unknown } };
  title?: unknown;
  uri?: unknown;
};

type CashmereEpisodeRecord = {
  acf?: {
    episode_filter_genre?: unknown;
    episode_filter_mood?: unknown;
  };
  content?: { rendered?: unknown };
  id?: unknown;
  link?: unknown;
  slug?: unknown;
};

type CashmereShow = {
  _embedded?: {
    "wp:featuredmedia"?: Array<{ source_url?: unknown }>;
  };
  content?: { rendered?: unknown };
  link?: unknown;
  slug?: unknown;
  title?: { rendered?: unknown };
};

type IprSearchResult = {
  _id?: unknown;
  _type?: unknown;
  date?: unknown;
  image?: { asset?: { _ref?: unknown } };
  label?: unknown;
  resident?: { slug?: { current?: unknown } };
  series?: { slug?: { current?: unknown } };
  slug?: { current?: unknown };
};

type SygmaEpisode = {
  description?: unknown;
  picture?: { url?: unknown };
  slug?: unknown;
  title?: unknown;
};

type BlackoutListening = {
  title?: unknown;
  excerpt?: unknown;
  featured_media?: unknown;
  link?: unknown;
  slot?: { start?: unknown; end?: unknown };
};

type BlackoutShow = {
  title?: unknown;
  slug?: unknown;
  link?: unknown;
  content?: unknown;
  tags?: unknown;
};

type AzuraCastNowPlaying = {
  station?: {
    name?: unknown;
    description?: unknown;
    listen_url?: unknown;
  };
  now_playing?: {
    song?: {
      artist?: unknown;
      title?: unknown;
      album?: unknown;
      text?: unknown;
      art?: unknown;
      genre?: unknown;
    };
  };
  live?: {
    streamer_name?: unknown;
  };
};

type ShoutcastStatus = {
  songtitle?: unknown;
  currenttitle?: unknown;
  title?: unknown;
  servertitle?: unknown;
  servergenre?: unknown;
  bitrate?: unknown;
};

type HkcrScheduleEntry = {
  date?: unknown;
  description?: unknown;
  endTime?: unknown;
  picture?: { url?: unknown };
  resident?: { name?: unknown; slug?: unknown };
  show?: unknown;
  startTime?: unknown;
  thumbnail?: { url?: unknown };
  title?: unknown;
  status?: unknown;
};

type HkcrShow = HkcrScheduleEntry & {
  _id?: unknown;
  content?: unknown;
  medium?: { url?: unknown };
  slug?: unknown;
  tags?: { name?: unknown }[];
};

type HkcrReplaySlot = {
  start?: unknown;
  end?: unknown;
  show?: unknown;
  replay?: { title?: unknown; show?: unknown };
};

type ResonanceExtraSchedule = {
  now?: {
    backgrounds?: { image?: unknown }[];
    description?: unknown;
    host?: unknown;
    name?: unknown;
    path?: unknown;
    series_link?: unknown;
    series_name?: unknown;
    starts_ends?: unknown;
  };
  after?: { starts_ends?: unknown };
};

type RadioAlharaNowPlaying = {
  artist?: unknown;
  duration?: unknown;
  episodeTitle?: unknown;
  scheduledTitle?: unknown;
  title?: unknown;
  trackStart?: unknown;
};

type Link = {
  href?: unknown;
  rel?: unknown;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asPublicUrl(value: unknown): string | null {
  const text = asString(value);
  if (!text) {
    return null;
  }
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function resolvePublicUrl(value: unknown, base: string): string | null {
  const text = asString(value);
  try {
    return text ? asPublicUrl(new URL(text, base).toString()) : null;
  } catch {
    return null;
  }
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(asString).filter((item): item is string => Boolean(item))
    : [];
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function shouldPropagateFetchError(error: unknown): boolean {
  return isAbortError(error) || error instanceof RadioMetadataValidationError;
}

async function findSequential<T, TResult>(
  items: readonly T[],
  resolve: (item: T) => Promise<TResult | null>,
  index = 0
): Promise<TResult | null> {
  const item = items[index];
  if (item === undefined) {
    return null;
  }
  const result = await resolve(item);
  return result ?? findSequential(items, resolve, index + 1);
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function first<T>(value: T | T[] | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Expires at a provider's programme boundary, within the regular cap. */
function boundaryExpiresAt(
  input: { sampledAt: number; expiresAt: number },
  boundary: number | null | undefined
): number {
  if (
    boundary === null ||
    boundary === undefined ||
    !Number.isFinite(boundary)
  ) {
    return input.expiresAt;
  }
  if (boundary <= input.sampledAt) {
    return Math.min(
      input.expiresAt,
      input.sampledAt + STALE_BOUNDARY_RECHECK_MS
    );
  }
  return Math.min(
    input.expiresAt,
    Math.max(input.sampledAt + MIN_BOUNDARY_TTL_MS, boundary)
  );
}

function buildNowPlaying(input: {
  streamUrl: string;
  resolvedUrl?: string;
  source: RadioMetadataSource;
  titles: ParsedRadioTitle;
  album?: string | null;
  artworkUrl?: string | null;
  itemUrl?: string | null;
  stationName?: string | null;
  stationDescription?: string | null;
  genre?: string | null;
  bitrate?: number | null;
  sampledAt: number;
  expiresAt: number;
}): RadioNowPlaying | null {
  const parsed = input.titles;
  if (!(parsed.title || parsed.artist)) {
    return null;
  }

  return {
    album: input.album ?? null,
    artist: parsed.artist,
    artworkUrl: input.artworkUrl ?? null,
    bitrate: input.bitrate ?? null,
    expiresAt: input.expiresAt,
    genre: input.genre ?? null,
    itemUrl: input.itemUrl ?? null,
    rawTitle: parsed.rawTitle,
    resolvedUrl: input.resolvedUrl,
    sampledAt: input.sampledAt,
    source: input.source,
    stationDescription: input.stationDescription ?? null,
    stationName: input.stationName ?? null,
    streamUrl: input.streamUrl,
    title: parsed.title,
  };
}

function getSygmaEpisodeUrl(streamUrl: string, slug: unknown): string | null {
  if (new URL(streamUrl).hostname !== "radio.syg.ma") {
    return null;
  }
  const episodeSlug = asString(slug);
  return episodeSlug
    ? new URL(`/episodes/${episodeSlug}`, "https://radio.syg.ma").toString()
    : null;
}

function getAirtimeItemUrl(input: {
  streamUrl: string;
  metadata: AirtimeTrack["metadata"] | undefined;
  show: AirtimeShow | undefined;
}): string | null {
  return (
    asPublicUrl(input.metadata?.url) ??
    asPublicUrl(input.metadata?.info_url) ??
    getSygmaEpisodeUrl(input.streamUrl, input.metadata?.info_url) ??
    asPublicUrl(input.metadata?.audio_source_url) ??
    asPublicUrl(input.metadata?.buy_this_url) ??
    asPublicUrl(input.show?.url)
  );
}

function airtimeWallTime(value: unknown): number | null {
  const match = asString(value)?.match(AIRTIME_LOCAL_TIME_PATTERN);
  if (!match) {
    return null;
  }
  const parts = match.slice(1).map(Number);
  const wallTime = Date.UTC(
    parts[0] ?? 0,
    (parts[1] ?? 0) - 1,
    parts[2] ?? 0,
    parts[3] ?? 0,
    parts[4] ?? 0,
    parts[5] ?? 0
  );
  return Number.isFinite(wallTime) &&
    new Date(wallTime).toISOString().slice(0, 19) ===
      asString(value)?.replace(" ", "T")
    ? wallTime
    : null;
}

function airtimeLocalTime(instant: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(instant);
  const field = (name: string) =>
    Number(parts.find((part) => part.type === name)?.value);
  return Date.UTC(
    field("year"),
    field("month") - 1,
    field("day"),
    field("hour"),
    field("minute"),
    field("second")
  );
}

function airtimeTrackExpiresAt(input: {
  data: AirtimeLiveInfo;
  sampledAt: number;
  expiresAt: number;
}): number {
  const track = input.data.tracks?.current ?? input.data.current;
  const timezone = asString(input.data.station?.timezone);
  const endWall = airtimeWallTime(track?.ends);
  if (!(timezone && endWall !== null)) {
    return input.expiresAt;
  }
  const shortRetry = Math.min(input.expiresAt, input.sampledAt + 60_000);
  try {
    const nowWall = airtimeLocalTime(input.sampledAt, timezone);
    const schedulerWall = airtimeWallTime(input.data.station?.schedulerTime);
    if (
      schedulerWall !== null &&
      Math.abs(schedulerWall - nowWall) > 2 * 60_000
    ) {
      return shortRetry;
    }
    const candidate =
      Math.floor(input.sampledAt / 1000) * 1000 + (endWall - nowWall);
    return candidate > input.sampledAt &&
      airtimeLocalTime(candidate, timezone) === endWall
      ? Math.min(input.expiresAt, candidate)
      : shortRetry;
  } catch {
    return input.expiresAt;
  }
}

function normalizeAirtimeLiveInfo(input: {
  data: AirtimeLiveInfo;
  streamUrl: string;
  resolvedUrl?: string;
  sampledAt: number;
  expiresAt: number;
}): RadioNowPlaying | null {
  const track = input.data.tracks?.current ?? input.data.current;
  const show = first(input.data.shows?.current ?? input.data.currentShow);
  const metadata = track?.metadata;

  return buildNowPlaying({
    album: asString(metadata?.album_title),
    artworkUrl:
      asPublicUrl(metadata?.artwork_url) ??
      asPublicUrl(metadata?.artwork) ??
      asPublicUrl(track?.album_artwork_image) ??
      asPublicUrl(show?.image_path),
    expiresAt: airtimeTrackExpiresAt(input),
    genre: asString(metadata?.genre),
    itemUrl: getAirtimeItemUrl({
      metadata,
      show,
      streamUrl: input.streamUrl,
    }),
    resolvedUrl: input.resolvedUrl,
    sampledAt: input.sampledAt,
    source: "airtime-live-info",
    stationDescription: plainText(show?.description),
    stationName: AIRTIME_STATION_NAMES[new URL(input.streamUrl).hostname],
    streamUrl: input.streamUrl,
    titles: airtimeTitles(track, show),
  });
}

/**
 * Keeps Airtime's separate artist/title fields: re-splitting a joined string
 * would turn "Simon & Garfunkel - Live" + "The Boxer" into "Live - The Boxer".
 */
function airtimeTitles(
  track: AirtimeTrack | undefined,
  show: AirtimeShow | undefined
): ParsedRadioTitle {
  const artist = asString(track?.metadata?.artist_name);
  const trackTitle = asString(track?.metadata?.track_title);
  if (trackTitle) {
    return parseRadioTitleParts({ artist, title: trackTitle });
  }
  // Without metadata, Airtime's `name` is its own "artist - title" join.
  const named = parseRadioTitle(asString(track?.name));
  if (named.title) {
    return artist && !named.artist
      ? parseRadioTitleParts({ artist, title: named.title })
      : named;
  }
  return parseRadioTitleParts({ title: artist ?? asString(show?.name) });
}

function getAirtimeCandidateUrls(streamUrl: string): string[] {
  const url = new URL(streamUrl);
  const urls = [
    new URL("/api/live-info-v2", url.origin).toString(),
    new URL("/api/live-info", url.origin).toString(),
  ];

  if (url.hostname === "radio.syg.ma") {
    urls.unshift(new URL("/stats-icecast.json", url.origin).toString());
  }
  if (url.hostname === "cashmereradio.out.airtime.pro") {
    urls.unshift(
      "https://cashmereradio.airtime.pro/api/live-info-v2",
      "https://cashmereradio.airtime.pro/api/live-info"
    );
  }

  return [...new Set(urls)];
}

async function fetchObjectJson(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit = {}
): Promise<{ data: object; response: Response } | null> {
  const headers = new Headers(init.headers);
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }
  const response = await fetchImpl(url, {
    ...init,
    headers,
    method: init.method ?? "GET",
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  try {
    const data = (await response.json()) as unknown;
    return data && typeof data === "object" ? { data, response } : null;
  } catch {
    return null;
  }
}

async function fetchText(
  fetchImpl: FetchLike,
  url: string,
  accept = "text/plain, */*"
): Promise<{ text: string; response: Response } | null> {
  const response = await fetchImpl(url, {
    headers: { Accept: accept },
    method: "GET",
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  try {
    // SHOUTcast text pages declare no reliable charset; decode like ICY.
    const text = decodeIcyText(new Uint8Array(await response.arrayBuffer()));
    return text.trim() ? { response, text } : null;
  } catch {
    return null;
  }
}

function comparableTitle(value: unknown): string | null {
  const text = cleanMetadataText(asString(value));
  return text
    ? text.normalize("NFKC").replace(WHITESPACE_PATTERN, " ").toLowerCase()
    : null;
}

async function enrichSygmaNowPlaying(
  fetchImpl: FetchLike,
  nowPlaying: RadioNowPlaying
): Promise<AirtimeEnrichment> {
  if (
    (nowPlaying.artworkUrl && nowPlaying.stationDescription) ||
    !nowPlaying.itemUrl
  ) {
    return { complete: true, nowPlaying };
  }
  const itemUrl = new URL(nowPlaying.itemUrl);
  if (
    itemUrl.hostname !== "radio.syg.ma" ||
    !itemUrl.pathname.startsWith("/episodes/")
  ) {
    return { complete: true, nowPlaying };
  }
  const encodedSlug = itemUrl.pathname.split("/").filter(Boolean).at(-1);
  const slug = encodedSlug ? decodeURIComponent(encodedSlug) : null;
  if (!slug) {
    return { complete: true, nowPlaying };
  }
  const result = await fetchObjectJson(
    fetchImpl,
    `https://backend.radio.syg.ma/episodes/${encodeURIComponent(slug)}.json`
  );
  const episode = result?.data as SygmaEpisode | undefined;
  if (
    !episode ||
    asString(episode?.slug) !== slug ||
    comparableTitle(episode?.title) !== comparableTitle(nowPlaying.title)
  ) {
    return { complete: false, nowPlaying };
  }
  return {
    complete: true,
    nowPlaying: {
      ...nowPlaying,
      artworkUrl: nowPlaying.artworkUrl ?? asPublicUrl(episode.picture?.url),
      stationDescription:
        nowPlaying.stationDescription ?? asString(episode.description),
    },
  };
}

function comparableCashmereTitle(value: unknown): string | null {
  return comparableTitle(asString(value)?.replaceAll("_", " "));
}

async function enrichCashmereNowPlaying(
  fetchImpl: FetchLike,
  nowPlaying: RadioNowPlaying
): Promise<AirtimeEnrichment> {
  const showUrl = getCashmereShowUrl(nowPlaying.itemUrl);
  if (showUrl) {
    return await enrichCashmereKnownShow(fetchImpl, nowPlaying, showUrl);
  }
  if (
    [
      nowPlaying.artworkUrl,
      nowPlaying.itemUrl,
      nowPlaying.stationDescription,
      nowPlaying.genre,
    ].every(Boolean) ||
    !nowPlaying.title
  ) {
    return { complete: true, nowPlaying };
  }
  const searchTitle = nowPlaying.title.replace(AUDIO_EXTENSION_PATTERN, "");
  const result = await fetchObjectJson(fetchImpl, CASHMERE_GRAPHQL_URL, {
    body: JSON.stringify({
      query:
        "query SearchEpisode($q: String!) { episodes(where: {search: $q}, first: 10) { nodes { databaseId title uri featuredImage { node { sourceUrl } } } } }",
      variables: { q: searchTitle },
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const responseData = result?.data as
    | {
        data?: { episodes?: { nodes?: CashmereEpisode[] } };
        errors?: unknown[];
      }
    | undefined;
  const nodes = responseData?.data?.episodes?.nodes;
  const complete = Array.isArray(nodes) && !responseData?.errors?.length;
  const matches = Array.isArray(nodes)
    ? nodes.filter(
        (node) =>
          comparableCashmereTitle(node.title) ===
          comparableCashmereTitle(searchTitle)
      )
    : [];
  if (matches.length !== 1) {
    const details = await enrichCashmereShowByTitle(fetchImpl, nowPlaying);
    return { ...details, complete: complete && details.complete };
  }

  const [episode] = matches;
  const uri = asString(episode?.uri);
  const candidateUrl = uri
    ? resolvePublicUrl(uri, "https://cashmereradio.com")
    : null;
  const itemUrl = getCashmereEpisodeUrl(candidateUrl) ? candidateUrl : null;
  const enriched = {
    ...nowPlaying,
    artworkUrl:
      nowPlaying.artworkUrl ??
      asPublicUrl(episode?.featuredImage?.node?.sourceUrl),
    itemUrl: nowPlaying.itemUrl ?? itemUrl,
  };
  const details = await enrichCashmereEpisodeRecord(
    fetchImpl,
    enriched,
    episode
  );
  return { ...details, complete: complete && details.complete };
}

async function enrichCashmereKnownShow(
  fetchImpl: FetchLike,
  nowPlaying: RadioNowPlaying,
  showUrl: { slug: string; pathname: string }
): Promise<AirtimeEnrichment> {
  if (nowPlaying.artworkUrl && nowPlaying.stationDescription) {
    return { complete: true, nowPlaying };
  }
  const result = await fetchObjectJson(
    fetchImpl,
    `${CASHMERE_REST_URL}/pages?slug=${encodeURIComponent(showUrl.slug)}&_embed=wp%3Afeaturedmedia&_fields=slug%2Clink%2Ccontent%2C_links%2C_embedded`
  );
  const shows = Array.isArray(result?.data)
    ? (result.data as CashmereShow[])
    : null;
  const show = shows?.[0];
  if (
    shows?.length !== 1 ||
    asString(show?.slug) !== showUrl.slug ||
    !cashmereBackendLinkMatches(show?.link, showUrl.pathname)
  ) {
    return { complete: shows?.length === 0, nowPlaying };
  }
  return {
    complete: true,
    nowPlaying: {
      ...nowPlaying,
      artworkUrl:
        nowPlaying.artworkUrl ??
        asPublicUrl(show?._embedded?.["wp:featuredmedia"]?.[0]?.source_url),
      stationDescription:
        nowPlaying.stationDescription ?? plainText(show?.content?.rendered),
    },
  };
}

async function enrichCashmereShowByTitle(
  fetchImpl: FetchLike,
  nowPlaying: RadioNowPlaying
): Promise<AirtimeEnrichment> {
  const title = nowPlaying.title
    ?.replace(AUDIO_EXTENSION_PATTERN, "")
    .replace(CASHMERE_RECORDING_DATE_PATTERN, "")
    .trim();
  if (!title || nowPlaying.itemUrl) {
    return { complete: true, nowPlaying };
  }
  const url = new URL(`${CASHMERE_REST_URL}/pages`);
  url.searchParams.set("search", title);
  url.searchParams.set("per_page", "20");
  url.searchParams.set("_embed", "wp:featuredmedia");
  url.searchParams.set("_fields", "title,slug,link,content,_links,_embedded");
  const result = await fetchObjectJson(fetchImpl, url.toString());
  if (!Array.isArray(result?.data)) {
    return { complete: false, nowPlaying };
  }
  const matches = (result.data as CashmereShow[]).filter(
    (candidate) =>
      comparableCashmereTitle(candidate.title?.rendered) ===
      comparableCashmereTitle(title)
  );
  if (matches.length !== 1) {
    return { complete: true, nowPlaying };
  }
  const [show] = matches;
  const slug = asString(show?.slug);
  const pathname = slug ? `/shows/${encodeURIComponent(slug)}/` : null;
  if (!(pathname && cashmereBackendLinkMatches(show?.link, pathname))) {
    return { complete: false, nowPlaying };
  }
  return {
    complete: true,
    nowPlaying: {
      ...nowPlaying,
      artworkUrl:
        nowPlaying.artworkUrl ??
        asPublicUrl(show._embedded?.["wp:featuredmedia"]?.[0]?.source_url),
      itemUrl: new URL(pathname, "https://cashmereradio.com").toString(),
      stationDescription:
        nowPlaying.stationDescription ?? plainText(show.content?.rendered),
    },
  };
}

async function enrichCashmereEpisodeRecord(
  fetchImpl: FetchLike,
  nowPlaying: RadioNowPlaying,
  episode: CashmereEpisode | undefined
): Promise<AirtimeEnrichment> {
  const databaseId = episode?.databaseId;
  const episodeUrl = getCashmereEpisodeUrl(nowPlaying.itemUrl);
  if (
    !(
      typeof databaseId === "number" &&
      Number.isSafeInteger(databaseId) &&
      episodeUrl
    )
  ) {
    return { complete: true, nowPlaying };
  }
  let detailResult: Awaited<ReturnType<typeof fetchObjectJson>>;
  try {
    detailResult = await fetchObjectJson(
      fetchImpl,
      `${CASHMERE_REST_URL}/episode/${databaseId}?_fields=id%2Cslug%2Clink%2Ccontent%2Cacf`
    );
  } catch (error) {
    if (error instanceof RadioMetadataValidationError) {
      throw error;
    }
    return { complete: false, nowPlaying };
  }
  const record = detailResult?.data as CashmereEpisodeRecord | undefined;
  if (
    record?.id !== databaseId ||
    asString(record.slug) !== episodeUrl.slug ||
    !cashmereBackendLinkMatches(record.link, episodeUrl.pathname)
  ) {
    return { complete: false, nowPlaying };
  }
  const tags = [
    ...asStringArray(record.acf?.episode_filter_genre),
    ...asStringArray(record.acf?.episode_filter_mood),
  ];
  return {
    complete: true,
    nowPlaying: {
      ...nowPlaying,
      genre: nowPlaying.genre ?? ([...new Set(tags)].join(", ") || null),
      stationDescription:
        nowPlaying.stationDescription ?? plainText(record.content?.rendered),
    },
  };
}

function getCashmereEpisodeUrl(
  value: string | null
): { pathname: string; slug: string } | null {
  try {
    const url = value ? new URL(value) : null;
    const match = url?.pathname.match(CASHMERE_EPISODE_PATH_PATTERN);
    return url?.origin === "https://cashmereradio.com" &&
      !url.username &&
      !url.password &&
      match?.[1]
      ? { pathname: url.pathname, slug: decodeURIComponent(match[1]) }
      : null;
  } catch {
    return null;
  }
}

function getCashmereShowUrl(
  value: string | null
): { pathname: string; slug: string } | null {
  try {
    const url = value ? new URL(value) : null;
    const match = url?.pathname.match(SHOW_PATH_PATTERN);
    return url?.protocol === "https:" &&
      url.hostname === "cashmereradio.com" &&
      match?.[1]
      ? { pathname: url.pathname, slug: decodeURIComponent(match[1]) }
      : null;
  } catch {
    return null;
  }
}

function cashmereBackendLinkMatches(value: unknown, pathname: string): boolean {
  try {
    const url = new URL(asString(value) ?? "");
    return (
      url.protocol === "https:" &&
      url.hostname === "backstage.cashmereradio.com" &&
      url.pathname.replace(TRAILING_SLASH_PATTERN, "") ===
        pathname.replace(TRAILING_SLASH_PATTERN, "")
    );
  } catch {
    return false;
  }
}

function plainText(value: unknown): string | null {
  const text = asString(value);
  return text
    ? cleanMetadataText(text.replace(HTML_TAG_PATTERN, " "))
        .replace(WHITESPACE_PATTERN, " ")
        .trim() || null
    : null;
}

/** Links and emphasis to plain text, e.g. "[Ensemble](url) is **live**". */
function markdownText(value: unknown): string | null {
  const text = asString(value);
  return text
    ? plainText(
        text
          .replace(MARKDOWN_LINK_PATTERN, "$1")
          .replace(MARKDOWN_STRONG_PATTERN, "$2")
          .replace(MARKDOWN_EMPHASIS_PATTERN, "$2")
      )
    : null;
}

function getAirtimeEpisodeDate(
  metadata: AirtimeTrack["metadata"]
): string | null {
  const value = asString(metadata?.comments) ?? asString(metadata?.description);
  const match = value?.match(DATE_STAMP_PATTERN);
  if (!match) {
    return null;
  }
  const [, day, month, rawYear] = match;
  const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
  const date = `${year}-${month}-${day}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
    ? null
    : date;
}

function getIprArtworkUrl(result: IprSearchResult | undefined): string | null {
  const ref = asString(result?.image?.asset?._ref);
  const match = ref?.match(SANITY_IMAGE_REF_PATTERN);
  return match
    ? `https://cdn.sanity.io/images/7rbo2iih/production/${match[1]}-${match[2]}.${match[3]}`
    : null;
}

function getIprItemUrl(result: IprSearchResult | undefined): string | null {
  const type = asString(result?._type);
  const slug = asString(result?.slug?.current);
  if (!(type && slug)) {
    return null;
  }
  if (type === "resident" || type === "series") {
    return new URL(
      `/${type === "resident" ? "residents" : "series"}/${encodeURIComponent(slug)}`,
      "https://www.internetpublicradio.live"
    ).toString();
  }
  if (type === "guest") {
    return new URL(
      `/guests/episodes/${encodeURIComponent(slug)}`,
      "https://www.internetpublicradio.live"
    ).toString();
  }
  const parentSlug =
    asString(result?.resident?.slug?.current) ??
    asString(result?.series?.slug?.current);
  return type === "episode" && parentSlug
    ? new URL(
        `/${encodeURIComponent(parentSlug)}/episodes/${encodeURIComponent(slug)}`,
        "https://www.internetpublicradio.live"
      ).toString()
    : null;
}

async function enrichIprNowPlaying(
  fetchImpl: FetchLike,
  nowPlaying: RadioNowPlaying,
  metadata: AirtimeTrack["metadata"]
): Promise<AirtimeEnrichment> {
  if (
    (nowPlaying.artworkUrl &&
      nowPlaying.itemUrl &&
      nowPlaying.stationDescription) ||
    !nowPlaying.title
  ) {
    return { complete: true, nowPlaying };
  }
  const withoutReplaySuffix = (value: string | null) =>
    value?.replace(IPR_REPLAY_SUFFIX_PATTERN, "").trim() ?? null;
  const title = withoutReplaySuffix(nowPlaying.title) ?? "";
  // Labels may be the full "Show - Episode" string or just its title half.
  const labels = new Set(
    [title, withoutReplaySuffix(nowPlaying.rawTitle)]
      .map(comparableTitle)
      .filter(Boolean)
  );
  const url = new URL(IPR_SEARCH_URL);
  url.searchParams.set("q", title);
  const result = await fetchObjectJson(fetchImpl, url.toString());
  if (!(result && Array.isArray(result.data))) {
    return { complete: false, nowPlaying };
  }

  const matches = (result.data as IprSearchResult[]).filter((candidate) =>
    labels.has(comparableTitle(candidate.label))
  );
  const episodes = matches.filter((candidate) => {
    const type = asString(candidate._type);
    return type === "episode" || type === "guest";
  });
  const episodeDate = getAirtimeEpisodeDate(metadata);
  const datedEpisodes = episodeDate
    ? episodes.filter((candidate) => asString(candidate.date) === episodeDate)
    : [];
  let episode: IprSearchResult | undefined;
  if (datedEpisodes.length === 1) {
    [episode] = datedEpisodes;
  } else if (!episodeDate && episodes.length === 1) {
    [episode] = episodes;
  }
  const shows = matches.filter((candidate) => {
    const type = asString(candidate._type);
    return type === "resident" || type === "series";
  });
  const selected = episode ?? (shows.length === 1 ? shows[0] : undefined);
  const enriched = selected
    ? {
        ...nowPlaying,
        artworkUrl: nowPlaying.artworkUrl ?? getIprArtworkUrl(selected),
        itemUrl:
          nowPlaying.itemUrl ?? (episode ? getIprItemUrl(episode) : null),
      }
    : nowPlaying;
  return selected
    ? await enrichIprDescription(fetchImpl, enriched, selected)
    : { complete: true, nowPlaying: enriched };
}

async function enrichIprDescription(
  fetchImpl: FetchLike,
  nowPlaying: RadioNowPlaying,
  selected: IprSearchResult
): Promise<AirtimeEnrichment> {
  const id = asString(selected._id);
  if (!id || nowPlaying.stationDescription) {
    return { complete: true, nowPlaying };
  }
  const url = new URL(
    "https://7rbo2iih.api.sanity.io/v2024-01-01/data/query/production"
  );
  url.searchParams.set(
    "query",
    '*[_id == $id][0]{_id,_type,slug,title,name,"description":pt::text(description)}'
  );
  url.searchParams.set("$id", JSON.stringify(id));
  try {
    const response = await fetchObjectJson(fetchImpl, url.toString());
    const record = (
      response?.data as
        | {
            result?: {
              _id?: unknown;
              _type?: unknown;
              slug?: { current?: unknown };
              title?: unknown;
              name?: unknown;
              description?: unknown;
            };
          }
        | undefined
    )?.result;
    if (
      record?._id !== id ||
      record._type !== selected._type ||
      asString(record.slug?.current) !== asString(selected.slug?.current) ||
      comparableTitle(record.title ?? record.name) !==
        comparableTitle(selected.label)
    ) {
      return { complete: false, nowPlaying };
    }
    return {
      complete: true,
      nowPlaying: {
        ...nowPlaying,
        stationDescription: asString(record.description),
      },
    };
  } catch (error) {
    if (error instanceof RadioMetadataValidationError) {
      throw error;
    }
    return { complete: false, nowPlaying };
  }
}

async function cachedAirtimeEnrichment(
  input: ExternalMetadataProviderInput,
  data: AirtimeLiveInfo,
  nowPlaying: RadioNowPlaying
): Promise<RadioNowPlaying> {
  const track = data.tracks?.current ?? data.current;
  const fields = [
    "artworkUrl",
    "itemUrl",
    "stationDescription",
    "genre",
  ] as const;
  let complete = false;
  const details = await cacheMetadata({
    cache: input.cache,
    key: [
      new URL(input.streamUrl).hostname,
      "episode-details-v3",
      nowPlaying.title,
      fields.map((field) => nowPlaying[field]),
      getAirtimeEpisodeDate(track?.metadata),
    ],
    now: input.now,
    retrieve: async () => {
      const { complete: enrichmentComplete, nowPlaying: enriched } =
        await enrichAirtimeNowPlaying({
          ...input,
          data,
          nowPlaying,
        });
      complete = enrichmentComplete;
      return Object.fromEntries(
        fields
          .filter((field) => enriched[field] !== nowPlaying[field])
          .map((field) => [field, enriched[field]])
      );
    },
    shouldCache: () => complete,
    ttl: EPISODE_METADATA_TTL,
  });
  return { ...nowPlaying, ...details };
}

async function enrichAirtimeNowPlaying(input: {
  data: AirtimeLiveInfo;
  fetchImpl: FetchLike;
  nowPlaying: RadioNowPlaying;
  streamUrl: string;
}): Promise<AirtimeEnrichment> {
  try {
    const { data, fetchImpl, nowPlaying, streamUrl } = input;
    const { hostname } = new URL(streamUrl);
    if (hostname === "radio.syg.ma") {
      return await enrichSygmaNowPlaying(fetchImpl, nowPlaying);
    }
    if (hostname === "cashmereradio.out.airtime.pro") {
      return await enrichCashmereNowPlaying(fetchImpl, nowPlaying);
    }
    if (hostname === "stream-relay-geo.internetpublicradio.live") {
      const track = data.tracks?.current ?? data.current;
      return await enrichIprNowPlaying(fetchImpl, nowPlaying, track?.metadata);
    }
  } catch (error) {
    if (error instanceof RadioMetadataValidationError) {
      throw error;
    }
  }
  return { complete: false, nowPlaying: input.nowPlaying };
}

function getAzuraCastCandidateUrls(streamUrl: string): string[] {
  const url = new URL(streamUrl);
  const stationFromPath = url.pathname.match(
    AZURACAST_LISTEN_PATH_PATTERN
  )?.[1];
  const urls: string[] = [];
  if (stationFromPath) {
    urls.push(
      new URL(`/api/nowplaying/${stationFromPath}`, url.origin).toString()
    );
  }
  urls.push(new URL("/api/nowplaying", url.origin).toString());
  return [...new Set(urls)];
}

function azuraCastStationMatchesStream(
  station: AzuraCastNowPlaying,
  streamPath: string,
  options: { allowMissingListenUrl?: boolean } = {}
): boolean {
  const listenUrl = asString(station.station?.listen_url);
  if (!listenUrl) {
    return options.allowMissingListenUrl ?? false;
  }
  try {
    return new URL(listenUrl).pathname === streamPath;
  } catch {
    return listenUrl.includes(streamPath);
  }
}

function selectAzuraCastStation(
  data: object,
  streamUrl: string
): AzuraCastNowPlaying | null {
  const streamPath = new URL(streamUrl).pathname;
  if (!Array.isArray(data)) {
    const station = data as AzuraCastNowPlaying;
    return azuraCastStationMatchesStream(station, streamPath, {
      allowMissingListenUrl: true,
    })
      ? station
      : null;
  }

  return (
    (data.find((item) =>
      azuraCastStationMatchesStream(item as AzuraCastNowPlaying, streamPath)
    ) as AzuraCastNowPlaying | undefined) ?? null
  );
}

function normalizeAzuraCastNowPlaying(input: {
  data: object;
  streamUrl: string;
  resolvedUrl?: string;
  sampledAt: number;
  expiresAt: number;
}): RadioNowPlaying | null {
  const station = selectAzuraCastStation(input.data, input.streamUrl);
  const song = station?.now_playing?.song;
  const artist = asString(song?.artist);
  const title = asString(song?.title);

  return buildNowPlaying({
    album: asString(song?.album),
    artworkUrl: resolvePublicUrl(
      song?.art,
      input.resolvedUrl ?? input.streamUrl
    ),
    expiresAt: input.expiresAt,
    genre: asString(song?.genre),
    resolvedUrl: input.resolvedUrl,
    sampledAt: input.sampledAt,
    source: "azuracast-now-playing",
    stationDescription:
      asString(station?.station?.description) ??
      asString(station?.live?.streamer_name),
    stationName: asString(station?.station?.name),
    streamUrl: input.streamUrl,
    titles: title
      ? parseRadioTitleParts({ artist, title })
      : parseRadioTitle(asString(song?.text) ?? artist),
  });
}

export async function tryAzuraCastNowPlaying(
  input: ExternalMetadataProviderInput,
  endpoint?: string
): Promise<RadioNowPlaying | null> {
  const urls = endpoint
    ? [endpoint]
    : getAzuraCastCandidateUrls(input.streamUrl);
  return await findSequential([...new Set(urls)], async (url) => {
    let result: Awaited<ReturnType<typeof fetchObjectJson>>;
    try {
      result = await fetchObjectJson(input.fetchImpl, url);
    } catch (error) {
      if (shouldPropagateFetchError(error)) {
        throw error;
      }
      return null;
    }
    return result
      ? normalizeAzuraCastNowPlaying({
          data: result.data,
          expiresAt: input.expiresAt,
          resolvedUrl: result.response.url || url,
          sampledAt: input.sampledAt,
          streamUrl: input.streamUrl,
        })
      : null;
  });
}

function getShoutcastCandidateUrls(streamUrl: string, sid = "1"): string[] {
  const { origin } = new URL(streamUrl);
  return [
    new URL(`/stats?sid=${sid}&json=1`, origin).toString(),
    new URL(`/currentsong?sid=${sid}`, origin).toString(),
    new URL(`/7.html?sid=${sid}`, origin).toString(),
  ];
}

function normalizeShoutcastJson(input: {
  data: object;
  streamUrl: string;
  resolvedUrl?: string;
  sampledAt: number;
  expiresAt: number;
}): RadioNowPlaying | null {
  const data = input.data as ShoutcastStatus;
  const rawTitle =
    asString(data.songtitle) ??
    asString(data.currenttitle) ??
    asString(data.title);
  if (!rawTitle) {
    return null;
  }
  return buildNowPlaying({
    bitrate: asNumber(data.bitrate),
    expiresAt: input.expiresAt,
    genre: asString(data.servergenre),
    resolvedUrl: input.resolvedUrl,
    sampledAt: input.sampledAt,
    source: "shoutcast-status",
    stationName: asString(data.servertitle),
    streamUrl: input.streamUrl,
    titles: parseRadioTitle(rawTitle),
  });
}

function getShoutcast7HtmlTitle(html: string): string | null {
  // SHOUTcast v1 wraps the CSV in <html><body>…</body></html>.
  const text = (html.match(HTML_BODY_PATTERN)?.[1] ?? html)
    .replace(HTML_TAG_PATTERN, "")
    .trim();
  const fields = text.split(",");
  if (fields.length < 2) {
    return asString(text);
  }

  const titleOffset = fields.findIndex((field, index) => {
    if (index > 5) {
      return true;
    }
    return !INTEGER_FIELD_PATTERN.test(field.trim());
  });
  if (titleOffset < 0) {
    return null;
  }
  return asString(fields.slice(titleOffset).join(","));
}

function normalizeShoutcastText(input: {
  text: string;
  streamUrl: string;
  resolvedUrl?: string;
  isSevenHtml?: boolean;
  sampledAt: number;
  expiresAt: number;
}): RadioNowPlaying | null {
  const rawTitle = input.isSevenHtml
    ? getShoutcast7HtmlTitle(input.text)
    : asString(input.text);
  if (!rawTitle || rawTitle === "-" || rawTitle === "- -") {
    return null;
  }
  return buildNowPlaying({
    expiresAt: input.expiresAt,
    resolvedUrl: input.resolvedUrl,
    sampledAt: input.sampledAt,
    source: "shoutcast-status",
    streamUrl: input.streamUrl,
    titles: parseRadioTitle(rawTitle),
  });
}

async function tryShoutcastUrl(
  input: ExternalMetadataProviderInput,
  url: string
): Promise<RadioNowPlaying | null> {
  if (url.includes("json=1") || url.includes("/stats")) {
    const result = await fetchObjectJson(input.fetchImpl, url);
    return result
      ? normalizeShoutcastJson({
          data: result.data,
          expiresAt: input.expiresAt,
          resolvedUrl: result.response.url || url,
          sampledAt: input.sampledAt,
          streamUrl: input.streamUrl,
        })
      : null;
  }

  const result = await fetchText(input.fetchImpl, url);
  return result
    ? normalizeShoutcastText({
        expiresAt: input.expiresAt,
        isSevenHtml: url.includes("/7.html"),
        resolvedUrl: result.response.url || url,
        sampledAt: input.sampledAt,
        streamUrl: input.streamUrl,
        text: result.text,
      })
    : null;
}

export async function tryShoutcastStatus(
  input: ExternalMetadataProviderInput,
  options: { endpoint?: string; sid?: string } = {}
): Promise<RadioNowPlaying | null> {
  const urls = options.endpoint
    ? [options.endpoint]
    : getShoutcastCandidateUrls(input.streamUrl, options.sid);
  return await findSequential([...new Set(urls)], async (url) => {
    try {
      return await tryShoutcastUrl(input, url);
    } catch (error) {
      if (shouldPropagateFetchError(error)) {
        throw error;
      }
      return null;
    }
  });
}

export async function tryAirtimeLiveInfo(
  input: ExternalMetadataProviderInput,
  urls = getAirtimeCandidateUrls(input.streamUrl)
): Promise<RadioNowPlaying | null> {
  return await findSequential([...new Set(urls)], async (url) => {
    let result: Awaited<ReturnType<typeof fetchObjectJson>>;
    try {
      result = await fetchObjectJson(input.fetchImpl, url);
    } catch (error) {
      if (shouldPropagateFetchError(error)) {
        throw error;
      }
      return null;
    }
    if (!result) {
      return null;
    }
    const data = result.data as AirtimeLiveInfo;
    const nowPlaying = normalizeAirtimeLiveInfo({
      data,
      expiresAt: input.expiresAt,
      resolvedUrl: result.response.url || url,
      sampledAt: input.sampledAt,
      streamUrl: input.streamUrl,
    });
    return nowPlaying
      ? await cachedAirtimeEnrichment(input, data, nowPlaying)
      : null;
  });
}

const NTS_LIVE_URL = "https://www.nts.live/api/v2/live";
const NTS_SLOT_KEY_PATTERN = /^(?:now|next\d*)$/;
const NTS_TIMESTAMP_PATTERN =
  /T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

type NtsLiveSlot = {
  broadcast_title?: unknown;
  start_timestamp?: unknown;
  end_timestamp?: unknown;
  links?: Link[];
  embeds?: {
    details?: {
      name?: unknown;
      description?: unknown;
      genres?: { value?: unknown }[];
      media?: { picture_medium?: unknown };
      links?: Link[];
    };
  };
};

function ntsTimestamp(value: unknown): number | null {
  const timestamp = asString(value);
  if (!(timestamp && NTS_TIMESTAMP_PATTERN.test(timestamp))) {
    return null;
  }
  const time = Date.parse(timestamp);
  return Number.isFinite(time) ? time : null;
}

function selectNtsLiveSlot(
  channel: Record<string, unknown>,
  at: number
): { slot: NtsLiveSlot; endsAt: number | null } | null {
  const slots = Object.entries(channel)
    .filter(
      ([key, value]) =>
        NTS_SLOT_KEY_PATTERN.test(key) && value && typeof value === "object"
    )
    .map(([, value]) => {
      const slot = value as NtsLiveSlot;
      const startsAt = ntsTimestamp(slot.start_timestamp);
      const endsAt = ntsTimestamp(slot.end_timestamp);
      return { endsAt, slot, startsAt };
    });
  const [current] = slots
    .filter(
      (entry) =>
        entry.startsAt !== null &&
        entry.endsAt !== null &&
        entry.startsAt <= at &&
        at < entry.endsAt
    )
    .sort((a, b) => (b.startsAt ?? 0) - (a.startsAt ?? 0));
  if (current) {
    return { endsAt: current.endsAt, slot: current.slot };
  }
  const now = slots.find((entry) => entry.slot === channel.now);
  if (
    now &&
    now.startsAt === null &&
    !slots.some((entry) => entry.startsAt !== null && entry.startsAt <= at)
  ) {
    return { endsAt: null, slot: now.slot };
  }
  return null;
}

function ntsFeedExpiresAt(
  data: object,
  at: number,
  maxExpiresAt: number
): number {
  const { results } = data as { results?: unknown };
  if (!Array.isArray(results)) {
    return Math.min(maxExpiresAt, at + 60_000);
  }
  const channelEnds = (["1", "2"] as const)
    .map((name) =>
      results.find(
        (value) =>
          value &&
          typeof value === "object" &&
          (value as { channel_name?: unknown }).channel_name === name
      )
    )
    .filter((value): value is Record<string, unknown> => !!value)
    .map((channel) => {
      const windows = Object.entries(channel)
        .filter(([key]) => NTS_SLOT_KEY_PATTERN.test(key))
        .map(([, slot]) => ({
          end: ntsTimestamp((slot as NtsLiveSlot | null)?.end_timestamp),
          start: ntsTimestamp((slot as NtsLiveSlot | null)?.start_timestamp),
        }))
        .filter(
          (window): window is { start: number; end: number } =>
            window.start !== null && window.end !== null && window.end > at
        )
        .sort((a, b) => a.start - b.start);
      let coveredUntil = at;
      for (const window of windows) {
        if (window.start > coveredUntil) {
          break;
        }
        coveredUntil = Math.max(coveredUntil, window.end);
      }
      return coveredUntil > at ? coveredUntil : at + 60_000;
    });
  return Math.min(
    maxExpiresAt,
    ...(channelEnds.length ? channelEnds : [at + 60_000])
  );
}

export async function tryNtsLiveApi(
  input: ExternalMetadataProviderInput,
  requestedChannel?: "1" | "2"
): Promise<RadioNowPlaying | null> {
  try {
    const feed = await cacheMetadata({
      cache: input.cache,
      expiresAt: (value) => value?.expiresAt ?? 0,
      key: ["nts", "live-feed", NTS_LIVE_URL],
      now: input.now,
      retrieve: async () => {
        const result = await fetchObjectJson(input.fetchImpl, NTS_LIVE_URL);
        if (!result) {
          return null;
        }
        return {
          data: result.data,
          expiresAt: ntsFeedExpiresAt(
            result.data,
            input.sampledAt,
            input.expiresAt
          ),
          resolvedUrl: result.response.url || NTS_LIVE_URL,
          sampledAt: input.sampledAt,
        };
      },
      shouldCache: (value) =>
        !!value && Array.isArray((value.data as { results?: unknown }).results),
      ttl: RADIO_METADATA_SUCCESS_TTL_MS / 1000,
    });
    const selectedChannel =
      requestedChannel ??
      (new URL(input.streamUrl).pathname === "/stream2" ? "2" : "1");
    return feed
      ? normalizeNtsLiveApi(
          { ...input, expiresAt: feed.expiresAt, sampledAt: feed.sampledAt },
          feed.data,
          selectedChannel,
          feed.resolvedUrl,
          input.sampledAt
        )
      : null;
  } catch (error) {
    if (shouldPropagateFetchError(error)) {
      throw error;
    }
    return null;
  }
}

function normalizeNtsLiveApi(
  input: ExternalMetadataProviderInput,
  data: object,
  channelName: "1" | "2",
  resolvedUrl: string,
  at = input.sampledAt
): RadioNowPlaying | null {
  const { results } = data as { results?: unknown };
  const channel = Array.isArray(results)
    ? results.find(
        (item) =>
          (item as { channel_name?: unknown }).channel_name === channelName
      )
    : null;
  if (!(channel && typeof channel === "object")) {
    return null;
  }
  const selected = selectNtsLiveSlot(channel as Record<string, unknown>, at);
  const now = selected?.slot;
  const title =
    asString(now?.broadcast_title) ?? asString(now?.embeds?.details?.name);
  if (!title) {
    return null;
  }

  const apiItemUrl =
    now?.links?.find((link) => asString(link.rel) === "details")?.href ??
    now?.embeds?.details?.links?.find((link) => asString(link.rel) === "self")
      ?.href;
  const itemUrl = asPublicUrl(apiItemUrl)?.replace(
    "https://www.nts.live/api/v2/shows/",
    "https://www.nts.live/shows/"
  );

  return buildNowPlaying({
    artworkUrl: resolvePublicUrl(
      now?.embeds?.details?.media?.picture_medium,
      "https://www.nts.live"
    ),
    expiresAt: Math.min(input.expiresAt, selected?.endsAt ?? input.expiresAt),
    genre: asString(now?.embeds?.details?.genres?.[0]?.value),
    itemUrl,
    resolvedUrl,
    sampledAt: input.sampledAt,
    source: "nts-live-api",
    stationDescription: asString(now?.embeds?.details?.description),
    stationName: `NTS Radio | Channel ${channelName}`,
    streamUrl: input.streamUrl,
    titles: parseRadioTitle(title),
  });
}

function getHkcrScheduleWindow(
  entry: HkcrScheduleEntry
): { start: number; end: number } | null {
  const date = asString(entry.date);
  const startTime = asString(entry.startTime);
  const endTime = asString(entry.endTime);
  if (!(date && startTime && endTime)) {
    return null;
  }
  if (
    !(
      HKCR_DATE_PATTERN.test(date) &&
      HKCR_TIME_PATTERN.test(startTime) &&
      HKCR_TIME_PATTERN.test(endTime)
    )
  ) {
    return null;
  }

  const start = Date.parse(`${date}T${startTime}:00+08:00`);
  let end = Date.parse(`${date}T${endTime}:00+08:00`);
  if (
    !(
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      new Date(start + HKCR_UTC_OFFSET_MS).toISOString().slice(0, 16) ===
        `${date}T${startTime}` &&
      new Date(end + HKCR_UTC_OFFSET_MS).toISOString().slice(0, 16) ===
        `${date}T${endTime}`
    )
  ) {
    return null;
  }
  if (end <= start) {
    end += 24 * 60 * 60 * 1000;
  }
  return { end, start };
}

function findCurrentHkcrEntry(
  data: object,
  sampledAt: number
): HkcrScheduleEntry | null {
  if (!Array.isArray(data)) {
    return null;
  }
  return (
    data.find((candidate) => {
      if (asString(candidate.status)?.startsWith("cancelled")) {
        return false;
      }
      const window = getHkcrScheduleWindow(candidate as HkcrScheduleEntry);
      return window && sampledAt >= window.start && sampledAt < window.end;
    }) ?? null
  );
}

function normalizeHkcrSchedule(input: {
  entry: HkcrScheduleEntry;
  streamUrl: string;
  resolvedUrl?: string;
  sampledAt: number;
  expiresAt: number;
  showUrl?: string | null;
}): RadioNowPlaying | null {
  const { entry } = input;
  const title = asString(entry.title);
  if (!title) {
    return null;
  }

  const artist = asString(entry.resident?.name);
  const residentSlug = asString(entry.resident?.slug);
  const result = buildNowPlaying({
    artworkUrl:
      asPublicUrl(entry.thumbnail?.url) ?? asPublicUrl(entry.picture?.url),
    expiresAt: Math.min(
      input.expiresAt,
      getHkcrScheduleWindow(entry)?.end ?? input.expiresAt
    ),
    itemUrl:
      input.showUrl ??
      (residentSlug
        ? new URL(
            `/residents/${encodeURIComponent(residentSlug)}`,
            "https://hkcr.live"
          ).toString()
        : null),
    resolvedUrl: input.resolvedUrl,
    sampledAt: input.sampledAt,
    source: "hkcr-schedule",
    stationDescription: plainText(entry.description),
    stationName: "HKCR",
    streamUrl: input.streamUrl,
    titles: parseRadioTitle(
      artist && artist !== title ? `${artist} - ${title}` : title
    ),
  });
  return result
    ? {
        ...result,
        artist: cleanMetadataText(artist) || null,
        title: cleanMetadataText(title) || null,
      }
    : null;
}

export async function tryHkcrSchedule(
  input: ExternalMetadataProviderInput
): Promise<RadioNowPlaying | null> {
  let result: Awaited<ReturnType<typeof fetchObjectJson>>;
  try {
    result = await fetchObjectJson(
      input.fetchImpl,
      hkcrRangeUrl(HKCR_SCHEDULE_URL, input.sampledAt, -1)
    );
  } catch (error) {
    if (shouldPropagateFetchError(error)) {
      throw error;
    }
    return null;
  }
  if (!result) {
    return null;
  }
  const entry =
    findCurrentHkcrEntry(result.data, input.sampledAt) ??
    (await findCurrentHkcrReplay(input));
  if (!entry) {
    return null;
  }
  const showId = asString(entry.show);
  const show = showId ? await fetchHkcrShow(input, showId) : null;
  const slug = asString(show?.slug);
  const showUrl = slug
    ? new URL(
        `/shows/${encodeURIComponent(slug)}`,
        "https://hkcr.live"
      ).toString()
    : null;
  const normalized = normalizeHkcrSchedule({
    entry: {
      ...entry,
      description: asString(show?.content) ?? asString(entry.description),
      resident: entry.resident ?? show?.resident,
      thumbnail: {
        url:
          asPublicUrl(entry.thumbnail?.url) ??
          asPublicUrl(entry.picture?.url) ??
          asPublicUrl(show?.medium?.url) ??
          asPublicUrl(show?.thumbnail?.url) ??
          asPublicUrl(show?.picture?.url),
      },
      title: asString(entry.title) ?? asString(show?.title),
    },
    expiresAt: input.expiresAt,
    resolvedUrl: result.response.url || HKCR_SCHEDULE_URL,
    sampledAt: input.sampledAt,
    showUrl,
    streamUrl: input.streamUrl,
  });
  return normalized
    ? {
        ...normalized,
        genre: hkcrGenre(show?.tags, [
          normalized.artist,
          normalized.title,
          normalized.album,
          show?.title,
        ]),
      }
    : null;
}

/** HKCR tags repeat show and resident names; those are not genres. */
function hkcrGenre(
  tags: HkcrShow["tags"],
  names: readonly unknown[]
): string | null {
  const key = (value: unknown) =>
    cleanMetadataText(asString(value))
      .normalize("NFKC")
      .replace(WHITESPACE_PATTERN, "")
      .toLowerCase();
  // "ether radio w/ Freddy Carrasco" also names the programme "ether radio".
  const programmes = names.map(
    (name) => asString(name)?.split(HKCR_GUEST_SEPARATOR_PATTERN)[0]
  );
  const excluded = new Set([...names, ...programmes].map(key).filter(Boolean));
  return (
    tags
      ?.map((tag) => asString(tag.name))
      .filter((name): name is string => !!name && !excluded.has(key(name)))
      .join(", ") || null
  );
}

async function fetchHkcrShow(
  input: ExternalMetadataProviderInput,
  showId: string
): Promise<HkcrShow | null> {
  try {
    return await cacheMetadata({
      cache: input.cache,
      key: ["hkcr", "show-details-v2", HKCR_SHOW_URL, showId],
      now: input.now,
      retrieve: async () => {
        const result = await fetchObjectJson(
          input.fetchImpl,
          `${HKCR_SHOW_URL}/${encodeURIComponent(showId)}`
        );
        const candidate = result?.data as HkcrShow | undefined;
        if (candidate?._id !== showId) {
          return null;
        }
        return {
          content: plainText(candidate.content),
          medium: { url: asPublicUrl(candidate.medium?.url) },
          picture: { url: asPublicUrl(candidate.picture?.url) },
          resident: {
            name: asString(candidate.resident?.name),
            slug: asString(candidate.resident?.slug),
          },
          slug: asString(candidate.slug),
          tags: candidate.tags?.map((tag) => ({ name: asString(tag.name) })),
          thumbnail: { url: asPublicUrl(candidate.thumbnail?.url) },
          title: asString(candidate.title),
        };
      },
      ttl: EPISODE_METADATA_TTL,
    });
  } catch (error) {
    if (error instanceof RadioMetadataValidationError) {
      throw error;
    }
    return null;
  }
}

function hkcrRangeUrl(
  endpoint: string,
  sampledAt: number,
  startOffset: number
): string {
  const date = (offset: number) =>
    new Date(sampledAt + HKCR_UTC_OFFSET_MS + offset * 86_400_000)
      .toISOString()
      .slice(0, 10);
  const url = new URL(endpoint);
  url.searchParams.set("startDate", date(startOffset));
  url.searchParams.set("endDate", date(1));
  return url.toString();
}

async function findCurrentHkcrReplay(
  input: ExternalMetadataProviderInput
): Promise<HkcrScheduleEntry | null> {
  let result: Awaited<ReturnType<typeof fetchObjectJson>>;
  try {
    result = await fetchObjectJson(
      input.fetchImpl,
      hkcrRangeUrl(
        "https://cms.hkcr.live/replay-slots/range",
        input.sampledAt,
        -1
      )
    );
  } catch (error) {
    if (shouldPropagateFetchError(error)) {
      throw error;
    }
    return null;
  }
  const slots = (result?.data as { slots?: HkcrReplaySlot[] } | undefined)
    ?.slots;
  if (!Array.isArray(slots)) {
    return null;
  }
  const matches = slots.filter(
    (candidate) =>
      input.sampledAt >= Date.parse(asString(candidate.start) ?? "") &&
      input.sampledAt < Date.parse(asString(candidate.end) ?? "")
  );
  const slot = matches.length === 1 ? matches[0] : null;
  return slot
    ? { show: slot.show ?? slot.replay?.show, title: slot.replay?.title }
    : null;
}

function normalizeResonanceExtraSchedule(input: {
  data: object;
  streamUrl: string;
  resolvedUrl?: string;
  sampledAt: number;
  expiresAt: number;
}): RadioNowPlaying | null {
  const { after, now } = input.data as ResonanceExtraSchedule;
  if (!asString(now?.name)) {
    return null;
  }
  return buildNowPlaying({
    album: asString(now?.series_name),
    artworkUrl: resolvePublicUrl(
      now?.backgrounds?.[0]?.image,
      "https://x.resonance.fm"
    ),
    expiresAt: boundaryExpiresAt(
      input,
      resonanceWindow(now?.starts_ends)?.end ??
        resonanceWindow(after?.starts_ends)?.start
    ),
    itemUrl:
      resolvePublicUrl(now?.path, "https://extra.resonance.fm") ??
      resolvePublicUrl(now?.series_link, "https://extra.resonance.fm"),
    resolvedUrl: input.resolvedUrl,
    sampledAt: input.sampledAt,
    source: "resonance-extra-api",
    stationDescription: markdownText(now?.description),
    stationName: "Resonance Extra",
    streamUrl: input.streamUrl,
    titles: parseRadioTitleParts({
      artist: asString(now?.host),
      title: asString(now?.name),
    }),
  });
}

/** Parses "Tuesday 29th September 2026 22:30 - 23:00 BST". */
function resonanceWindow(
  value: unknown
): { start: number; end: number } | null {
  const match = asString(value)?.match(RESONANCE_SCHEDULE_PATTERN);
  const month = RESONANCE_MONTHS.indexOf(match?.[2]?.toLowerCase() ?? "");
  const offset = UK_ZONE_OFFSETS_MS.get(match?.[8]?.toLowerCase() ?? "");
  if (!match || month < 0 || offset === undefined) {
    return null;
  }
  const [day, year, startHour, startMinute, endHour, endMinute] = [
    1, 3, 4, 5, 6, 7,
  ].map((index) => Number(match[index]));
  if (
    Math.max(startHour, endHour) > 23 ||
    Math.max(startMinute, endMinute) > 59
  ) {
    return null;
  }
  const start = Date.UTC(year, month, day, startHour, startMinute);
  if (new Date(start).getUTCDate() !== day) {
    return null;
  }
  let end = Date.UTC(year, month, day, endHour, endMinute);
  if (end <= start) {
    end += DAY_MS;
  }
  return { end: end - offset, start: start - offset };
}

export async function tryResonanceExtraApi(
  input: ExternalMetadataProviderInput
): Promise<RadioNowPlaying | null> {
  let result: Awaited<ReturnType<typeof fetchObjectJson>>;
  try {
    result = await fetchObjectJson(input.fetchImpl, RESONANCE_EXTRA_API_URL);
  } catch (error) {
    if (shouldPropagateFetchError(error)) {
      throw error;
    }
    return null;
  }
  return result
    ? normalizeResonanceExtraSchedule({
        data: result.data,
        expiresAt: input.expiresAt,
        resolvedUrl: result.response.url || RESONANCE_EXTRA_API_URL,
        sampledAt: input.sampledAt,
        streamUrl: input.streamUrl,
      })
    : null;
}

function normalizeRadioAlharaNowPlaying(input: {
  data: object;
  streamUrl: string;
  resolvedUrl?: string;
  sampledAt: number;
  expiresAt: number;
}): RadioNowPlaying | null {
  const data = input.data as RadioAlharaNowPlaying;
  const title =
    asString(data.episodeTitle) ??
    asString(data.title) ??
    asString(data.scheduledTitle);
  if (!title) {
    return null;
  }

  const showTitle = asString(data.scheduledTitle) ?? asString(data.title);
  const trackStart = Date.parse(asString(data.trackStart) ?? "");
  const { duration } = data;
  const predictedEnd =
    Number.isFinite(trackStart) &&
    typeof duration === "number" &&
    Number.isFinite(duration) &&
    duration > 0
      ? trackStart + duration * 1000
      : null;
  const nextCheck = Math.min(input.expiresAt, input.sampledAt + 5 * 60_000);
  let expiresAt = nextCheck;
  if (predictedEnd !== null) {
    expiresAt = Math.min(
      nextCheck,
      predictedEnd > input.sampledAt ? predictedEnd : input.sampledAt + 60_000
    );
  }
  return buildNowPlaying({
    album: showTitle === title ? null : showTitle,
    expiresAt,
    resolvedUrl: input.resolvedUrl,
    sampledAt: input.sampledAt,
    source: "radio-alhara-api",
    stationName: "Radio Alhara",
    streamUrl: input.streamUrl,
    titles: parseRadioTitleParts({ artist: asString(data.artist), title }),
  });
}

export async function tryRadioAlharaApi(
  input: ExternalMetadataProviderInput
): Promise<RadioNowPlaying | null> {
  let result: Awaited<ReturnType<typeof fetchObjectJson>>;
  try {
    result = await fetchObjectJson(
      input.fetchImpl,
      RADIO_ALHARA_NOW_PLAYING_URL
    );
  } catch (error) {
    if (shouldPropagateFetchError(error)) {
      throw error;
    }
    return null;
  }
  return result
    ? normalizeRadioAlharaNowPlaying({
        data: result.data,
        expiresAt: input.expiresAt,
        resolvedUrl: result.response.url || RADIO_ALHARA_NOW_PLAYING_URL,
        sampledAt: input.sampledAt,
        streamUrl: input.streamUrl,
      })
    : null;
}

export async function tryRadioBlackoutApi(
  input: ExternalMetadataProviderInput,
  endpoint = "https://radioblackout.org/api/listening"
): Promise<RadioNowPlaying | null> {
  let result: Awaited<ReturnType<typeof fetchObjectJson>>;
  try {
    result = await fetchObjectJson(input.fetchImpl, endpoint);
  } catch (error) {
    if (shouldPropagateFetchError(error)) {
      throw error;
    }
    return null;
  }
  if (!result) {
    return null;
  }
  const data = result.data as BlackoutListening;
  const title = asString(data.title);
  if (!title) {
    return null;
  }
  const resolvedUrl = result.response.url || endpoint;
  const nowPlaying = buildNowPlaying({
    artworkUrl: resolvePublicUrl(data.featured_media, resolvedUrl),
    expiresAt: boundaryExpiresAt(
      input,
      blackoutSlotEnd(data.slot, input.sampledAt)
    ),
    itemUrl: asPublicUrl(data.link),
    resolvedUrl,
    sampledAt: input.sampledAt,
    source: "radio-blackout-api",
    stationDescription: plainText(data.excerpt),
    stationName: "Radio BlackOut",
    streamUrl: input.streamUrl,
    titles: parseRadioTitle(title),
  });
  return nowPlaying ? await enrichBlackoutShow(input, nowPlaying) : null;
}

function slotMinutes(value: unknown): number | null {
  const match = asString(value)?.match(SLOT_TIME_PATTERN);
  const hours = Number(match?.[1]);
  const minutes = Number(match?.[2]);
  return match && hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
}

/**
 * The end of BlackOut's weekly `slot` ("23:00"–"00:00", Rome time) when the
 * slot is on air now. The slot has no date, so an off-air slot gives nothing.
 */
function blackoutSlotEnd(
  slot: BlackoutListening["slot"],
  sampledAt: number
): number | null {
  const start = slotMinutes(slot?.start);
  const end = slotMinutes(slot?.end);
  if (start === null || end === null) {
    return null;
  }
  try {
    const nowWall = airtimeLocalTime(sampledAt, BLACKOUT_TIME_ZONE);
    const midnight = Math.floor(nowWall / DAY_MS) * DAY_MS;
    let startWall = midnight + start * 60_000;
    let endWall = midnight + end * 60_000;
    if (endWall <= startWall) {
      if (nowWall < endWall) {
        startWall -= DAY_MS;
      } else {
        endWall += DAY_MS;
      }
    }
    if (!(startWall <= nowWall && nowWall < endWall)) {
      return null;
    }
    const candidate = Math.floor(sampledAt / 1000) * 1000 + (endWall - nowWall);
    return airtimeLocalTime(candidate, BLACKOUT_TIME_ZONE) === endWall
      ? candidate
      : null;
  } catch {
    return null;
  }
}

async function enrichBlackoutShow(
  input: ExternalMetadataProviderInput,
  nowPlaying: RadioNowPlaying
): Promise<RadioNowPlaying> {
  const itemUrl = nowPlaying.itemUrl ? new URL(nowPlaying.itemUrl) : null;
  const match = itemUrl?.pathname.match(SHOW_PATH_PATTERN);
  if (itemUrl?.origin !== "https://radioblackout.org" || !match?.[1]) {
    return nowPlaying;
  }
  try {
    const slug = decodeURIComponent(match[1]);
    const url = new URL("https://radioblackout.org/wp-json/wp/v2/shows");
    url.searchParams.set("slug", slug);
    const details = await cacheMetadata({
      cache: input.cache,
      key: [
        "blackout",
        "show-details",
        url.toString(),
        itemUrl.toString(),
        comparableTitle(nowPlaying.title),
      ],
      now: input.now,
      retrieve: async () => {
        const result = await fetchObjectJson(input.fetchImpl, url.toString());
        if (!Array.isArray(result?.data)) {
          return null;
        }
        const records = result.data as BlackoutShow[];
        if (records.length === 0) {
          return { genre: null, stationDescription: null };
        }
        const show = records.length === 1 ? records[0] : null;
        if (
          asString(show?.slug) !== slug ||
          asPublicUrl(show?.link) !== itemUrl.toString() ||
          comparableTitle(show?.title) !== comparableTitle(nowPlaying.title)
        ) {
          return null;
        }
        return {
          genre: asStringArray(show?.tags).join(", ") || null,
          stationDescription: plainText(show?.content),
        };
      },
      ttl: EPISODE_METADATA_TTL,
    });
    return {
      ...nowPlaying,
      genre: details?.genre ?? nowPlaying.genre,
      stationDescription:
        details?.stationDescription ?? nowPlaying.stationDescription,
    };
  } catch (error) {
    if (error instanceof RadioMetadataValidationError) {
      throw error;
    }
    return nowPlaying;
  }
}
