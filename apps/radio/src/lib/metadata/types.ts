import type { z } from "zod";
import type { radioMetadataConfigSchema } from "./schema";

export type RadioMetadataSource =
  | "icy"
  | "icecast-status-json"
  | "airtime-live-info"
  | "azuracast-now-playing"
  | "shoutcast-status"
  | "nts-live-api"
  | "radio-blackout-api"
  | "hkcr-schedule"
  | "lyl-api"
  | "radio-alhara-api"
  | "resonance-extra-api";

export type RadioMetadataConfig = z.infer<typeof radioMetadataConfigSchema>;

export type RadioNowPlaying = {
  streamUrl: string;
  resolvedUrl?: string;
  source: RadioMetadataSource;
  title: string | null;
  artist: string | null;
  rawTitle: string | null;
  album: string | null;
  artworkUrl: string | null;
  itemUrl: string | null;
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
  | "RADIO_METADATA_HOSTNAME_RESOLUTION_FAILED"
  | "RADIO_METADATA_UNSUPPORTED"
  | "RADIO_METADATA_TIMEOUT"
  | "RADIO_METADATA_UPSTREAM_ERROR";

export type RadioMetadataResponse =
  | { ok: true; data: RadioNowPlaying; refreshAfterMs?: number }
  | {
      ok: false;
      error: {
        code: RadioMetadataErrorCode;
        message: string;
      };
    };
