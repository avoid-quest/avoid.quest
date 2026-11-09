import {
  IconAntenna,
  IconFileMusic,
  IconMicrophone,
  IconSearch,
  IconWorld,
  type TablerIcon,
} from "@tabler/icons-react";
import type {
  PLATFORM_SOURCE_DEFINITIONS,
  SPOTIFY_SOURCE_STYLE,
} from "@/lib/dj-library-sources";

export type PlatformSourceIcon =
  | (typeof PLATFORM_SOURCE_DEFINITIONS)[number]["icon"]
  | (typeof SPOTIFY_SOURCE_STYLE)["icon"];

/**
 * The icon a platform source wears in DJ's library and on Node's Track and
 * File, tinted with its colour by the caller. Streaming platforms share the
 * globe.
 */
export function platformSourceIcon(icon: PlatformSourceIcon): TablerIcon {
  switch (icon) {
    case "audio-input":
      return IconMicrophone;
    case "static-audio":
      return IconFileMusic;
    case "radio-garden":
      return IconAntenna;
    case "search":
      return IconSearch;
    default:
      return IconWorld;
  }
}
