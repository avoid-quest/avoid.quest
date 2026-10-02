import { isPlaceholderMetadataValue, parseRadioTitle } from "./title-parser";
import type { RadioNowPlaying } from "./types";

type IcecastSource = {
  title?: unknown;
  artist?: unknown;
  server_name?: unknown;
  server_description?: unknown;
  genre?: unknown;
  bitrate?: unknown;
  server_type?: unknown;
  listenurl?: unknown;
  mount?: unknown;
};

type IcecastStatus = {
  icestats?: {
    source?: IcecastSource | IcecastSource[];
  };
};

export function getIcecastStatusUrl(streamUrl: string): string {
  return new URL("/status-json.xsl", new URL(streamUrl).origin).toString();
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Icecast status repeats the source's ICY fields, placeholders included. */
function asMeaningfulString(value: unknown): string | null {
  const text = asString(value);
  return isPlaceholderMetadataValue(text) ? null : text;
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

function sourceHasPath(source: IcecastSource): boolean {
  return Boolean(asString(source.mount) || asString(source.listenurl));
}

function sourceMatchesPath(
  source: IcecastSource,
  streamPathname: string
): boolean {
  const mount = asString(source.mount);
  if (mount === streamPathname) {
    return true;
  }

  const listenUrl = asString(source.listenurl);
  if (!listenUrl) {
    return false;
  }

  try {
    return new URL(listenUrl).pathname === streamPathname;
  } catch {
    return listenUrl.endsWith(streamPathname);
  }
}

export function selectIcecastSource(
  status: IcecastStatus,
  streamUrl: string
): IcecastSource | null {
  const source = status.icestats?.source;
  if (!source) {
    return null;
  }
  const streamPathname = new URL(streamUrl).pathname;
  if (!Array.isArray(source)) {
    return sourceHasPath(source) && !sourceMatchesPath(source, streamPathname)
      ? null
      : source;
  }

  return source.find((item) => sourceMatchesPath(item, streamPathname)) ?? null;
}

export function normalizeIcecastSource(input: {
  source: IcecastSource;
  streamUrl: string;
  resolvedUrl?: string;
  sampledAt: number;
  expiresAt: number;
}): RadioNowPlaying | null {
  const rawTitle = asString(input.source.title);
  const stationName = asMeaningfulString(input.source.server_name);
  const parsedTitle = parseRadioTitle(rawTitle, {
    stationNames: [asString(input.source.server_name)],
  });
  const artist = asMeaningfulString(input.source.artist) ?? parsedTitle.artist;
  const { title } = parsedTitle;

  if (!(title || artist)) {
    return null;
  }

  return {
    album: null,
    artist,
    artworkUrl: null,
    bitrate: asNumber(input.source.bitrate),
    expiresAt: input.expiresAt,
    genre: asMeaningfulString(input.source.genre),
    itemUrl: null,
    rawTitle: parsedTitle.rawTitle,
    resolvedUrl: input.resolvedUrl,
    sampledAt: input.sampledAt,
    source: "icecast-status-json",
    stationDescription: asString(input.source.server_description),
    stationName,
    streamUrl: input.streamUrl,
    title,
  };
}

export async function parseIcecastStatusResponse(
  response: Response
): Promise<IcecastStatus | null> {
  try {
    const data = (await response.json()) as unknown;
    if (data && typeof data === "object") {
      return data as IcecastStatus;
    }
  } catch {
    return null;
  }
  return null;
}
