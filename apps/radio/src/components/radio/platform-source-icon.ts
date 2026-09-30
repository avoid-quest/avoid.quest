import {
  FileAudioIcon,
  GlobeIcon,
  type LucideIcon,
  MicIcon,
  RadioTowerIcon,
  SearchIcon,
} from "lucide-react";
import type { PLATFORM_SOURCE_DEFINITIONS } from "@/lib/dj-library-sources";

export type PlatformSourceIcon =
  (typeof PLATFORM_SOURCE_DEFINITIONS)[number]["icon"];

/**
 * The icon a platform source wears in DJ's library and on Node's Track and
 * File, tinted with its colour by the caller. Streaming platforms share the
 * globe.
 */
export function platformSourceIcon(icon: PlatformSourceIcon): LucideIcon {
  switch (icon) {
    case "audio-input":
      return MicIcon;
    case "static-audio":
      return FileAudioIcon;
    case "radio-garden":
      return RadioTowerIcon;
    case "search":
      return SearchIcon;
    default:
      return GlobeIcon;
  }
}
