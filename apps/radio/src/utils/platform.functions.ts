import { env } from "cloudflare:workers";
import { getBandcampItem, normalizeBandcampUrl } from "@avoid.quest/bandcamp";
import {
  getSoundCloudItem,
  needsResolution,
  normalizeSoundCloudUrl,
  resolveShortLink,
} from "@avoid.quest/soundcloud";
import { getYouTubeItem } from "@avoid.quest/youtube";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { detectPlatformFromUrl } from "@/lib/external-url/detect";
import type { PlatformItemResponse } from "@/lib/platform-types";
import { rateLimitMiddleware } from "./middleware";
import { getStaticAudioItem } from "./static-audio.functions";

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
    let url = data.url.trim();

    // Resolve SoundCloud short links first
    if (needsResolution(url)) {
      try {
        url = await resolveShortLink(url);
      } catch {
        return {
          success: false,
          error: "Failed to resolve SoundCloud short link",
        };
      }
    }

    // Normalize mobile URLs
    url = normalizeSoundCloudUrl(url);
    url = normalizeBandcampUrl(url);

    const platform = detectPlatformFromUrl(url);

    if (!platform) {
      return {
        success: false,
        error:
          "Unsupported URL. Please enter a Bandcamp, SoundCloud, YouTube, or audio file URL.",
      };
    }

    if (platform === "bandcamp") {
      return await getBandcampItem(url);
    }

    if (platform === "soundcloud") {
      return await getSoundCloudItem(url);
    }

    if (platform === "youtube") {
      // Pass Invidious config from Cloudflare env
      const invidiousOptions = {
        instanceUrl: env.INVIDIOUS_INSTANCE_URL || undefined,
        auth: env.INVIDIOUS_AUTH || undefined,
      };
      return await getYouTubeItem(url, invidiousOptions);
    }

    if (platform === "static-audio") {
      return await getStaticAudioItem({ data: { url } });
    }

    return {
      success: false,
      error: "Unsupported platform",
    };
  });
