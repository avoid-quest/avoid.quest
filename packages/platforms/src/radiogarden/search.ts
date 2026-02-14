import type {
  RadioGardenItemResponse,
  RadioGardenSearchResult,
} from "./types.js";

export type { RadioGardenSearchResult } from "./types.js";

const RADIO_GARDEN_API = "https://radio.garden/api";

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

type RadioGardenApiPage = {
  url: string;
  type: string;
  title: string;
  subtitle: string;
  secure: boolean;
  stream: string;
  preroll: boolean;
  website?: string;
  place: {
    id: string;
    title: string;
  };
  country: {
    id: string;
    title: string;
  };
};

type RadioGardenApiSearchResponse = {
  hits: {
    hits: Array<{
      _source: {
        code: string;
        type: string;
        page: RadioGardenApiPage;
      };
      _score: number;
    }>;
  };
  query: string;
  took: number;
};

type RadioGardenApiChannelResponse = {
  apiVersion: number;
  version: string;
  data: RadioGardenApiPage & {
    id: string;
  };
};

export async function searchRadioGarden(
  query: string
): Promise<RadioGardenSearchResult[]> {
  const encoded = encodeURIComponent(query);
  let response: Response;
  try {
    response = await fetch(`${RADIO_GARDEN_API}/search?q=${encoded}`, {
      headers: { "User-Agent": BROWSER_USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Radio Garden search timed out — try again");
    }
    throw error;
  }

  if (!response.ok) {
    throw new Error(`Radio Garden search failed: ${response.status}`);
  }

  let data: RadioGardenApiSearchResponse;
  try {
    data = (await response.json()) as RadioGardenApiSearchResponse;
  } catch {
    throw new Error("Radio Garden returned an invalid response");
  }

  return data.hits.hits
    .filter((hit) => hit._source.type === "channel")
    .map((hit) => {
      const page = hit._source.page;
      // URL format: /listen/{slug}/{id}
      const channelId = page.url.split("/").pop() ?? "";
      return {
        channelId,
        title: page.title,
        subtitle: page.subtitle,
        url: `https://radio.garden${page.url}`,
        website: page.website || undefined,
        placeTitle: page.place.title,
        countryTitle: page.country.title,
      };
    })
    .filter((result) => result.channelId !== "");
}

export async function resolveRadioGardenStream(
  channelId: string
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(
      `${RADIO_GARDEN_API}/ara/content/listen/${channelId}/channel.mp3`,
      {
        headers: { "User-Agent": BROWSER_USER_AGENT },
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      }
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Radio Garden stream resolution timed out — try again");
    }
    throw error;
  }

  // The API returns a 302 redirect to the actual stream URL
  const location = response.headers.get("location");
  if (location) {
    return location;
  }

  // A 200 without redirect may be an audio stream served directly
  if (response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.startsWith("audio/")) {
      return `${RADIO_GARDEN_API}/ara/content/listen/${channelId}/channel.mp3`;
    }
    throw new Error("Radio Garden returned an unexpected response for stream");
  }

  throw new Error(`Failed to resolve Radio Garden stream: ${response.status}`);
}

type RadioGardenSuggestionsResponse = {
  apiVersion: number;
  version: string;
  data: {
    type: string;
    title: string;
    url: string;
    content: Array<{
      type: string;
      title: string;
      subtitle?: string;
      itemsType: string;
      items: RadioGardenApiPage[];
    }>;
  };
};

export async function getRadioGardenSuggestions(): Promise<
  RadioGardenSearchResult[]
> {
  let response: Response;
  try {
    response = await fetch(`${RADIO_GARDEN_API}/ara/content/search?s=1`, {
      headers: { "User-Agent": BROWSER_USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Radio Garden suggestions timed out — try again");
    }
    throw error;
  }

  if (!response.ok) {
    throw new Error(`Radio Garden suggestions failed: ${response.status}`);
  }

  let data: RadioGardenSuggestionsResponse;
  try {
    data = (await response.json()) as RadioGardenSuggestionsResponse;
  } catch {
    throw new Error("Radio Garden returned an invalid response");
  }

  const results: RadioGardenSearchResult[] = [];

  for (const section of data.data.content) {
    if (section.itemsType !== "channel") {
      continue;
    }
    for (const item of section.items) {
      const channelId = item.url.split("/").pop() ?? "";
      if (!channelId) {
        continue;
      }
      results.push({
        channelId,
        title: item.title,
        subtitle: item.subtitle,
        url: `https://radio.garden${item.url}`,
        website: item.website || undefined,
        placeTitle: item.place.title,
        countryTitle: item.country.title,
      });
    }
  }

  return results.slice(0, 16);
}

export async function getRadioGardenItem(
  channelId: string
): Promise<RadioGardenItemResponse> {
  let metaResponse: Response;
  try {
    metaResponse = await fetch(
      `${RADIO_GARDEN_API}/ara/content/channel/${channelId}`,
      {
        headers: { "User-Agent": BROWSER_USER_AGENT },
        signal: AbortSignal.timeout(10_000),
      }
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return {
        success: false,
        error: "Radio Garden channel lookup timed out — try again",
      };
    }
    throw error;
  }

  if (!metaResponse.ok) {
    return {
      success: false,
      error: `Failed to fetch channel info: ${metaResponse.status}`,
    };
  }

  let metaData: RadioGardenApiChannelResponse;
  try {
    metaData = (await metaResponse.json()) as RadioGardenApiChannelResponse;
  } catch {
    return {
      success: false,
      error: "Radio Garden returned an invalid response",
    };
  }

  const channel = metaData.data;
  const streamUrl = await resolveRadioGardenStream(channelId);

  return {
    success: true,
    metadata: {
      platform: "radiogarden",
      itemType: "channel",
      url: `https://radio.garden${channel.url}`,
      channelId: channel.id,
      name: channel.title,
      subtitle: `${channel.place.title}, ${channel.country.title}`,
      website: channel.website || undefined,
      placeId: channel.place.id,
      placeTitle: channel.place.title,
      countryTitle: channel.country.title,
    },
    streamUrl,
  };
}
