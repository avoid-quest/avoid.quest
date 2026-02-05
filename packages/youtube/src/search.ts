import type { YouTubeSearchResult } from "./types.js";

const SEARCH_ENDPOINT =
  "https://music.youtube.com/youtubei/v1/search?prettyPrint=false";

const SEARCH_CONTEXT = {
  client: {
    clientName: "WEB_REMIX",
    clientVersion: "1.20250929.03.00",
    hl: "en",
    gl: "US",
  },
};

// Filter params for content types
const FILTER_PARAMS: Record<string, string> = {
  songs: "EgWKAQIIAWoOEAMQBBAJEA4QChAFEBU%3D",
  videos: "EgWKAQIQAWoOEAMQBBAJEA4QChAFEBU%3D",
};

const DURATION_PATTERN = /^(\d+):(\d{2})(?::(\d{2}))?$/;

export async function searchYouTubeMusic(
  query: string,
  filter: "songs" | "videos" = "songs"
): Promise<YouTubeSearchResult[]> {
  try {
    const params = FILTER_PARAMS[filter] ?? FILTER_PARAMS.songs;

    const response = await fetch(SEARCH_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://music.youtube.com",
        Referer: "https://music.youtube.com/",
      },
      body: JSON.stringify({
        context: SEARCH_CONTEXT,
        query,
        params,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return [];
    }

    // biome-ignore lint/suspicious/noExplicitAny: YouTube InnerTube API response structure
    const data = (await response.json()) as any;

    const contents =
      data?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer
        ?.content?.sectionListRenderer?.contents;

    if (!Array.isArray(contents)) {
      return [];
    }

    const results: YouTubeSearchResult[] = [];

    for (const section of contents) {
      const items = section?.musicShelfRenderer?.contents;

      if (!Array.isArray(items)) {
        continue;
      }

      for (const item of items) {
        const renderer = item?.musicResponsiveListItemRenderer;
        if (!renderer) {
          continue;
        }

        const parsed = parseSearchItem(renderer);
        if (parsed) {
          results.push(parsed);
        }
      }
    }

    return results;
  } catch {
    return [];
  }
}

function parseDurationString(text: string): number | undefined {
  const match = text.match(DURATION_PATTERN);
  if (!match) {
    return;
  }
  if (match[3]) {
    return (
      Number.parseInt(match[1] ?? "0", 10) * 3600 +
      Number.parseInt(match[2] ?? "0", 10) * 60 +
      Number.parseInt(match[3], 10)
    );
  }
  return (
    Number.parseInt(match[1] ?? "0", 10) * 60 +
    Number.parseInt(match[2] ?? "0", 10)
  );
}

// biome-ignore lint/suspicious/noExplicitAny: YouTube InnerTube API response structure
function extractMetadataFromRuns(runs: any[]): {
  author: string;
  duration?: number;
  views?: string;
} {
  let author = "";
  let duration: number | undefined;
  let views: string | undefined;

  const artistRun = runs.find(
    // biome-ignore lint/suspicious/noExplicitAny: YouTube InnerTube API response structure
    (r: any) => r.text && r.text !== " • " && r.text !== " & "
  );
  if (artistRun) {
    author = artistRun.text;
  }

  for (const run of runs) {
    if (typeof run.text !== "string") {
      continue;
    }
    duration ??= parseDurationString(run.text);
    if (run.text.includes("view")) {
      views = run.text;
    }
  }

  return { author, duration, views };
}

// biome-ignore lint/suspicious/noExplicitAny: YouTube InnerTube API response structure
function parseSearchItem(renderer: any): YouTubeSearchResult | null {
  try {
    const videoId =
      renderer?.overlay?.musicItemThumbnailOverlayRenderer?.content
        ?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint
        ?.videoId ??
      renderer?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer
        ?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId;

    if (!videoId) {
      return null;
    }

    const title =
      renderer?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer
        ?.text?.runs?.[0]?.text;

    if (!title) {
      return null;
    }

    const metadataRuns =
      renderer?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer
        ?.text?.runs;

    const { author, duration, views } = Array.isArray(metadataRuns)
      ? extractMetadataFromRuns(metadataRuns)
      : { author: "", duration: undefined, views: undefined };

    const thumbnails =
      renderer?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails;
    const thumbnail = Array.isArray(thumbnails)
      ? thumbnails.at(-1)?.url
      : undefined;

    return { videoId, title, author, duration, thumbnail, views };
  } catch {
    return null;
  }
}
