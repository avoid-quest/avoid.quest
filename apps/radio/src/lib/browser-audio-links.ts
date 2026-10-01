import { isPublicHttpUrl } from "@avoid.quest/platforms/url-policy";
import type { Radio } from "@/lib/audio";
import {
  BROWSER_AUDIO_SOURCES,
  type BrowserAudioSource,
} from "@/lib/audio/playback/display-audio";
import { isStaticAudioUrl } from "@/lib/audio/remote-url";
import { radios } from "@/lib/const";

const WWW_PREFIX = /^www\./;
const stationHosts = radios.flatMap((radio) =>
  radio.websiteUrl
    ? [new URL(radio.websiteUrl).hostname.replace(WWW_PREFIX, "")]
    : []
);
// Station live streams load as streams, including those on a station
// subdomain; a stream host that also serves the station site stays eligible.
const streamUrls = radios.flatMap((radio) =>
  radio.streamUrl ? [new URL(radio.streamUrl)] : []
);
const streamHrefs = new Set(streamUrls.map(({ href }) => href));
const streamHosts = new Set(
  streamUrls
    .map(({ hostname }) => hostname)
    .filter(
      (hostname) => !stationHosts.includes(hostname.replace(WWW_PREFIX, ""))
    )
);

/** Hosted players remain in their tab; direct recordings still use the file loader. */
export function detectBrowserAudioSource(
  value: string
): BrowserAudioSource | null {
  if (!isPublicHttpUrl(value) || isStaticAudioUrl(value)) {
    return null;
  }
  const { hostname, href, username, password } = new URL(value);
  if (username || password) {
    return null;
  }
  if (hostname === "open.spotify.com" || hostname === "spotify.link") {
    return "spotify";
  }
  if (hostname === "mixcloud.com" || hostname.endsWith(".mixcloud.com")) {
    return "mixcloud";
  }
  if (streamHosts.has(hostname) || streamHrefs.has(href)) {
    return null;
  }
  return stationHosts.some(
    (host) => hostname === host || hostname.endsWith(`.${host}`)
  )
    ? "radio-shows"
    : null;
}

export function browserAudioRadio(value: string): Radio {
  const source = detectBrowserAudioSource(value);
  if (!source) {
    throw new Error("Unsupported browser audio link");
  }
  const definition =
    BROWSER_AUDIO_SOURCES.find((entry) => entry.id === source) ??
    BROWSER_AUDIO_SOURCES[0];
  return {
    enabled: true,
    id: `browser-audio:${value}`,
    name: definition.name,
    platformMetadata: {
      capture: "display",
      channelCount: 2,
      channelSelection: { left: 0, right: 1 },
      deviceId: "display",
      deviceLabel: definition.name,
      itemType: "track",
      platform: "device-input",
      sourceUrl: value,
      url: "",
    },
    streamUrl: "",
  };
}
