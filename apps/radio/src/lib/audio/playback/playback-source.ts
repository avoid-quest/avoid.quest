import type { StreamStatus } from "./types.js";

type PlaybackCandidate = {
  credentials?: RequestCredentials;
  format: "hls" | "progressive";
  src: string;
};

type PlaybackInput = {
  candidates: readonly PlaybackCandidate[];
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

export type { PlaybackSourceCallbacks } from "./playback-source-shared.js";
export type { PlaybackCandidate, PlaybackInput, PlaybackSource };
