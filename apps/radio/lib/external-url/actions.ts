"use server";

import { getBandcampItem } from "@/lib/external-url/bandcamp";
import { getSoundCloudItem } from "@/lib/external-url/soundcloud";
import { detectPlatformFromUrl } from "./detect";
import type { PlatformItemResponse } from "./types";

/**
 * Unified function to load a platform item from any supported URL.
 * Automatically detects the platform and calls the appropriate action.
 * @param url - The URL to load (Bandcamp or SoundCloud)
 * @returns The platform item response with metadata and stream URL
 */
export async function loadPlatformItem(
  url: string
): Promise<PlatformItemResponse> {
  if (!url || typeof url !== "string" || !url.trim()) {
    return {
      success: false,
      error: "Please enter a valid URL",
    };
  }

  const trimmedUrl = url.trim();
  const platform = detectPlatformFromUrl(trimmedUrl);

  if (!platform) {
    return {
      success: false,
      error: "Unsupported URL. Please enter a Bandcamp or SoundCloud URL.",
    };
  }

  if (platform === "bandcamp") {
    return await getBandcampItem(trimmedUrl);
  }

  if (platform === "soundcloud") {
    return await getSoundCloudItem(trimmedUrl);
  }

  // This should never happen due to TypeScript, but adding for completeness
  return {
    success: false,
    error: "Unsupported platform",
  };
}
