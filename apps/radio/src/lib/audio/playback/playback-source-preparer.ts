import {
  getProxiedBandcampUrl,
  getProxiedSoundCloudUrl,
} from "@avoid.quest/platforms";
import { getCompatibilityFallbacksEnabled } from "../../compatibility-fallback-policy";
import {
  getRelayConfiguration,
  getStreamRelayUrls,
  type RelayConfiguration,
} from "../../relay";
import type {
  PlaybackCandidate,
  PlaybackInput,
  PlaybackSource,
} from "./playback-source.js";
import { STREAM_PROXY_ROUTE } from "./playback-source-shared.js";
import { inferStreamFormat } from "./stream-format.js";
import type { Radio } from "./types.js";

type PlaybackTarget = Pick<PlaybackSource, "load" | "refreshUrl">;

function browserOrigin(): string | null {
  return typeof location === "undefined" ? null : location.origin;
}

function isExactPlaybackUrl(url: string): boolean {
  if (url.startsWith("/") || url.startsWith("blob:")) {
    return true;
  }

  const origin = browserOrigin();
  if (!origin) {
    return false;
  }

  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

function candidate(
  src: string,
  sourceUrl = src,
  format = inferStreamFormat(sourceUrl),
  credentials?: RequestCredentials
): PlaybackCandidate {
  return credentials ? { credentials, format, src } : { format, src };
}

function canPlayDirectly(sourceUrl: string): boolean {
  if (typeof location === "undefined" || location.protocol !== "https:") {
    return true;
  }

  try {
    return new URL(sourceUrl, location.origin).protocol !== "http:";
  } catch {
    return true;
  }
}

function relayedCandidates(
  sourceUrl: string,
  format: PlaybackCandidate["format"],
  relayConfiguration: RelayConfiguration,
  fallbackUrl?: string
): PlaybackCandidate[] {
  return [
    ...(canPlayDirectly(sourceUrl)
      ? [candidate(sourceUrl, sourceUrl, format)]
      : []),
    ...getStreamRelayUrls(sourceUrl, format, relayConfiguration).map((url) =>
      candidate(url, sourceUrl, format, "omit")
    ),
    ...(fallbackUrl ? [candidate(fallbackUrl, sourceUrl, format)] : []),
  ];
}

function playbackInput(
  radio: Radio,
  relayConfiguration: RelayConfiguration,
  compatibilityFallbacksEnabled: boolean
): PlaybackInput {
  const sourceUrl = radio.streamUrl;
  const format =
    radio.streamFormat ??
    (radio.platformMetadata?.platform === "radio-browser" &&
    radio.platformMetadata.hls
      ? "hls"
      : inferStreamFormat(sourceUrl));

  if (isExactPlaybackUrl(sourceUrl)) {
    return { candidates: [candidate(sourceUrl, sourceUrl, format)] };
  }

  if (radio.platformMetadata?.platform === "youtube") {
    if (canPlayDirectly(sourceUrl)) {
      return { candidates: [candidate(sourceUrl, sourceUrl, format, "omit")] };
    }
    return {
      candidates: relayedCandidates(
        sourceUrl,
        format,
        relayConfiguration,
        compatibilityFallbacksEnabled
          ? STREAM_PROXY_ROUTE + encodeURIComponent(sourceUrl)
          : undefined
      ),
    };
  }

  const bandcampUrl = getProxiedBandcampUrl(sourceUrl);
  if (bandcampUrl !== sourceUrl) {
    return {
      candidates: relayedCandidates(
        sourceUrl,
        format,
        relayConfiguration,
        compatibilityFallbacksEnabled ? bandcampUrl : undefined
      ),
    };
  }

  const soundCloudUrl = getProxiedSoundCloudUrl(sourceUrl);
  if (soundCloudUrl !== sourceUrl) {
    return {
      candidates: relayedCandidates(
        sourceUrl,
        format,
        relayConfiguration,
        compatibilityFallbacksEnabled ? soundCloudUrl : undefined
      ),
    };
  }

  try {
    const protocol = new URL(sourceUrl).protocol;
    if (protocol === "http:" || protocol === "https:") {
      return {
        candidates: relayedCandidates(
          sourceUrl,
          format,
          relayConfiguration,
          compatibilityFallbacksEnabled
            ? STREAM_PROXY_ROUTE + encodeURIComponent(sourceUrl)
            : undefined
        ),
      };
    }
  } catch {
    // Let the playback transport surface invalid or unsupported URLs.
  }

  return { candidates: [candidate(sourceUrl, sourceUrl, format)] };
}

export class PlaybackSourcePreparer {
  private readonly compatibilityFallbacksEnabled: () => boolean;
  private readonly relayConfiguration: () => RelayConfiguration;

  constructor(
    relayConfiguration: () => RelayConfiguration = getRelayConfiguration,
    compatibilityFallbacksEnabled: () => boolean = getCompatibilityFallbacksEnabled
  ) {
    this.relayConfiguration = relayConfiguration;
    this.compatibilityFallbacksEnabled = compatibilityFallbacksEnabled;
  }

  load(radio: Radio, into: PlaybackTarget): Promise<void> {
    return into.load(
      playbackInput(
        radio,
        this.relayConfiguration(),
        this.compatibilityFallbacksEnabled()
      )
    );
  }

  refresh(
    radio: Radio,
    into: PlaybackTarget,
    position?: number
  ): Promise<void> {
    return into.refreshUrl(
      playbackInput(
        radio,
        this.relayConfiguration(),
        this.compatibilityFallbacksEnabled()
      ),
      position
    );
  }
}
