import type { AudioFormat } from "./types.js";

const YT_PLAYER =
  "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";
const YTM_PLAYER =
  "https://music.youtube.com/youtubei/v1/player?prettyPrint=false";

type ClientConfig = {
  endpoint: string;
  client: Record<string, string | number>;
  thirdParty?: { embedUrl: string };
  headers: Record<string, string>;
};

const INNERTUBE_CLIENTS: ClientConfig[] = [
  // IOS: returns HLS manifest URLs that may bypass PoToken requirements
  {
    endpoint: YT_PLAYER,
    client: {
      clientName: "IOS",
      clientVersion: "19.29.1",
      deviceMake: "Apple",
      deviceModel: "iPhone16,2",
      hl: "en",
      gl: "US",
    },
    headers: {
      "Content-Type": "application/json",
      "User-Agent":
        "com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X; en_US)",
      "X-YouTube-Client-Name": "5",
      "X-YouTube-Client-Version": "19.29.1",
    },
  },
  // ANDROID: main YouTube app client, works for any public video
  {
    endpoint: YT_PLAYER,
    client: {
      clientName: "ANDROID",
      clientVersion: "19.09.37",
      androidSdkVersion: 30,
      hl: "en",
      gl: "US",
    },
    headers: {
      "Content-Type": "application/json",
      "User-Agent":
        "com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip",
      "X-YouTube-Client-Name": "3",
      "X-YouTube-Client-Version": "19.09.37",
    },
  },
  // WEB_REMIX: YouTube Music client, works for music catalog videos
  {
    endpoint: YTM_PLAYER,
    client: {
      clientName: "WEB_REMIX",
      clientVersion: "1.20250929.03.00",
      hl: "en",
      gl: "US",
    },
    headers: {
      "Content-Type": "application/json",
      Origin: "https://music.youtube.com",
      Referer: "https://music.youtube.com/",
      Cookie: "CONSENT=PENDING+987",
    },
  },
];

type InnerTubeAdaptiveFormat = {
  itag: number;
  url?: string;
  mimeType: string;
  bitrate: number;
  signatureCipher?: string;
};

type InnerTubePlayerResponse = {
  videoDetails?: {
    videoId: string;
    title: string;
    lengthSeconds: string;
    author: string;
    thumbnail: {
      thumbnails: { url: string; width: number; height: number }[];
    };
  };
  streamingData?: {
    adaptiveFormats?: InnerTubeAdaptiveFormat[];
    hlsManifestUrl?: string;
  };
  playabilityStatus?: {
    status: string;
    reason?: string;
  };
};

export type InnerTubeVideoData = {
  title: string;
  author: string;
  videoId: string;
  thumbnails: { url: string; quality: string }[];
  lengthSeconds: number;
  audioFormats: AudioFormat[];
  hlsManifestUrl?: string;
};

function mapThumbnailQuality(width: number): string {
  if (width >= 1280) {
    return "maxres";
  }
  if (width >= 640) {
    return "sddefault";
  }
  if (width >= 480) {
    return "high";
  }
  if (width >= 320) {
    return "medium";
  }
  return "default";
}

function hasDirectUrl(
  f: InnerTubeAdaptiveFormat
): f is InnerTubeAdaptiveFormat & { url: string } {
  return typeof f.url === "string" && f.mimeType.startsWith("audio/");
}

function fetchPlayerData(
  config: ClientConfig,
  videoId: string
): Promise<Response> {
  const context: Record<string, unknown> = { client: config.client };
  if (config.thirdParty) {
    context.thirdParty = config.thirdParty;
  }

  return fetch(config.endpoint, {
    method: "POST",
    headers: config.headers,
    body: JSON.stringify({
      context,
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
    }),
    signal: AbortSignal.timeout(10_000),
  });
}

function parsePlayerResponse(
  data: InnerTubePlayerResponse
): InnerTubeVideoData {
  if (data.playabilityStatus?.status !== "OK") {
    throw new Error(data.playabilityStatus?.reason ?? "Playback not allowed");
  }

  const details = data.videoDetails;
  if (!details) {
    throw new Error("No video details");
  }

  const hlsManifestUrl = data.streamingData?.hlsManifestUrl;
  const formats = data.streamingData?.adaptiveFormats;

  const audioFormats: AudioFormat[] = (formats ?? [])
    .filter(hasDirectUrl)
    .map((f) => ({
      type: f.mimeType,
      url: f.url,
      itag: String(f.itag),
      bitrate: String(f.bitrate),
    }));

  if (audioFormats.length === 0 && !hlsManifestUrl) {
    throw new Error("No audio formats or HLS manifest");
  }

  const thumbnails = details.thumbnail.thumbnails.map((t) => ({
    url: t.url,
    quality: mapThumbnailQuality(t.width),
  }));

  return {
    title: details.title,
    author: details.author,
    videoId: details.videoId,
    thumbnails,
    lengthSeconds: Number.parseInt(details.lengthSeconds, 10),
    audioFormats,
    hlsManifestUrl,
  };
}

async function tryClient(
  config: ClientConfig,
  videoId: string
): Promise<InnerTubeVideoData> {
  const response = await fetchPlayerData(config, videoId);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) {
    throw new Error("Non-JSON response from InnerTube");
  }

  const data = (await response.json()) as InnerTubePlayerResponse;

  return parsePlayerResponse(data);
}

/**
 * Try IOS client only. IOS stream URLs have no range restrictions
 * and support full file access + seeking through our proxy.
 */
export function getVideoDataIOS(videoId: string): Promise<InnerTubeVideoData> {
  const iosConfig = INNERTUBE_CLIENTS.find(
    (c) => c.client.clientName === "IOS"
  );
  if (!iosConfig) {
    throw new Error("IOS client config not found");
  }
  return tryClient(iosConfig, videoId);
}
