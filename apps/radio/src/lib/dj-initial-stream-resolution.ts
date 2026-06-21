import type { Radio } from "@/lib/audio";
import type { DeckId } from "@/lib/dj-actions-decks.js";
import { isYouTubeMetadata } from "@/lib/platform-types";
import type { DeckLoadDependencies } from "./dj-actions-deck-load.js";

type SourceLoadCurrentCheck = () => boolean;

function isStillCurrent(isCurrent?: SourceLoadCurrentCheck): boolean {
  return isCurrent?.() ?? true;
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
): Promise<string | null> {
  try {
    const resolvedUrl = await dependencies.resolvePlatformStreamUrl({
      platform: "youtube",
      reason: "initial-load",
      videoId,
      radio,
    });
    if (!isStillCurrent(isCurrent)) {
      return null;
    }
    if (!resolvedUrl) {
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
        track.streamUrl = resolvedUrl;
      }
    }

    return resolvedUrl;
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
): Promise<string | null> {
  if (!streamUrl.startsWith("yt:")) {
    return streamUrl;
  }
  return await resolveInitialYouTubeStreamUrl(
    deckId,
    radio,
    streamUrl.slice(3),
    dependencies,
    isCurrent
  );
}
