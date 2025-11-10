"use server";

import { unauthorized } from "next/navigation";
import { z } from "zod";
import { getOrCreateSession } from "@/lib/auth/session";
import { getBandcampItem } from "@/lib/external-url/bandcamp";
import { getSoundCloudItem } from "@/lib/external-url/soundcloud";
import { checkRateLimit } from "@/lib/rate-limit";
import { detectPlatformFromUrl } from "./detect";
import type { PlatformItemResponse } from "./types";

type RateLimit = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

const URL_SCHEMA = z
  .string()
  .max(2048)
  .refine((val) => {
    try {
      new URL(val);
      return true;
    } catch {
      return false;
    }
  }, "Invalid URL format");

/**
 * Unified function to load a platform item from any supported URL.
 * Automatically detects the platform and calls the appropriate action.
 * @param url - The URL to load (Bandcamp or SoundCloud)
 * @returns The platform item response with metadata and stream URL
 */
export async function loadPlatformItem(
  url: string
): Promise<PlatformItemResponse> {
  // Authentication check
  const sessionId = await getOrCreateSession();
  if (!sessionId) {
    unauthorized();
  }

  // Rate limiting (using process.env as fallback since server actions don't have direct access to env)
  // Note: In Cloudflare Workers, we'd need to pass env through, but for server actions
  // we'll check if available
  const env = process.env as unknown as { RATE_LIMIT?: RateLimit };
  const rateLimitResult = await checkRateLimit(
    env.RATE_LIMIT,
    sessionId,
    "load-platform-item",
    {
      limit: 50, // 50 requests
      window: 60, // per minute
    }
  );

  if (!rateLimitResult.allowed) {
    return {
      success: false,
      error: "Rate limit exceeded. Please try again later.",
    };
  }

  // Input validation
  if (!url || typeof url !== "string" || !url.trim()) {
    return {
      success: false,
      error: "Please enter a valid URL",
    };
  }

  const trimmedUrl = url.trim();

  // Validate URL format with Zod
  const urlValidation = URL_SCHEMA.safeParse(trimmedUrl);
  if (!urlValidation.success) {
    return {
      success: false,
      error:
        "Invalid URL format. Please enter a valid URL (max 2048 characters).",
    };
  }

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
