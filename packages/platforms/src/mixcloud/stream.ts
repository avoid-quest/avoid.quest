/**
 * Mixcloud stream URL decoding.
 *
 * GraphQL `streamInfo` returns each stream URL base64-encoded and XOR-ed with
 * a fixed key that ships in Mixcloud's web player (and in yt-dlp's extractor).
 * See RESEARCH.md for the live probes behind this.
 */

import type { PlatformStreamFormat } from "../stream-format.js";
import type { MixcloudStreamProtocol } from "./types.js";
import { validateMixcloudStreamUrl } from "./url-policy.js";

export const MIXCLOUD_STREAM_KEY =
  "IFYOUWANTTHEARTISTSTOGETPAIDDONOTDOWNLOADFROMMIXCLOUD";

export const DEFAULT_MIXCLOUD_STREAM_PROTOCOLS = [
  "progressive",
  "hls",
] as const satisfies readonly MixcloudStreamProtocol[];

export type MixcloudStreamInfo = {
  url?: string | null;
  hlsUrl?: string | null;
  dashUrl?: string | null;
};

export type MixcloudStream = {
  format: PlatformStreamFormat;
  streamUrl: string;
};

/** XOR-decodes one base64 `streamInfo` field; null when it isn't base64. */
export function decodeMixcloudStreamUrl(encoded: string): string | null {
  let binary: string;
  try {
    binary = atob(encoded);
  } catch {
    return null;
  }

  let decoded = "";
  for (let index = 0; index < binary.length; index += 1) {
    decoded += String.fromCharCode(
      // biome-ignore lint/suspicious/noBitwiseOperators: Mixcloud XOR-encodes stream URLs with a fixed key.
      binary.charCodeAt(index) ^
        MIXCLOUD_STREAM_KEY.charCodeAt(index % MIXCLOUD_STREAM_KEY.length)
    );
  }
  return decoded;
}

function decodeValidatedStreamUrl(
  encoded: string | null | undefined
): string | null {
  if (!encoded) {
    return null;
  }
  const decoded = decodeMixcloudStreamUrl(encoded);
  const validation = validateMixcloudStreamUrl(decoded);
  return validation.ok ? validation.url : null;
}

/**
 * Picks the first protocol in `protocols` that `streamInfo` offers on a
 * Mixcloud stream host. `url` is progressive M4A; `hlsUrl` is an HLS master
 * playlist. DASH is never chosen: the radio plays progressive or HLS only.
 */
export function selectMixcloudStream(
  streamInfo: MixcloudStreamInfo | null | undefined,
  protocols: readonly MixcloudStreamProtocol[] = DEFAULT_MIXCLOUD_STREAM_PROTOCOLS
): MixcloudStream | null {
  if (!streamInfo) {
    return null;
  }

  for (const protocol of protocols) {
    const streamUrl = decodeValidatedStreamUrl(
      protocol === "hls" ? streamInfo.hlsUrl : streamInfo.url
    );
    if (streamUrl) {
      return { format: protocol, streamUrl };
    }
  }

  return null;
}
