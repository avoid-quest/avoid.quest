import {
  cacheMetadata,
  EPISODE_METADATA_TTL,
  type MetadataKv,
  RADIO_METADATA_SUCCESS_TTL_MS,
} from "./cache";
import { cleanMetadataText, parseRadioTitle } from "./title-parser";
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
const IPR_REPLAY_SUFFIX_PATTERN = /\s*\((?:r|replay)\)\s*$/i;
const IPR_SEARCH_URL = "https://www.internetpublicradio.live/api/search";
const INTEGER_FIELD_PATTERN = /^\d+$/;
const HTML_TAG_PATTERN = /<[^>]*>/g;
const RADIO_ALHARA_NOW_PLAYING_URL =
  "https://ch2.radioalhara.net/api/now-playing";
const RESONANCE_EXTRA_API_URL =
  "https://x.resonance.fm/api/current_and_upcoming";
const SANITY_IMAGE_REF_PATTERN = /^image-([a-f\d]+)-(\d+x\d+)-([a-z\d]+)$/i;
const TRAILING_SLASH_PATTERN = /\/$/;
const WHITESPACE_PATTERN = /\s+/g;

export type ExternalMetadataProviderInput = {
  kv?: MetadataKv;
  now?: () => number;
  fetchImpl: FetchLike;
  streamUrl: string;
  sampledAt: number;
  expiresAt: number;
};

type AirtimeTrack = {
  album_artwork_image?: unknown;
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
  };
};

