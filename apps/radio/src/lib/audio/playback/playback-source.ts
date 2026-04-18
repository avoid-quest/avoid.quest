import type { StreamStatus } from "./types.js";

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
  load(url: string): Promise<void>;
  pause(): void;
  play(): Promise<void>;
  refreshUrl(newUrl: string, seekPosition?: number): Promise<void>;
  seek(position: number): void;
  setPlaybackRate(rate: number): void;
  stop(): void;
};

export type { PlaybackSource };
export type { PlaybackSourceCallbacks } from "./playback-source-shared.js";
