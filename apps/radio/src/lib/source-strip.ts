/**
 * Source Strip
 *
 * The channel-strip calls a DJ deck and a Node source share: playback rate
 * (clamped to what the engine takes), key lock, seek, and the whole-track
 * repeat at the end of a track. DJ decks (dj-deck.ts) and Node lanes
 * (node-playback.ts) both go through here, so a speed or a loop behaves
 * the same in either mode.
 *
 * It also names a source's stream format the way a deck loads it.
 *
 * The engine's limits hold: speed and seek are no-ops on a live device
 * input, seek is a no-op on media without a finite duration, and loop is
 * the whole track, not an A–B region.
 */

import type { StreamFormat } from "@/lib/audio/playback/stream-format";
import { inferStreamFormat } from "@/lib/audio/playback/stream-format";
import type { Radio } from "@/lib/audio/playback/types";
import { STRIP_SPEED } from "@/lib/node-graph/schema";
import { isRadioBrowserMetadata } from "@/lib/platform-types";

/** Keeps a speed inside what the engine plays (0.5–2x). */
export function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed)) {
    return 1;
  }
  return Math.min(STRIP_SPEED.max, Math.max(STRIP_SPEED.min, speed));
}

type RateTarget = {
  setPlaybackRate: (soundId: string, rate: number) => void;
};

type KeyLockTarget = {
  setKeyLock: (soundId: string, keyLock: boolean) => void;
};

type SeekTarget = {
  seek: (soundId: string, position: number) => void;
};

/** Sets a sound's speed, clamped to 0.5–2x. */
export function setPlaybackRate(
  audio: RateTarget,
  soundId: string,
  speed: number
): void {
  audio.setPlaybackRate(soundId, clampSpeed(speed));
}

/** Key lock: on keeps the pitch while the speed changes. */
export function setPreservesPitch(
  audio: KeyLockTarget,
  soundId: string,
  keyLock: boolean
): void {
  audio.setKeyLock(soundId, keyLock);
}

/** Seeks a sound to `position` seconds, never before the start. */
export function seekSound(
  playback: SeekTarget,
  soundId: string,
  position: number
): void {
  playback.seek(soundId, Number.isFinite(position) ? Math.max(0, position) : 0);
}

export type RepeatSteps = {
  /** Seeks the ended sound back to its start. */
  seek: () => Promise<void> | void;
  /** Plays it again. */
  play: () => Promise<void>;
  /** Whether the sound is still the one that ended. */
  isCurrent: () => boolean;
};

/**
 * Repeats a track that ended: back to its start, then play, dropping out
 * as soon as the sound was replaced meanwhile. Resolves true when it plays
 * again; a failure is the caller's to report.
 */
export async function repeatAtEnd({
  seek,
  play,
  isCurrent,
}: RepeatSteps): Promise<boolean> {
  await seek();
  if (!isCurrent()) {
    return false;
  }
  await play();
  return isCurrent();
}

/**
 * How a stream plays, HLS or progressive, by DJ's rule: a track's own
 * format, then the radio's, then Radio Browser's HLS flag, then the URL.
 */
export function streamFormatOf(radio: Radio, streamUrl: string): StreamFormat {
  const metadata = radio.platformMetadata;
  if (metadata && "tracks" in metadata && metadata.tracks) {
    const track = metadata.tracks.find((item) => item.streamUrl === streamUrl);
    if (track && "format" in track && track.format) {
      return track.format;
    }
  }
  if (streamUrl === radio.streamUrl && radio.streamFormat) {
    return radio.streamFormat;
  }
  if (
    streamUrl === radio.streamUrl &&
    isRadioBrowserMetadata(metadata) &&
    metadata.hls
  ) {
    return "hls";
  }
  return inferStreamFormat(streamUrl);
}
