import { useEffect } from "react";
import type { Radio } from "@/lib/audio";
import {
  formatRadioDocumentTitle,
  getMediaSessionText,
  IDLE_RADIO_DOCUMENT_TITLE,
  RADIO_DOCUMENT_TITLE_SUFFIX,
} from "@/lib/metadata/display";
import type { RadioNowPlaying } from "@/lib/metadata/types";

const ASCII_PUNCTUATION: [RegExp, string][] = [
  [/[\u2010-\u2015\u2212]/g, "-"],
  [/[\u2018\u2019\u201A\u2032]/g, "'"],
  [/[\u201C\u201D\u201E\u00AB\u00BB\u2033]/g, '"'],
  [/\u2026/g, "..."],
  [/[\u00B7\u2022]/g, "-"],
];

/**
 * Sanitizes a string for safe use in AVRCP/Bluetooth metadata.
 * Accented letters keep their base letter and typographic punctuation
 * becomes ASCII; other non-Latin characters are dropped. Collapses
 * whitespace, falls back to "Radio".
 */
export function sanitizeForBluetooth(str: string): string {
  if (!str || str.trim().length === 0) {
    return "Radio";
  }

  let ascii = str.normalize("NFKD").replace(/\p{M}/gu, "");
  for (const [pattern, replacement] of ASCII_PUNCTUATION) {
    ascii = ascii.replace(pattern, replacement);
  }

  // Keep only ASCII letters, numbers, and basic punctuation/spaces
  const sanitized = ascii.replace(/[^\x20-\x7E]/g, "").trim();

  // Collapse multiple spaces into one
  const collapsed = sanitized.replace(/\s+/g, " ");

  return collapsed.length > 0 ? collapsed : "Radio";
}

type MediaSessionOptions =
  | {
      mode: "single";
      radio: Radio | null;
      isPlaying: boolean;
      metadata?: RadioNowPlaying | null;
    }
  | { mode: "multiple"; radios: Radio[]; playingCount: number }
  | { mode: "node"; radios: Radio[]; playingCount: number }
  | {
      mode: "dj";
      deckA: Radio | null;
      deckB: Radio | null;
      isPlaying: boolean;
    };

const NODE_PATCH_TITLE = "Node patch";

/** "2 stations playing"; plain ASCII, so it is safe for AVRCP as is. */
function formatPlayingCount(count: number): string {
  return `${count} ${count === 1 ? "station" : "stations"} playing`;
}

function buildTitle(options: MediaSessionOptions): string {
  if (options.mode === "single") {
    return formatRadioDocumentTitle(options);
  }
  if (options.mode === "multiple") {
    return options.playingCount > 0
      ? `Multiple stations${RADIO_DOCUMENT_TITLE_SUFFIX}`
      : IDLE_RADIO_DOCUMENT_TITLE;
  }
  if (options.mode === "node") {
    return options.playingCount > 0
      ? `${NODE_PATCH_TITLE} (${options.playingCount})${RADIO_DOCUMENT_TITLE_SUFFIX}`
      : IDLE_RADIO_DOCUMENT_TITLE;
  }
  // dj
  if (options.deckA && options.deckB) {
    return `${options.deckA.name} | ${options.deckB.name}${RADIO_DOCUMENT_TITLE_SUFFIX}`;
  }
  if (options.deckA) {
    return `${options.deckA.name}${RADIO_DOCUMENT_TITLE_SUFFIX}`;
  }
  if (options.deckB) {
    return `${options.deckB.name}${RADIO_DOCUMENT_TITLE_SUFFIX}`;
  }
  return IDLE_RADIO_DOCUMENT_TITLE;
}

function buildDjDeckInfo(
  deckA: Radio | null,
  deckB: Radio | null
): string | null {
  if (deckA && deckB) {
    return `${deckA.name} | ${deckB.name}`;
  }
  if (deckA) {
    return deckA.name;
  }
  if (deckB) {
    return deckB.name;
  }
  return null;
}

function buildMetadata(options: MediaSessionOptions): MediaMetadata | null {
  if (options.mode === "single") {
    if (!options.radio) {
      return null;
    }
    const text = getMediaSessionText({
      metadata: options.metadata,
      radio: options.radio,
    });
    const metadata: MediaMetadataInit = {
      artist: sanitizeForBluetooth(text.artist),
      title: sanitizeForBluetooth(text.title),
    };
    if (options.metadata?.album) {
      metadata.album = sanitizeForBluetooth(options.metadata.album);
    }
    return new MediaMetadata(metadata);
  }
  if (options.mode === "multiple") {
    return new MediaMetadata({ title: "Multiple stations" });
  }
  if (options.mode === "node") {
    return new MediaMetadata(
      options.playingCount > 0
        ? {
            artist: formatPlayingCount(options.playingCount),
            title: NODE_PATCH_TITLE,
          }
        : { title: NODE_PATCH_TITLE }
    );
  }
  // dj
  const deckInfo = buildDjDeckInfo(options.deckA, options.deckB);
  if (!deckInfo) {
    return null;
  }
  return new MediaMetadata({ title: sanitizeForBluetooth(deckInfo) });
}

function isAnyPlaying(options: MediaSessionOptions): boolean {
  if (options.mode === "multiple" || options.mode === "node") {
    return options.playingCount > 0;
  }
  return options.isPlaying;
}

function setMediaSession(options: MediaSessionOptions): void {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
    return;
  }
  navigator.mediaSession.playbackState = isAnyPlaying(options)
    ? "playing"
    : "paused";
  const metadata = buildMetadata(options);
  if (metadata) {
    navigator.mediaSession.metadata = metadata;
  }
}

function clearMediaSession(): void {
  if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
    navigator.mediaSession.metadata = null;
  }
}

/**
 * Hook to manage navigator.mediaSession metadata and document title
 * for Bluetooth AVRCP compatibility. Only adds metadata on top of
 * existing behavior — does not modify any playback logic.
 */
export function useMediaSession(options: MediaSessionOptions): void {
  useEffect(() => {
    document.title = buildTitle(options);
    setMediaSession(options);
    return () => {
      document.title = IDLE_RADIO_DOCUMENT_TITLE;
      clearMediaSession();
    };
  }, [options]);
}
