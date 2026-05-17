export type RadioMetadataSource =
  | "icy"
  | "icecast-status-json"
  | "airtime-live-info"
  | "nts-live-api"
  | "radio-blackout-api";

export type RadioMetadataConfig =
  | { kind: "none" }
  | { kind: "icecast-status"; url?: string }
  | { kind: "airtime-live-info"; urls: string[] }
  | { kind: "nts-live-api"; channel: "1" | "2" }
  | { kind: "radio-blackout-api"; url?: string }
  | { kind: "icy" };

export type RadioNowPlaying = {
  streamUrl: string;
  resolvedUrl?: string;
  source: RadioMetadataSource;
  title: string | null;
  artist: string | null;
  rawTitle: string | null;
  artworkUrl: string | null;
  stationName: string | null;
  stationDescription: string | null;
  genre: string | null;
  bitrate: number | null;
  sampledAt: number;
  expiresAt: number;
};

export type RadioMetadataErrorCode =
  | "RADIO_METADATA_URL_REQUIRED"
  | "RADIO_METADATA_INVALID_URL"
  | "RADIO_METADATA_INTERNAL_ADDRESS"
  | "RADIO_METADATA_UNSUPPORTED"
  | "RADIO_METADATA_TIMEOUT"
  | "RADIO_METADATA_UPSTREAM_ERROR";

export type RadioMetadataResponse =
  | { ok: true; data: RadioNowPlaying }
  | {
      ok: false;
      error: {
        code: RadioMetadataErrorCode;
        message: string;
      };
    };
