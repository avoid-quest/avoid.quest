import Innertube from "youtubei.js/cf-worker";

/**
 * Client types to try, in order. Uses InnerTubeClient key names.
 * TV_EMBEDDED/TV don't require PoToken for video streaming.
 * WEB_EMBEDDED doesn't require PoToken but only works for embeddable videos.
 * WEB requires PoToken — last resort.
 */
const CLIENT_CASCADE = ["TV_EMBEDDED", "WEB_EMBEDDED", "TV", "WEB"] as const;

let innertubeInstance: Innertube | null = null;

async function getInnertube(): Promise<Innertube> {
  if (innertubeInstance) {
    return innertubeInstance;
  }

  innertubeInstance = await Innertube.create({
    retrieve_player: false,
    generate_session_locally: true,
  });

  return innertubeInstance;
}

function resetInnertube(): void {
  innertubeInstance = null;
}

export type YoutubeiVideoData = {
  title: string;
  author: string;
  videoId: string;
  thumbnail?: string;
  lengthSeconds: number;
  streamUrl: string;
};

async function tryGetVideoData(
  yt: Innertube,
  videoId: string,
  clientName: string
): Promise<YoutubeiVideoData | null> {
  const info = await yt.getBasicInfo(videoId, { client: clientName });

  if (info.playability_status?.status !== "OK") {
    return null;
  }

  const adaptiveFormats = info.streaming_data?.adaptive_formats ?? [];
  const audioFormats = adaptiveFormats.filter(
    (f) => f.has_audio && !f.has_video
  );

  if (audioFormats.length === 0) {
    return null;
  }

  // Sort by bitrate descending to get best quality
  const sorted = [...audioFormats].sort((a, b) => b.bitrate - a.bitrate);
  const bestFormat = sorted[0];
  if (!bestFormat) {
    return null;
  }

  // Use direct URL only — CF Workers can't run eval()/new Function() needed
  // for signature deciphering or n-parameter transformation.
  // If no direct URL, fall through to custom InnerTube fallback in index.ts.
  const streamUrl = bestFormat.url;
  if (!streamUrl) {
    return null;
  }

  const thumbnails = info.basic_info.thumbnail ?? [];
  const thumbnail = thumbnails.length > 0 ? thumbnails.at(-1)?.url : undefined;

  return {
    title: info.basic_info.title ?? "Unknown",
    author: info.basic_info.author ?? "Unknown",
    videoId: info.basic_info.id ?? videoId,
    thumbnail,
    lengthSeconds: info.basic_info.duration ?? 0,
    streamUrl,
  };
}

async function getVideoDataOnce(videoId: string): Promise<YoutubeiVideoData> {
  const yt = await getInnertube();

  // Try each client type until one returns usable data
  for (const clientType of CLIENT_CASCADE) {
    try {
      const data = await tryGetVideoData(yt, videoId, clientType);
      if (data) {
        return data;
      }
    } catch {
      // Fall through to next client
    }
  }

  throw new Error("No audio stream found from any client type");
}

export async function getVideoDataFromYoutubei(
  videoId: string
): Promise<YoutubeiVideoData> {
  try {
    return await getVideoDataOnce(videoId);
  } catch {
    // If the session might be stale, recreate and retry once
    resetInnertube();
    return await getVideoDataOnce(videoId);
  }
}

export async function resolveStreamUrlFromYoutubei(
  videoId: string
): Promise<string> {
  const yt = await getInnertube();

  for (const clientType of CLIENT_CASCADE) {
    try {
      const info = await yt.getBasicInfo(videoId, { client: clientType });
      const formats = info.streaming_data?.adaptive_formats ?? [];
      const audioFormats = formats.filter((f) => f.has_audio && !f.has_video);

      if (audioFormats.length === 0) {
        continue;
      }

      const sorted = [...audioFormats].sort((a, b) => b.bitrate - a.bitrate);
      const bestFormat = sorted[0];

      // Only use direct URLs — decipher doesn't work in CF Workers
      if (bestFormat?.url) {
        return bestFormat.url;
      }
    } catch {
      // Fall through to next client
    }
  }

  throw new Error("Failed to resolve stream URL from any client type");
}