type RadioAlharaNowPlaying = {
  artist?: unknown;
  episodeTitle?: unknown;
  scheduledTitle?: unknown;
  title?: unknown;
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

function buildNowPlaying(input: {
  streamUrl: string;
  resolvedUrl?: string;
  source: RadioMetadataSource;
  rawTitle: string;
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
  const parsed = parseRadioTitle(input.rawTitle);
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
  const artist = asString(metadata?.artist_name);
  const title = asString(metadata?.track_title) ?? asString(track?.name);
  const showName = asString(show?.name);
  const rawTitle =
    [artist, title].filter(Boolean).join(" - ") || title || showName;
  if (!rawTitle) {
    return null;
  }

  return buildNowPlaying({
    album: asString(metadata?.album_title),
    artworkUrl:
      asPublicUrl(metadata?.artwork_url) ??
      asPublicUrl(metadata?.artwork) ??
      asPublicUrl(track?.album_artwork_image) ??
      asPublicUrl(show?.image_path),
    expiresAt: input.expiresAt,
    genre: asString(metadata?.genre),
    itemUrl: getAirtimeItemUrl({
      metadata,
      show,
      streamUrl: input.streamUrl,
    }),
    rawTitle,
    resolvedUrl: input.resolvedUrl,
    sampledAt: input.sampledAt,
    source: "airtime-live-info",
    stationDescription: asString(show?.description),
    stationName: AIRTIME_STATION_NAMES[new URL(input.streamUrl).hostname],
    streamUrl: input.streamUrl,
  });
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
    const text = await response.text();
    return text.trim() ? { response, text } : null;
  } catch {
    return null;
  }
}

function comparableTitle(value: unknown): string | null {
  const text = asString(value);
  const rawTitle = text ? parseRadioTitle(text).rawTitle : null;
  return rawTitle
    ? rawTitle.normalize("NFKC").replace(/\s+/g, " ").toLowerCase()
    : null;
}

async function enrichSygmaNowPlaying(
  fetchImpl: FetchLike,
  nowPlaying: RadioNowPlaying
): Promise<RadioNowPlaying> {
  if (
    (nowPlaying.artworkUrl && nowPlaying.stationDescription) ||
    !nowPlaying.itemUrl
  ) {
    return nowPlaying;
  }
  const itemUrl = new URL(nowPlaying.itemUrl);
  if (
    itemUrl.hostname !== "radio.syg.ma" ||
    !itemUrl.pathname.startsWith("/episodes/")
  ) {
    return nowPlaying;
  }
  const encodedSlug = itemUrl.pathname.split("/").filter(Boolean).at(-1);
  const slug = encodedSlug ? decodeURIComponent(encodedSlug) : null;
  if (!slug) {
    return nowPlaying;
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
    return nowPlaying;
  }
  return {
    ...nowPlaying,
    artworkUrl: nowPlaying.artworkUrl ?? asPublicUrl(episode.picture?.url),
    stationDescription:
      nowPlaying.stationDescription ?? asString(episode.description),
  };
}

function comparableCashmereTitle(value: unknown): string | null {
  return comparableTitle(asString(value)?.replaceAll("_", " "));
}

async function enrichCashmereNowPlaying(
  fetchImpl: FetchLike,
  nowPlaying: RadioNowPlaying
): Promise<RadioNowPlaying> {
  const showUrl = getCashmereShowUrl(nowPlaying.itemUrl);
  if (showUrl) {
    if (nowPlaying.artworkUrl && nowPlaying.stationDescription) {
      return nowPlaying;
    }
    const result = await fetchObjectJson(
      fetchImpl,
      `${CASHMERE_REST_URL}/pages?slug=${encodeURIComponent(showUrl.slug)}&_embed=wp%3Afeaturedmedia&_fields=slug%2Clink%2Ccontent%2C_links%2C_embedded`
    );
    const shows = Array.isArray(result?.data)
      ? (result.data as CashmereShow[])
      : [];
    const [show] = shows;
    if (
      shows.length !== 1 ||
      asString(show?.slug) !== showUrl.slug ||
      !cashmereBackendLinkMatches(show?.link, showUrl.pathname)
    ) {
      return nowPlaying;
    }
    return {
      ...nowPlaying,
      artworkUrl:
        nowPlaying.artworkUrl ??
        asPublicUrl(show?._embedded?.["wp:featuredmedia"]?.[0]?.source_url),
      stationDescription:
        nowPlaying.stationDescription ?? plainText(show?.content?.rendered),
    };
  }
  if (
    (nowPlaying.artworkUrl &&
      nowPlaying.itemUrl &&
      nowPlaying.stationDescription &&
      nowPlaying.genre) ||
    !nowPlaying.title
  ) {
    return nowPlaying;
  }
  const result = await fetchObjectJson(fetchImpl, CASHMERE_GRAPHQL_URL, {
    body: JSON.stringify({
      query:
        "query SearchEpisode($q: String!) { episodes(where: {search: $q}, first: 10) { nodes { databaseId title uri featuredImage { node { sourceUrl } } } } }",
      variables: { q: nowPlaying.title.replace(AUDIO_EXTENSION_PATTERN, "") },
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const responseData = result?.data as
    | { data?: { episodes?: { nodes?: CashmereEpisode[] } } }
    | undefined;
  const nodes = responseData?.data?.episodes?.nodes;
  const matches = nodes?.filter(
    (node) =>
      comparableCashmereTitle(node.title) ===
      comparableCashmereTitle(
        nowPlaying.title?.replace(AUDIO_EXTENSION_PATTERN, "")
      )
  );
  if (matches?.length !== 1) {
    return await enrichCashmereShowByTitle(fetchImpl, nowPlaying);
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
  return await enrichCashmereEpisodeRecord(fetchImpl, enriched, episode);
}

async function enrichCashmereShowByTitle(
  fetchImpl: FetchLike,
  nowPlaying: RadioNowPlaying
): Promise<RadioNowPlaying> {
  const title = nowPlaying.title
    ?.replace(AUDIO_EXTENSION_PATTERN, "")
    .replace(CASHMERE_RECORDING_DATE_PATTERN, "")
    .trim();
  if (!title || nowPlaying.itemUrl) {
    return nowPlaying;
  }
  const url = new URL(`${CASHMERE_REST_URL}/pages`);
  url.searchParams.set("search", title);
  url.searchParams.set("per_page", "20");
  url.searchParams.set("_embed", "wp:featuredmedia");
  url.searchParams.set("_fields", "title,slug,link,content,_links,_embedded");
  const result = await fetchObjectJson(fetchImpl, url.toString());
  const matches = Array.isArray(result?.data)
    ? (result.data as CashmereShow[]).filter(
        (candidate) =>
          comparableCashmereTitle(candidate.title?.rendered) ===
          comparableCashmereTitle(title)
      )
    : [];
  const show = matches.length === 1 ? matches[0] : null;
  const slug = asString(show?.slug);
  const pathname = slug ? `/shows/${encodeURIComponent(slug)}/` : null;
  if (!(show && pathname && cashmereBackendLinkMatches(show.link, pathname))) {
    return nowPlaying;
  }
  return {
    ...nowPlaying,
    artworkUrl:
      nowPlaying.artworkUrl ??
      asPublicUrl(show._embedded?.["wp:featuredmedia"]?.[0]?.source_url),
    itemUrl: new URL(pathname, "https://cashmereradio.com").toString(),
    stationDescription:
      nowPlaying.stationDescription ?? plainText(show.content?.rendered),
  };
}

async function enrichCashmereEpisodeRecord(
  fetchImpl: FetchLike,
  nowPlaying: RadioNowPlaying,
  episode: CashmereEpisode | undefined
): Promise<RadioNowPlaying> {
  const databaseId = episode?.databaseId;
  const episodeUrl = getCashmereEpisodeUrl(nowPlaying.itemUrl);
  if (
    !(
      typeof databaseId === "number" &&
      Number.isSafeInteger(databaseId) &&
      episodeUrl
    )
  ) {
    return nowPlaying;
  }
  const detailResult = await fetchObjectJson(
    fetchImpl,
    `${CASHMERE_REST_URL}/episode/${databaseId}?_fields=id%2Cslug%2Clink%2Ccontent%2Cacf`
  );
  const record = detailResult?.data as CashmereEpisodeRecord | undefined;
  if (
    record?.id !== databaseId ||
    asString(record.slug) !== episodeUrl.slug ||
    !cashmereBackendLinkMatches(record.link, episodeUrl.pathname)
  ) {
    return nowPlaying;
  }
  const tags = [
    ...asStringArray(record.acf?.episode_filter_genre),
    ...asStringArray(record.acf?.episode_filter_mood),
  ];
  return {
    ...nowPlaying,
    genre: nowPlaying.genre ?? ([...new Set(tags)].join(", ") || null),
    stationDescription:
      nowPlaying.stationDescription ?? plainText(record.content?.rendered),
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
): Promise<RadioNowPlaying> {
  if (
    (nowPlaying.artworkUrl &&
      nowPlaying.itemUrl &&
      nowPlaying.stationDescription) ||
    !nowPlaying.title
  ) {
    return nowPlaying;
  }
  const title = nowPlaying.title.replace(IPR_REPLAY_SUFFIX_PATTERN, "").trim();
  const url = new URL(IPR_SEARCH_URL);
  url.searchParams.set("q", title);
  const result = await fetchObjectJson(fetchImpl, url.toString());
  if (!(result && Array.isArray(result.data))) {
    return nowPlaying;
  }

  const matches = (result.data as IprSearchResult[]).filter(
    (candidate) => comparableTitle(candidate.label) === comparableTitle(title)
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
    : enriched;
}

async function enrichIprDescription(
  fetchImpl: FetchLike,
  nowPlaying: RadioNowPlaying,
  selected: IprSearchResult
): Promise<RadioNowPlaying> {
  const id = asString(selected._id);
  if (!id || nowPlaying.stationDescription) {
    return nowPlaying;
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
      return nowPlaying;
    }
    return { ...nowPlaying, stationDescription: asString(record.description) };
  } catch (error) {
    if (error instanceof RadioMetadataValidationError) {
      throw error;
    }
    return nowPlaying;
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
  const details = await cacheMetadata({
    key: [
      new URL(input.streamUrl).hostname,
      "episode-details",
      nowPlaying.title,
      fields.map((field) => nowPlaying[field]),
      getAirtimeEpisodeDate(track?.metadata),
    ],
    kv: input.kv,
    now: input.now,
    retrieve: async () => {
      const enriched = await enrichAirtimeNowPlaying({
        ...input,
        data,
        nowPlaying,
      });
      return Object.fromEntries(
        fields
          .filter((field) => enriched[field] !== nowPlaying[field])
          .map((field) => [field, enriched[field]])
      );
    },
    shouldCache: (value) => Object.keys(value).length > 0,
    ttl: EPISODE_METADATA_TTL,
  });
  return { ...nowPlaying, ...details };
}

async function enrichAirtimeNowPlaying(input: {
  data: AirtimeLiveInfo;
  fetchImpl: FetchLike;
  nowPlaying: RadioNowPlaying;
  streamUrl: string;
}): Promise<RadioNowPlaying> {
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
  return input.nowPlaying;
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
  const rawTitle =
    [artist, title].filter(Boolean).join(" - ") || asString(song?.text);
  if (!rawTitle) {
    return null;
  }

  return buildNowPlaying({
    album: asString(song?.album),
    artworkUrl: asString(song?.art),
    expiresAt: input.expiresAt,
    genre: asString(song?.genre),
    rawTitle,
    resolvedUrl: input.resolvedUrl,
    sampledAt: input.sampledAt,
    source: "azuracast-now-playing",
    stationDescription:
      asString(station?.station?.description) ??
      asString(station?.live?.streamer_name),
    stationName: asString(station?.station?.name),
    streamUrl: input.streamUrl,
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
    rawTitle,
    resolvedUrl: input.resolvedUrl,
    sampledAt: input.sampledAt,
    source: "shoutcast-status",
    stationName: asString(data.servertitle),
    streamUrl: input.streamUrl,
  });
}

function getShoutcast7HtmlTitle(text: string): string | null {
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
    rawTitle,
    resolvedUrl: input.resolvedUrl,
    sampledAt: input.sampledAt,
    source: "shoutcast-status",
    streamUrl: input.streamUrl,
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

export async function tryNtsLiveApi(
  input: ExternalMetadataProviderInput,
  requestedChannel?: "1" | "2"
): Promise<RadioNowPlaying | null> {
  try {
    const channels = await cacheMetadata({
      expiresAt: (value) =>
        value?.find((channel) => channel !== null)?.expiresAt ?? 0,
      key: ["nts", "live-feed", NTS_LIVE_URL],
      kv: input.kv,
      now: input.now,
      retrieve: async () => {
        const result = await fetchObjectJson(input.fetchImpl, NTS_LIVE_URL);
        if (!result) {
          return null;
        }
        return (["1", "2"] as const).map((channel) =>
          normalizeNtsLiveApi(
            { ...input, streamUrl: "" },
            result.data,
            channel,
            result.response.url || NTS_LIVE_URL
          )
        );
      },
      shouldCache: (value) => !!value?.some(Boolean),
      ttl: RADIO_METADATA_SUCCESS_TTL_MS / 1000,
    });
    const selectedChannel =
      requestedChannel ??
      (new URL(input.streamUrl).pathname === "/stream2" ? "2" : "1");
    const result = channels?.[selectedChannel === "1" ? 0 : 1];
    return result ? { ...result, streamUrl: input.streamUrl } : null;
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
  resolvedUrl: string
): RadioNowPlaying | null {
  const { results } = data as { results?: unknown };
  const channel = Array.isArray(results)
    ? results.find(
        (item) =>
          (item as { channel_name?: unknown }).channel_name === channelName
      )
    : null;
  const now = (
    channel as {
      now?: {
        broadcast_title?: unknown;
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
    } | null
  )?.now;
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
    artworkUrl: asString(now?.embeds?.details?.media?.picture_medium),
    expiresAt: input.expiresAt,
    genre: asString(now?.embeds?.details?.genres?.[0]?.value),
    itemUrl,
    rawTitle: title,
    resolvedUrl,
    sampledAt: input.sampledAt,
    source: "nts-live-api",
    stationDescription: asString(now?.embeds?.details?.description),
    stationName: `NTS Radio | Channel ${channelName}`,
    streamUrl: input.streamUrl,
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
    expiresAt: input.expiresAt,
    itemUrl:
      input.showUrl ??
      (residentSlug
        ? new URL(
            `/residents/${encodeURIComponent(residentSlug)}`,
            "https://hkcr.live"
          ).toString()
        : null),
    rawTitle: artist && artist !== title ? `${artist} - ${title}` : title,
    resolvedUrl: input.resolvedUrl,
    sampledAt: input.sampledAt,
    source: "hkcr-schedule",
    stationDescription: plainText(entry.description),
    stationName: "HKCR",
    streamUrl: input.streamUrl,
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
        genre:
          show?.tags
            ?.map((tag) => asString(tag.name))
            .filter(Boolean)
            .join(", ") || null,
      }
    : null;
}

async function fetchHkcrShow(
  input: ExternalMetadataProviderInput,
  showId: string
): Promise<HkcrShow | null> {
  try {
    return await cacheMetadata({
      key: ["hkcr", "show-details-v2", HKCR_SHOW_URL, showId],
      kv: input.kv,
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
  const { now } = input.data as ResonanceExtraSchedule;
  const title = asString(now?.name);
  if (!title) {
    return null;
  }

  const artist = asString(now?.host);
  const rawTitle = artist ? `${artist} - ${title}` : title;
  const result = buildNowPlaying({
    album: asString(now?.series_name),
    artworkUrl: resolvePublicUrl(
      now?.backgrounds?.[0]?.image,
      "https://x.resonance.fm"
    ),
    expiresAt: input.expiresAt,
    itemUrl:
      resolvePublicUrl(now?.path, "https://extra.resonance.fm") ??
      resolvePublicUrl(now?.series_link, "https://extra.resonance.fm"),
    rawTitle,
    resolvedUrl: input.resolvedUrl,
    sampledAt: input.sampledAt,
    source: "resonance-extra-api",
    stationDescription: asString(now?.description),
    stationName: "Resonance Extra",
    streamUrl: input.streamUrl,
  });
  return result ? { ...result, artist, rawTitle, title } : null;
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

  const artist = asString(data.artist);
  const showTitle = asString(data.scheduledTitle) ?? asString(data.title);
  const rawTitle = artist ? `${artist} - ${title}` : title;
  const result = buildNowPlaying({
    album: showTitle === title ? null : showTitle,
    expiresAt: input.expiresAt,
    rawTitle,
    resolvedUrl: input.resolvedUrl,
    sampledAt: input.sampledAt,
    source: "radio-alhara-api",
    stationName: "Radio Alhara",
    streamUrl: input.streamUrl,
  });
  return result ? { ...result, artist, rawTitle, title } : null;
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
  const nowPlaying = buildNowPlaying({
    artworkUrl: asString(data.featured_media),
    expiresAt: input.expiresAt,
    itemUrl: asPublicUrl(data.link),
    rawTitle: title,
    resolvedUrl: result.response.url || endpoint,
    sampledAt: input.sampledAt,
    source: "radio-blackout-api",
    stationDescription: plainText(data.excerpt),
    stationName: "Radio BlackOut",
    streamUrl: input.streamUrl,
  });
  return nowPlaying
    ? await enrichBlackoutShow(input.fetchImpl, nowPlaying)
    : null;
}

async function enrichBlackoutShow(
  fetchImpl: FetchLike,
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
    const result = await fetchObjectJson(fetchImpl, url.toString());
    const records = Array.isArray(result?.data)
      ? (result.data as BlackoutShow[])
      : [];
    const show = records.length === 1 ? records[0] : null;
    if (
      asString(show?.slug) !== slug ||
      asPublicUrl(show?.link) !== itemUrl.toString() ||
      comparableTitle(show?.title) !== comparableTitle(nowPlaying.title)
    ) {
      return nowPlaying;
    }
    return {
      ...nowPlaying,
      genre: asStringArray(show?.tags).join(", ") || nowPlaying.genre,
      stationDescription:
        plainText(show?.content) ?? nowPlaying.stationDescription,
    };
  } catch (error) {
    if (error instanceof RadioMetadataValidationError) {
      throw error;
    }
    return nowPlaying;
  }
}
