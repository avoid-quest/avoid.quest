export const STREAM_PROXY_ROUTE = "/api/stream-proxy?url=";

export type PlaybackSourceCallbacks = {
  onPlaying?: () => void;
  onPaused?: () => void;
  onBuffering?: (isBuffering: boolean) => void;
  onReady?: () => void;
  onError?: (error: Error) => void;
  onEnded?: () => void;
  onStreamError?: (position: number) => void;
};
