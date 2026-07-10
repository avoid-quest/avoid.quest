import type { StreamStatus } from "./types.js";

type PlaybackInput = {
  allowNativeHls?: boolean;
  credentials?: RequestCredentials;
  format: "hls" | "progressive";
  src: string;
};

type PlaybackSource = {
  readonly currentTime: number;
  readonly duration: number;
  readonly id: string;
  readonly isActive: boolean;
  readonly isBuffering: boolean;
  readonly output: AudioNode;
  readonly status: StreamStatus;
  volume: number;
  cleanup(): void;
  getPlaybackRate(): number;
  load(input: PlaybackInput): Promise<void>;
  pause(): void;
  play(): Promise<void>;
  refreshUrl(input: PlaybackInput, seekPosition?: number): Promise<void>;
  seek(position: number): void;
  setPlaybackRate(rate: number): void;
  stop(): void;
};

type PlaybackSourceCallbacks = {
  onPlaying?: () => void;
  onPaused?: () => void;
  onBuffering?: (isBuffering: boolean) => void;
  onReady?: () => void;
  onError?: (error: Error) => void;
  onEnded?: () => void;
  onStreamError?: (position: number) => void;
};

export type { PlaybackInput, PlaybackSource, PlaybackSourceCallbacks };
