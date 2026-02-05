import { env } from "cloudflare:workers";
import { getBandcampItem } from "@avoid.quest/bandcamp";
import { getSoundCloudItem } from "@avoid.quest/soundcloud";
import { getYouTubeItem } from "@avoid.quest/youtube";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { detectPlatformFromUrl } from "@/lib/external-url/detect";
import type { PlatformItemResponse } from "@/lib/platform-types";
import { rateLimitMiddleware } from "./middleware";

const LoadPlatformItemSchema = z.object({
  url: z
    .string()
    .min(1, "URL is required")
    .max(2048, "URL too long")
    .refine(
      (val) => {
        try {
          new URL(val);
          return true;
        } catch {
          return false;
        }
      },
      { message: "Invalid URL format" }
    ),
});

export const loadPlatformItem = createServerFn({ method: "POST" })
  .middleware([rateLimitMiddleware("load-platform-item")])
  .inputValidator(LoadPlatformItemSchema)
  .handler(async ({ data }): Promise<PlatformItemResponse> => {
    const trimmedUrl = data.url.trim();

    const platform = detectPlatformFromUrl(trimmedUrl);

    if (!platform) {
      return {
        success: false,
        error:
          "Unsupported URL. Please enter a Bandcamp, SoundCloud, or YouTube URL.",
      };
    }

    if (platform === "bandcamp") {
      return await getBandcampItem(trimmedUrl);
    }

    if (platform === "soundcloud") {
      return await getSoundCloudItem(trimmedUrl);
    }

    if (platform === "youtube") {
      // Pass Invidious config from Cloudflare env
      const invidiousOptions = {
        instanceUrl: env.INVIDIOUS_INSTANCE_URL || undefined,
        auth: env.INVIDIOUS_AUTH || undefined,
      };
      return await getYouTubeItem(trimmedUrl, invidiousOptions);
    }

    return {
      success: false,
      error: "Unsupported platform",
    };
  });
