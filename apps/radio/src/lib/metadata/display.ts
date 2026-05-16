import type { RadioNowPlaying } from "./types";

export function formatNowPlaying(
  metadata: RadioNowPlaying | null | undefined
): string | null {
  if (!metadata?.title) {
    return null;
  }

  return metadata.artist
    ? `${metadata.artist} - ${metadata.title}`
    : metadata.title;
}
