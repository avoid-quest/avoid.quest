import type {
  RadioGardenItemError,
  RadioGardenItemResponse,
  RadioGardenMetadata,
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
      throw new Error("Radio Garden search timed out — try again", {
        cause: error,
      });
    }
    throw error;
  }

  if (!response.ok) {
    throw new Error(`Radio Garden search failed: ${response.status}`);
  }

  let data: RadioGardenApiSearchResponse;
  try {
    data = (await response.json()) as RadioGardenApiSearchResponse;
  } catch (error) {
    throw new Error("Radio Garden returned an invalid response", {
      cause: error,
    });
  }

  return data.hits.hits
    .filter((hit) => hit._source.type === "channel")
    .map((hit) => {
      const { page } = hit._source;
      // URL format: /listen/{slug}/{id}
      const channelId = page.url.split("/").pop() ?? "";
      return {
        channelId,
        countryTitle: page.country.title,
        placeTitle: page.place.title,
        subtitle: page.subtitle,
        title: page.title,
        url: `https://radio.garden${page.url}`,
        website: page.website || undefined,
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
      throw new Error("Radio Garden stream resolution timed out — try again", {
        cause: error,
      });
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
      throw new Error("Radio Garden suggestions timed out — try again", {
        cause: error,
      });
    }
    throw error;
  }

  if (!response.ok) {
    throw new Error(`Radio Garden suggestions failed: ${response.status}`);
  }

  let data: RadioGardenSuggestionsResponse;
  try {
    data = (await response.json()) as RadioGardenSuggestionsResponse;
  } catch (error) {
    throw new Error("Radio Garden returned an invalid response", {
      cause: error,
    });
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
        countryTitle: item.country.title,
        placeTitle: item.place.title,
        subtitle: item.subtitle,
        title: item.title,
        url: `https://radio.garden${item.url}`,
        website: item.website || undefined,
      });
    }
  }

  return results.slice(0, 16);
}

export async function getRadioGardenMetadata(
  channelId: string
): Promise<
  RadioGardenItemError | { success: true; metadata: RadioGardenMetadata }
> {
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
        error: "Radio Garden channel lookup timed out — try again",
        success: false,
      };
    }
    throw error;
  }

  if (!metaResponse.ok) {
    return {
      error: `Failed to fetch channel info: ${metaResponse.status}`,
      success: false,
    };
  }

  let metaData: RadioGardenApiChannelResponse;
  try {
    metaData = (await metaResponse.json()) as RadioGardenApiChannelResponse;
  } catch {
    return {
      error: "Radio Garden returned an invalid response",
      success: false,
    };
  }

  const channel = metaData.data;

  return {
    metadata: {
      channelId: channel.id,
      countryTitle: channel.country.title,
      itemType: "channel",
      name: channel.title,
      placeId: channel.place.id,
      placeTitle: channel.place.title,
      platform: "radiogarden",
      subtitle: `${channel.place.title}, ${channel.country.title}`,
      url: `https://radio.garden${channel.url}`,
      website: channel.website || undefined,
    },
    success: true,
  };
}

export async function getRadioGardenItem(
  channelId: string
): Promise<RadioGardenItemResponse> {
  const result = await getRadioGardenMetadata(channelId);
  return result.success
    ? { ...result, streamUrl: await resolveRadioGardenStream(channelId) }
    : result;
}
