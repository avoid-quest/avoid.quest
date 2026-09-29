import type { Radio } from "@/lib/audio";
import type { RadioNowPlaying } from "./types";

export const IDLE_RADIO_DOCUMENT_TITLE = "radio — avoid.quest";
export const RADIO_DOCUMENT_TITLE_SUFFIX = " — radio.avoid.quest";
const MAX_DOCUMENT_TITLE_LENGTH = 120;

export function formatNowPlaying(
  metadata: RadioNowPlaying | null | undefined
): string | null {
  if (!metadata) {
    return null;
  }
  if (metadata.artist && metadata.title) {
    return `${metadata.artist} - ${metadata.title}`;
  }

  return metadata.title || metadata.artist || null;
}

function truncateTitle(value: string): string {
  return value.length > MAX_DOCUMENT_TITLE_LENGTH
    ? `${value.slice(0, MAX_DOCUMENT_TITLE_LENGTH - 1)}…`
    : value;
}

export function formatRadioDocumentTitle(input: {
  radio: Radio | null;
  isPlaying: boolean;
  metadata?: RadioNowPlaying | null;
}): string {
  if (!(input.radio && input.isPlaying)) {
    return IDLE_RADIO_DOCUMENT_TITLE;
  }
  const title = input.metadata?.title || input.radio.name;
  return `${truncateTitle(title)}${RADIO_DOCUMENT_TITLE_SUFFIX}`;
}

export function getMediaSessionText(input: {
  radio: Radio;
  metadata?: RadioNowPlaying | null;
}): { title: string; artist: string } {
  const title = input.metadata?.title || input.radio.name;
  const artist = input.metadata?.artist?.trim();
  if (artist && artist.toLocaleLowerCase() !== title.toLocaleLowerCase()) {
    return { artist, title };
  }
  // A show is known: the station is the useful second line.
  if (input.metadata?.title) {
    return { artist: input.radio.name, title };
  }
  return {
    artist:
      input.radio.description || input.radio.placeTitle || input.radio.name,
    title,
  };
}
