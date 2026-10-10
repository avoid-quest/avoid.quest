import type { StreamStatus } from "./types.js";

type PlaybackInput = {
  allowNativeHls?: boolean;
  credentials?: RequestCredentials;
  format: "hls" | "progressive";
  /** Live provenance takes precedence over the browser's reported duration. */
  live?: true;
  src: string;
};

type PlaybackSource = {
  readonly currentTime: number;
  readonly duration: number;
  readonly id: string;
  readonly isActive: boolean;
  readonly isBuffering: boolean;
  readonly output: AudioNode | null;
  readonly status: StreamStatus;
  volume: number;
  cleanup: () => void;
  getPlaybackRate: () => number;
  load: (input: PlaybackInput) => Promise<void>;
  pause: () => void;
  play: () => Promise<void>;
  /** Swaps in a renewed URL; resolves whether the source plays on. */
  refreshUrl: (input: PlaybackInput, seekPosition?: number) => Promise<boolean>;
  seek: (position: number) => void;
  setPlaybackRate: (rate: number) => void;
  /** Key lock: keep the pitch while the rate changes. */
  setPreservesPitch: (preservesPitch: boolean) => void;
  stop: () => void;
};

type PlaybackSourceCallbacks = {
  onPlaying?: () => void;
  onPaused?: () => void;
  onBuffering?: (isBuffering: boolean) => void;
  onReady?: () => void;
  onError?: (error: Error, recoveryPending?: boolean) => void;
  onEnded?: () => void;
  onStreamError?: (position: number, error: Error) => void;
};

export type { PlaybackInput, PlaybackSource, PlaybackSourceCallbacks };
