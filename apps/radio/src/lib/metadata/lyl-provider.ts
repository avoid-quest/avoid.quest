import { parseRadioTitle } from "./title-parser";
import type { RadioNowPlaying } from "./types";
import { RadioMetadataValidationError } from "./upstream-fetch";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const LYL_GRAPHQL_URL = "https://strapi.lyl.live/graphql";
const DAY_MS = 24 * 60 * 60 * 1000;
const CALENDAR_QUERY = `
  query NowPlaying($from: DateTime!, $to: DateTime!) {
    onair { title hls }
    calendar(from: $from, to: $to) { start end title slug artists type }
  }
`;
const EPISODE_QUERY = `
  query Episode($slug: String!) {
    episodeBySlug(slug: $slug) {
      title
      slug
      description
      image { url }
      show { title slug }
      links { type url }
      styles { name }
    }
  }
`;
const SHOW_QUERY = `
  query Show($slug: String!) {
    showBySlug(slug: $slug) {
      title
      slug
      description
      artists
      image { url }
      styles { name }
    }
  }
`;

type LylCalendarEntry = {
  artists?: unknown;
  end?: unknown;
  slug?: unknown;
  start?: unknown;
  title?: unknown;
  type?: unknown;
};

type LylCalendarResponse = {
  data?: {
    calendar?: unknown;
    onair?: { hls?: unknown; title?: unknown };
  };
};

type LylEpisodeResponse = {
  data?: {
    episodeBySlug?: {
      description?: unknown;
      image?: { url?: unknown };
      show?: { slug?: unknown; title?: unknown };
      slug?: unknown;
      styles?: { name?: unknown }[];
      title?: unknown;
    };
  };
};

type LylShowResponse = {
  data?: {
    showBySlug?: {
      artists?: unknown;
      description?: unknown;
      image?: { url?: unknown };
      slug?: unknown;
      styles?: { name?: unknown }[];
      title?: unknown;
    };
  };
};

type LylEpisode = NonNullable<
  NonNullable<LylEpisodeResponse["data"]>["episodeBySlug"]
>;
type LylShow = NonNullable<NonNullable<LylShowResponse["data"]>["showBySlug"]>;

