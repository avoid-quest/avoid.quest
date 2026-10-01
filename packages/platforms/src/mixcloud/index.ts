import { getMixcloudShowUrl, parseMixcloudShowUrl } from "./detect.js";
import {
  DEFAULT_MIXCLOUD_STREAM_PROTOCOLS,
  type MixcloudStreamInfo,
  selectMixcloudStream,
} from "./stream.js";
import type {
  MixcloudItemError,
  MixcloudItemResponse,
  MixcloudMetadata,
  MixcloudStreamProtocol,
} from "./types.js";

export type { MixcloudShowRef } from "./detect.js";
export {
  getMixcloudShowUrl,
  isMixcloudShowUrl,
  isMixcloudUrl,
  normalizeMixcloudUrl,
  parseMixcloudShowUrl,
} from "./detect.js";
export type { MixcloudSearchResult } from "./search.js";
export { searchMixcloud } from "./search.js";
export type { MixcloudStream, MixcloudStreamInfo } from "./stream.js";
export {
  DEFAULT_MIXCLOUD_STREAM_PROTOCOLS,
  decodeMixcloudStreamUrl,
  selectMixcloudStream,
} from "./stream.js";
export type {
  MixcloudItemError,
  MixcloudItemResponse,
  MixcloudItemResult,
  MixcloudItemType,
  MixcloudMetadata,
  MixcloudStreamProtocol,
} from "./types.js";
export type {
  MixcloudStreamUrlValidationFailure,
  MixcloudStreamUrlValidationResult,
} from "./url-policy.js";
export {
  isMixcloudHostname,
  isMixcloudPageHostname,
  isMixcloudStreamHostname,
  validateMixcloudStreamUrl,
} from "./url-policy.js";

export const MIXCLOUD_GRAPHQL_ENDPOINT = "https://app.mixcloud.com/graphql";

const LOOKUP_TIMEOUT_MS = 10_000;

// Variables keep the user-supplied username and slug out of the query text.
const CLOUDCAST_STREAM_QUERY = `query MixcloudCloudcastStream($lookup: CloudcastLookup!) {
  cloudcastLookup(lookup: $lookup) {
    name
    audioLength
    isExclusive
    restrictedReason
    owner {
      displayName
      username
    }
    picture(width: 1024, height: 1024) {
      url
    }
    streamInfo {
      url
      hlsUrl
      dashUrl
    }
  }
}`;

export type MixcloudCloudcast = {
  name?: string | null;
  audioLength?: number | null;
  isExclusive?: boolean | null;
  restrictedReason?: string | null;
  owner?: { displayName?: string | null; username?: string | null } | null;
  picture?: { url?: string | null } | null;
  streamInfo?: MixcloudStreamInfo | null;
};

export type MixcloudCloudcastLookupResponse = {
  data?: { cloudcastLookup?: MixcloudCloudcast | null } | null;
  errors?: { message?: string }[];
};

export type MixcloudItemOptions = {
  /** Protocol preference, first match wins. Default: progressive, then HLS. */
  streamProtocols?: readonly MixcloudStreamProtocol[];
  signal?: AbortSignal;
};

const RESTRICTED_REASON_MESSAGES: Record<string, string> = {
  repeat_play: "Mixcloud play limit reached for this show",
  tracklist:
    "This Mixcloud show is unavailable in this region due to licensing restrictions",
};

function createErrorResponse(message: string): MixcloudItemError {
  return { error: message, success: false };
}

async function lookupCloudcast(
  username: string,
  slug: string,
  signal: AbortSignal
): Promise<MixcloudCloudcastLookupResponse> {
  const response = await fetch(MIXCLOUD_GRAPHQL_ENDPOINT, {
    body: JSON.stringify({
      query: CLOUDCAST_STREAM_QUERY,
      variables: { lookup: { slug, username } },
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
    signal,
  });

  if (!response.ok) {
    throw new Error(`Mixcloud lookup failed: HTTP ${response.status}`);
  }
  return (await response.json()) as MixcloudCloudcastLookupResponse;
}

/**
 * Turns a cloudcast GraphQL response into the item result. Pure, so recorded
 * responses can be tested without the network.
 */
export function toMixcloudItemResponse(
  canonicalUrl: string,
  payload: MixcloudCloudcastLookupResponse,
  protocols: readonly MixcloudStreamProtocol[] = DEFAULT_MIXCLOUD_STREAM_PROTOCOLS
): MixcloudItemResponse {
  const cloudcast = payload.data?.cloudcastLookup;
  if (!cloudcast) {
    const graphqlError = payload.errors?.find((error) => error.message);
    return createErrorResponse(
      graphqlError?.message
        ? `Mixcloud lookup failed: ${graphqlError.message}`
        : "Mixcloud show not found"
    );
  }

  const { restrictedReason } = cloudcast;
  if (restrictedReason) {
    return createErrorResponse(
      RESTRICTED_REASON_MESSAGES[restrictedReason] ??
        "This Mixcloud show is restricted"
    );
  }

  const stream = selectMixcloudStream(cloudcast.streamInfo, protocols);
  if (!stream) {
    return createErrorResponse(
      cloudcast.isExclusive
        ? "This Mixcloud show is exclusive to subscribers"
        : "No playable Mixcloud stream found"
    );
  }

  const metadata: MixcloudMetadata = {
    artist:
      cloudcast.owner?.displayName || cloudcast.owner?.username || undefined,
    artwork: cloudcast.picture?.url || undefined,
    duration: cloudcast.audioLength ?? undefined,
    itemType: "show",
    name: cloudcast.name || undefined,
    platform: "mixcloud",
    streamUrl: stream.streamUrl,
    url: canonicalUrl,
  };

  return {
    format: stream.format,
    metadata,
    streamUrl: stream.streamUrl,
    success: true,
  };
}

/**
 * Resolves a public Mixcloud show URL to metadata and a playable stream URL,
 * anonymously, through Mixcloud's web GraphQL endpoint. Run it server-side:
 * the endpoint sends no CORS headers to other origins.
 */
export async function getMixcloudItem(
  url: string,
  options: MixcloudItemOptions = {}
): Promise<MixcloudItemResponse> {
  const show = parseMixcloudShowUrl(url);
  if (!show) {
    return createErrorResponse(
      "Unsupported Mixcloud URL: only show links can be played"
    );
  }

  try {
    const signal = options.signal
      ? AbortSignal.any([
          options.signal,
          AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
        ])
      : AbortSignal.timeout(LOOKUP_TIMEOUT_MS);
    const payload = await lookupCloudcast(show.username, show.slug, signal);
    return toMixcloudItemResponse(
      getMixcloudShowUrl(show),
      payload,
      options.streamProtocols ?? DEFAULT_MIXCLOUD_STREAM_PROTOCOLS
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    return createErrorResponse(`Failed to get Mixcloud item: ${errorMessage}`);
  }
}
