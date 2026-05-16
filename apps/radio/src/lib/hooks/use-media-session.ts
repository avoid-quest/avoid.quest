import { useEffect } from "react";
import type { Radio } from "@/lib/audio";
import {
  formatRadioDocumentTitle,
  getIdleRadioDocumentTitle,
  getMediaSessionText,
  getRadioDocumentTitleSuffix,
} from "@/lib/metadata/display";
import type { RadioNowPlaying } from "@/lib/metadata/types";

/**
 * Sanitizes a string for safe use in AVRCP/Bluetooth metadata.
 * Strips non-Latin characters, collapses whitespace, falls back to "Radio".
 */
export function sanitizeForBluetooth(str: string): string {
  if (!str || str.trim().length === 0) {
    return "Radio";
  }

  // Keep only ASCII letters, numbers, and basic punctuation/spaces
  const sanitized = str.replace(/[^\x20-\x7E]/g, "").trim();

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
  | {
      mode: "dj";
      deckA: Radio | null;
      deckB: Radio | null;
      isPlaying: boolean;
    };

function buildTitle(options: MediaSessionOptions): string {
  if (options.mode === "single") {
    return formatRadioDocumentTitle(options);
  }
  if (options.mode === "multiple") {
    return options.playingCount > 0
      ? `Multiple stations${getRadioDocumentTitleSuffix()}`
      : getIdleRadioDocumentTitle();
  }
  // dj
  if (options.deckA && options.deckB) {
    return `${options.deckA.name} | ${options.deckB.name}${getRadioDocumentTitleSuffix()}`;
  }
  if (options.deckA) {
    return `${options.deckA.name}${getRadioDocumentTitleSuffix()}`;
  }
  if (options.deckB) {
    return `${options.deckB.name}${getRadioDocumentTitleSuffix()}`;
  }
  return getIdleRadioDocumentTitle();
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
      radio: options.radio,
      metadata: options.metadata,
    });
    return new MediaMetadata({
      title: sanitizeForBluetooth(text.title),
      artist: sanitizeForBluetooth(text.artist),
    });
  }
  if (options.mode === "multiple") {
    return new MediaMetadata({ title: "Multiple stations" });
  }
  // dj
  const deckInfo = buildDjDeckInfo(options.deckA, options.deckB);
  if (!deckInfo) {
    return null;
  }
  return new MediaMetadata({ title: sanitizeForBluetooth(deckInfo) });
}

function isAnyPlaying(options: MediaSessionOptions): boolean {
  if (options.mode === "multiple") {
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
      document.title = getIdleRadioDocumentTitle();
      clearMediaSession();
    };
  }, [options]);
}