export type LylProviderInput = {
  expiresAt: number;
  fetchImpl: FetchLike;
  sampledAt: number;
  streamUrl: string;
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
    const url = new URL(text, "https://lyl.live");
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function comparableTitle(value: unknown): string | null {
  return (
    asString(value)?.normalize("NFKC").replace(/\s+/g, " ").toLowerCase() ??
    null
  );
}

function trustMatchingTitle<T extends { title?: unknown }>(
  details: T | null,
  title: string
): T | null {
  const detailTitle = asString(details?.title);
  return detailTitle && comparableTitle(detailTitle) === comparableTitle(title)
    ? details
    : null;
}

function isCurrent(entry: LylCalendarEntry, sampledAt: number): boolean {
  const start = Date.parse(asString(entry.start) ?? "");
  const end = Date.parse(asString(entry.end) ?? "");
  return (
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    sampledAt >= start &&
    sampledAt < end
  );
}

function selectCurrentEntry(
  calendar: LylCalendarEntry[],
  onAirTitle: string,
  sampledAt: number
): LylCalendarEntry | null {
  const current = calendar.filter((entry) => isCurrent(entry, sampledAt));
  const parsedOnAirTitle = parseRadioTitle(onAirTitle).title;
  const matchingTitles = new Set(
    [onAirTitle, parsedOnAirTitle].map(comparableTitle).filter(Boolean)
  );
  const titleMatches = current.filter((entry) => {
    const title = comparableTitle(entry.title);
    return title ? matchingTitles.has(title) : false;
  });
  if (titleMatches.length === 1) {
    return titleMatches[0] ?? null;
  }

  const episodes = current.filter((entry) => entry.type === "EPISODE");
  return episodes.length === 1 ? (episodes[0] ?? null) : null;
}

function calendarRange(sampledAt: number): { from: string; to: string } {
  const from = new Date(sampledAt);
  from.setUTCHours(0, 0, 0, 0);
  return {
    from: from.toISOString(),
    to: new Date(from.getTime() + DAY_MS).toISOString(),
  };
}

async function postGraphql(
  fetchImpl: FetchLike,
  query: string,
  variables: Record<string, string>
): Promise<{ data: object; response: Response } | null> {
  const response = await fetchImpl(LYL_GRAPHQL_URL, {
    body: JSON.stringify({ query, variables }),
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    method: "POST",
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

function shouldPropagate(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    error instanceof RadioMetadataValidationError
  );
}

async function getEpisode(
  fetchImpl: FetchLike,
  slug: string
): Promise<LylEpisode | null> {
  try {
    const result = await postGraphql(fetchImpl, EPISODE_QUERY, { slug });
    const episode = (result?.data as LylEpisodeResponse | undefined)?.data
      ?.episodeBySlug;
    return asString(episode?.slug) === slug ? (episode ?? null) : null;
  } catch (error) {
    if (shouldPropagate(error)) {
      throw error;
    }
    return null;
  }
}

async function getShow(
  fetchImpl: FetchLike,
  slug: string
): Promise<LylShow | null> {
  try {
    const result = await postGraphql(fetchImpl, SHOW_QUERY, { slug });
    const show = (result?.data as LylShowResponse | undefined)?.data
      ?.showBySlug;
    return asString(show?.slug) === slug ? (show ?? null) : null;
  } catch (error) {
    if (shouldPropagate(error)) {
      throw error;
    }
    return null;
  }
}

export async function tryLylApi(
  input: LylProviderInput
): Promise<RadioNowPlaying | null> {
  let result: Awaited<ReturnType<typeof postGraphql>>;
  try {
    result = await postGraphql(
      input.fetchImpl,
      CALENDAR_QUERY,
      calendarRange(input.sampledAt)
    );
  } catch (error) {
    if (shouldPropagate(error)) {
      throw error;
    }
    return null;
  }

  const response = result?.data as LylCalendarResponse | undefined;
  const onAirTitle = asString(response?.data?.onair?.title);
  const onAirHls = asPublicUrl(response?.data?.onair?.hls);
  const calendar = response?.data?.calendar;
  if (!(onAirTitle && onAirHls && Array.isArray(calendar))) {
    return null;
  }

  const entry = selectCurrentEntry(
    calendar as LylCalendarEntry[],
    onAirTitle,
    input.sampledAt
  );
  const title = asString(entry?.title);
  const slug = asString(entry?.slug);
  const type = asString(entry?.type);
  if (!(entry && title && slug && (type === "EPISODE" || type === "SHOW"))) {
    return null;
  }

  const episode =
    type === "EPISODE" ? await getEpisode(input.fetchImpl, slug) : null;
  const show = type === "SHOW" ? await getShow(input.fetchImpl, slug) : null;
  const trustedEpisode = trustMatchingTitle(episode, title);
  const trustedShow = trustMatchingTitle(show, title);
  const details = trustedEpisode ?? trustedShow;
  const artist = asString(entry.artists) ?? asString(trustedShow?.artists);
  const episodeShowTitle = asString(trustedEpisode?.show?.title);
  const genre = details?.styles
    ?.map((style) => asString(style.name))
    .filter((style): style is string => Boolean(style))
    .join(", ");
  const rawTitle =
    artist && comparableTitle(artist) !== comparableTitle(title)
      ? `${artist} - ${title}`
      : title;

  return {
    album:
      episodeShowTitle &&
      comparableTitle(episodeShowTitle) !== comparableTitle(title)
        ? episodeShowTitle
        : null,
    artist,
    artworkUrl: asPublicUrl(details?.image?.url),
    bitrate: null,
    expiresAt: input.expiresAt,
    genre: genre || null,
    itemUrl: new URL(
      `/${type === "EPISODE" ? "episode" : "show"}/${encodeURIComponent(slug)}`,
      "https://lyl.live"
    ).toString(),
    rawTitle,
    resolvedUrl: result?.response.url || LYL_GRAPHQL_URL,
    sampledAt: input.sampledAt,
    source: "lyl-api",
    stationDescription: asString(details?.description),
    stationName: "LYL Radio",
    streamUrl: input.streamUrl,
    title,
  };
}
