import type { InvidiousOptions } from "@avoid.quest/platforms";
import {
  extractChannelId,
  fetchClientID,
  getBandcampItem,
  getRadioGardenItem,
  getSoundCloudItem,
  getYouTubeItem,
  needsResolution,
  normalizeBandcampUrl,
  normalizeSoundCloudUrl,
  resolveShortLink,
  resolveStreamUrl,
} from "@avoid.quest/platforms";
import { config } from "../config.js";
import { detectPlatformFromUrl } from "../lib/platform-detect.js";
import type { QueueTrack } from "./queue.js";

let soundCloudClientId: Promise<string> | null = null;

function getSoundCloudClientId(): Promise<string> {
  soundCloudClientId ??= fetchClientID().catch((error) => {
    soundCloudClientId = null;
    throw error;
  });
  return soundCloudClientId;
}

function getInvidiousOptions(): InvidiousOptions {
  return {
    instanceUrl: config.invidiousInstanceUrl(),
    auth: config.invidiousAuth(),
  };
}

async function normalizeUrl(url: string): Promise<string> {
  let normalized = url.trim();
  if (needsResolution(normalized)) {
    normalized = await resolveShortLink(normalized);
  }
  normalized = normalizeSoundCloudUrl(normalized);
  return normalizeBandcampUrl(normalized);
}

function getFilenameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    const lastSlash = pathname.lastIndexOf("/");
    const filename =
      lastSlash === -1 ? pathname : pathname.slice(lastSlash + 1);
    const lastDot = filename.lastIndexOf(".");
    const name = lastDot === -1 ? filename : filename.slice(0, lastDot);
    return decodeURIComponent(name).replace(/[_-]+/g, " ").trim() || "Unknown";
  } catch {
    return "Unknown";
  }
}

export async function resolveTrack(
  url: string,
  requestedBy: string
): Promise<QueueTrack | QueueTrack[]> {
  const normalizedUrl = await normalizeUrl(url);
  const platform = detectPlatformFromUrl(normalizedUrl);

  if (!platform) {
    throw new Error(
      "Unsupported URL. Supported: Bandcamp, SoundCloud, YouTube, Radio Garden, or direct audio file URLs."
    );
  }

  switch (platform) {
    case "bandcamp":
      return resolveBandcamp(normalizedUrl, requestedBy);
    case "soundcloud":
      return resolveSoundCloud(normalizedUrl, requestedBy);
    case "youtube":
      return resolveYouTube(normalizedUrl, requestedBy);
    case "radiogarden":
      return resolveRadioGarden(normalizedUrl, requestedBy);
    case "static-audio":
      return resolveStaticAudio(normalizedUrl, requestedBy);
    default:
      throw new Error(`Unsupported platform: ${platform satisfies never}`);
  }
}

export function resolveYouTubeStreamUrl(
  videoId: string
): Promise<string | null> {
  return resolveStreamUrl(videoId, getInvidiousOptions());
}

async function resolveBandcamp(
  url: string,
  requestedBy: string
): Promise<QueueTrack | QueueTrack[]> {
  const result = await getBandcampItem(url);
  if (!result.success) {
    throw new Error(result.error || "Failed to resolve Bandcamp item");
  }

  const { metadata, streamUrl } = result;

  if (
    metadata.itemType !== "track" &&
    "tracks" in metadata &&
    metadata.tracks
  ) {
    return metadata.tracks.map((track) => ({
      title: track.name,
      artist: metadata.artist ?? "Unknown",
      url,
      streamUrl: track.streamUrl,
      duration: "duration" in track ? (track.duration as number) : undefined,
      platform: "bandcamp",
      thumbnail: metadata.artwork,
      requestedBy,
      isLiveStream: false,
    }));
  }

  return {
    title: metadata.name ?? "Unknown",
    artist: metadata.artist ?? "Unknown",
    url,
    streamUrl,
    duration: metadata.duration,
    platform: "bandcamp",
    thumbnail: metadata.artwork,
    requestedBy,
    isLiveStream: false,
  };
}

async function resolveSoundCloud(
  url: string,
  requestedBy: string
): Promise<QueueTrack | QueueTrack[]> {
  const result = await getSoundCloudItem(url);
  if (!result.success) {
    throw new Error(result.error || "Failed to resolve SoundCloud item");
  }

  const { metadata, streamUrl } = result;

  if (
    metadata.itemType !== "track" &&
    "tracks" in metadata &&
    metadata.tracks
  ) {
    return metadata.tracks.map((track) => ({
      title: track.name,
      artist: metadata.artist ?? "Unknown",
      url,
      streamUrl: track.streamUrl,
      duration: track.duration,
      platform: "soundcloud",
      thumbnail: metadata.artwork,
      requestedBy,
      isLiveStream: false,
    }));
  }

  return {
    title: metadata.name ?? "Unknown",
    artist: metadata.artist ?? "Unknown",
    url,
    streamUrl,
    duration: metadata.duration,
    platform: "soundcloud",
    thumbnail: metadata.artwork,
    requestedBy,
    isLiveStream: false,
  };
}

async function resolveYouTube(
  url: string,
  requestedBy: string
): Promise<QueueTrack | QueueTrack[]> {
  const result = await getYouTubeItem(url, getInvidiousOptions());
  if (!result.success) {
    throw new Error(result.error || "Failed to resolve YouTube item");
  }

  const { metadata, streamUrl } = result;

  if (
    metadata.itemType === "playlist" &&
    "tracks" in metadata &&
    metadata.tracks
  ) {
    return metadata.tracks.map((track) => ({
      title: track.name,
      artist: metadata.artist ?? "Unknown",
      url,
      streamUrl: track.streamUrl,
      duration: track.duration,
      platform: "youtube",
      thumbnail:
        "thumbnail" in track
          ? (track.thumbnail as string | undefined)
          : metadata.artwork,
      requestedBy,
      isLiveStream: false,
    }));
  }

  return {
    title: metadata.name ?? "Unknown",
    artist: metadata.artist ?? "Unknown",
    url,
    streamUrl,
    duration: metadata.duration,
    platform: "youtube",
    thumbnail: metadata.artwork,
    requestedBy,
    isLiveStream: false,
  };
}

async function resolveRadioGarden(
  url: string,
  requestedBy: string
): Promise<QueueTrack> {
  const channelId = extractChannelId(url);
  if (!channelId) {
    throw new Error("Could not extract Radio Garden channel ID from URL");
  }

  const result = await getRadioGardenItem(channelId);
  if (!result.success) {
    throw new Error(result.error || "Failed to resolve Radio Garden item");
  }

  return {
    title: result.metadata.name ?? "Radio Garden Station",
    artist:
      [result.metadata.placeTitle, result.metadata.countryTitle]
        .filter(Boolean)
        .join(", ") || "Radio Garden",
    url,
    streamUrl: result.streamUrl,
    platform: "radiogarden",
    requestedBy,
    isLiveStream: true,
  };
}

function resolveStaticAudio(url: string, requestedBy: string): QueueTrack {
  return {
    title: getFilenameFromUrl(url),
    artist: "Direct Link",
    url,
    streamUrl: url,
    platform: "static-audio",
    requestedBy,
    isLiveStream: false,
  };
}

export { getSoundCloudClientId, getInvidiousOptions };
