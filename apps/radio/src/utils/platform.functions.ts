import { env } from "cloudflare:workers";
import { AppError, type AppResult, runServerFn } from "@avoid.quest/error";
import {
  extractChannelId,
  getBandcampItem,
  getRadioGardenItem,
  getSoundCloudItem,
  getYouTubeItem,
  needsResolution,
  normalizeBandcampUrl,
  normalizeSoundCloudUrl,
  resolveShortLink,
} from "@avoid.quest/platforms";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { detectPlatformFromUrl } from "@/lib/external-url/detect";
import type { PlatformMetadata } from "@/lib/platform-types";
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

export type LoadPlatformItemResponse = AppResult<{
  metadata: PlatformMetadata;
  streamUrl: string;
}>;

type ResolvedPlatformItem = {
  metadata: PlatformMetadata;
  streamUrl: string;
};
type SupportedPlatform = NonNullable<ReturnType<typeof detectPlatformFromUrl>>;

function toPlatformResolutionError(message: string): AppError {
  return new AppError({
    code: "PLATFORM_ITEM_RESOLUTION_FAILED",
    safeMessage: message || "Failed to resolve platform item",
    category: "dependency",
    expected: false,
    status: 500,
  });
}

function requireSuccess<T extends { success: boolean; error?: string }>(
  result: T,
  fallbackMessage: string,
  code: string
): asserts result is T & { success: true } {
  if (result.success) {
    return;
  }

  throw new AppError({
    code,
    safeMessage: result.error || fallbackMessage,
    category: "dependency",
    expected: false,
    status: 500,
  });
}

async function normalizePlatformUrl(url: string): Promise<string> {
  let normalized = url.trim();

  if (needsResolution(normalized)) {
    try {
      normalized = await resolveShortLink(normalized);
    } catch {
      throw new AppError({
        code: "SOUNDCLOUD_SHORTLINK_RESOLVE_FAILED",
        safeMessage: "Failed to resolve SoundCloud short link",
        category: "dependency",
        expected: true,
        status: 400,
      });
    }
  }

  normalized = normalizeSoundCloudUrl(normalized);
  return normalizeBandcampUrl(normalized);
}

function getSupportedPlatform(url: string): SupportedPlatform {
  const platform = detectPlatformFromUrl(url);
  if (!platform) {
    throw new AppError({
      code: "PLATFORM_UNSUPPORTED_URL",
      safeMessage:
        "Unsupported URL. Please enter a Bandcamp, SoundCloud, YouTube, Radio Garden, or audio file URL.",
      category: "validation",
      expected: true,
      status: 400,
    });
  }
  return platform;
}

async function resolveBandcampItem(url: string): Promise<ResolvedPlatformItem> {
  const result = await getBandcampItem(url);
  requireSuccess(
    result,
    "Failed to resolve Bandcamp item",
    "BANDCAMP_ITEM_LOAD_FAILED"
  );
  return { metadata: result.metadata, streamUrl: result.streamUrl };
}

async function resolveSoundCloudItem(
  url: string
): Promise<ResolvedPlatformItem> {
  const result = await getSoundCloudItem(url);
  requireSuccess(
    result,
    "Failed to resolve SoundCloud item",
    "SOUNDCLOUD_ITEM_LOAD_FAILED"
  );
  return { metadata: result.metadata, streamUrl: result.streamUrl };
}

async function resolveYouTubeItem(url: string): Promise<ResolvedPlatformItem> {
  const invidiousOptions = {
    instanceUrl: env.INVIDIOUS_INSTANCE_URL || undefined,
    auth: env.INVIDIOUS_AUTH || undefined,
  };
  const result = await getYouTubeItem(url, invidiousOptions);
  requireSuccess(
    result,
    "Failed to resolve YouTube item",
    "YOUTUBE_ITEM_LOAD_FAILED"
  );
  return { metadata: result.metadata, streamUrl: result.streamUrl };
}

async function resolveRadioGardenItem(
  url: string
): Promise<ResolvedPlatformItem> {
  const channelId = extractChannelId(url);
  if (!channelId) {
    throw new AppError({
      code: "RADIO_GARDEN_CHANNEL_ID_MISSING",
      safeMessage: "Could not extract Radio Garden channel ID from URL",
      category: "validation",
      expected: true,
      status: 400,
    });
  }

  const result = await getRadioGardenItem(channelId);
  requireSuccess(
    result,
    "Failed to resolve Radio Garden item",
    "RADIO_GARDEN_ITEM_LOAD_FAILED"
  );
  return { metadata: result.metadata, streamUrl: result.streamUrl };
}

async function resolveStaticAudioItem(
  url: string
): Promise<ResolvedPlatformItem> {
  const result = await getStaticAudioItem({ data: { url } });
  if (!result.ok) {
    throw toPlatformResolutionError(result.error.message);
  }

  return {
    metadata: result.data.metadata,
    streamUrl: result.data.streamUrl,
  };
}

function resolvePlatformItem(
  platform: SupportedPlatform,
  url: string
): Promise<ResolvedPlatformItem> {
  switch (platform) {
    case "bandcamp":
      return resolveBandcampItem(url);
    case "soundcloud":
      return resolveSoundCloudItem(url);
    case "youtube":
      return resolveYouTubeItem(url);
    case "radiogarden":
      return resolveRadioGardenItem(url);
    case "static-audio":
      return resolveStaticAudioItem(url);
    default:
      throw new AppError({
        code: "PLATFORM_UNSUPPORTED",
        safeMessage: "Unsupported platform",
        category: "validation",
        expected: true,
        status: 400,
      });
  }
}

export const loadPlatformItem = createServerFn({ method: "POST" })
  .middleware([rateLimitMiddleware("load-platform-item")])
  .inputValidator(LoadPlatformItemSchema)
  .handler(
    ({ data }): Promise<LoadPlatformItemResponse> =>
      runServerFn({
        operation: "loadPlatformItem",
        fallback: {
          code: "PLATFORM_ITEM_LOAD_FAILED",
          safeMessage: "Failed to load platform item",
          category: "dependency",
          expected: false,
          status: 500,
        },
        run: async () => {
          const normalizedUrl = await normalizePlatformUrl(data.url);
          const platform = getSupportedPlatform(normalizedUrl);
          const item = await resolvePlatformItem(platform, normalizedUrl);

          if (!item.streamUrl?.trim()) {
            throw new AppError({
              code: "PLATFORM_EMPTY_STREAM_URL",
              safeMessage: "Platform returned no playable stream URL",
              category: "dependency",
              expected: false,
              status: 500,
            });
          }

          if (
            !(
              item.streamUrl.startsWith("yt:") || item.streamUrl.startsWith("/")
            )
          ) {
            try {
              new URL(item.streamUrl);
            } catch {
              throw new AppError({
                code: "PLATFORM_INVALID_STREAM_URL",
                safeMessage: "Platform returned an invalid stream URL",
                category: "dependency",
                expected: false,
                status: 500,
              });
            }
          }

          return item;
        },
      })
  );
