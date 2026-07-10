import type { Radio } from "@/lib/audio";
import {
  inferStreamFormat,
  type StreamFormat,
} from "@/lib/audio/playback/stream-format";
import type { DeckId } from "@/lib/dj-actions-decks.js";
import type { PlatformStreamResolution } from "@/lib/dj-platform-stream-port.js";
import {
  isRadioBrowserMetadata,
  isYouTubeMetadata,
} from "@/lib/platform-types";
import type { DeckLoadDependencies } from "./dj-actions-deck-load.js";

type SourceLoadCurrentCheck = () => boolean;

function isStillCurrent(isCurrent?: SourceLoadCurrentCheck): boolean {
  return isCurrent?.() ?? true;
}

function getSelectedTrackFormat(
  radio: Radio,
  streamUrl: string
): StreamFormat | undefined {
  const metadata = radio.platformMetadata;
  if (!(metadata && "tracks" in metadata && metadata.tracks)) {
    return;
  }
  const track = metadata.tracks.find((item) => item.streamUrl === streamUrl);
  return track && "format" in track ? track.format : undefined;
}

function getInitialStreamFormat(radio: Radio, streamUrl: string): StreamFormat {
  const selectedTrackFormat = getSelectedTrackFormat(radio, streamUrl);
  if (selectedTrackFormat) {
    return selectedTrackFormat;
  }
  if (streamUrl === radio.streamUrl && radio.streamFormat) {
    return radio.streamFormat;
  }
  if (
    streamUrl === radio.streamUrl &&
    isRadioBrowserMetadata(radio.platformMetadata) &&
    radio.platformMetadata.hls
  ) {
    return "hls";
  }
  return inferStreamFormat(streamUrl);
}

async function resolveInitialYouTubeStreamUrl(
  deckId: DeckId,
  radio: Radio,
  videoId: string,
  dependencies: Pick<
    DeckLoadDependencies,
    "reportDjError" | "resolvePlatformStreamUrl"
  >,
  isCurrent?: SourceLoadCurrentCheck
): Promise<PlatformStreamResolution | null> {
  try {
    const resolved = await dependencies.resolvePlatformStreamUrl({
      platform: "youtube",
      reason: "initial-load",
      videoId,
      radio,
    });
    if (!isStillCurrent(isCurrent)) {
      return null;
    }
    if (!resolved) {
      dependencies.reportDjError(
        "Failed to resolve YouTube stream",
        "DJ_YOUTUBE_RESOLVE_FAILED",
        undefined,
        radio,
        deckId
      );
      return null;
    }

    if (
      isYouTubeMetadata(radio.platformMetadata) &&
      radio.platformMetadata.tracks
    ) {
      const track = radio.platformMetadata.tracks.find(
        (item) => "videoId" in item && item.videoId === videoId
      );
      if (track) {
        track.streamUrl = resolved.streamUrl;
      }
    }

    return resolved;
  } catch (error) {
    if (!isStillCurrent(isCurrent)) {
      return null;
    }
    dependencies.reportDjError(
      "Failed to resolve YouTube stream",
      "DJ_YOUTUBE_RESOLVE_FAILED",
      error,
      radio,
      deckId
    );
    return null;
  }
}

export async function resolveInitialTrackStreamUrl(
  deckId: DeckId,
  radio: Radio,
  streamUrl: string,
  dependencies: Pick<
    DeckLoadDependencies,
    "reportDjError" | "resolvePlatformStreamUrl"
  >,
  isCurrent?: SourceLoadCurrentCheck
): Promise<PlatformStreamResolution | null> {
  if (!streamUrl.startsWith("yt:")) {
    return {
      streamFormat: getInitialStreamFormat(radio, streamUrl),
      streamUrl,
    };
  }
  return await resolveInitialYouTubeStreamUrl(
    deckId,
    radio,
    streamUrl.slice(3),
    dependencies,
    isCurrent
  );
}
