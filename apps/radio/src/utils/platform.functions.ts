import { env } from "cloudflare:workers";
import {
  AppError,
  type AppErrorInit,
  type AppResult,
  runServerFn,
} from "@avoid.quest/error";
import {
  getBandcampItem,
  isBandcampUrl,
  normalizeBandcampUrl,
} from "@avoid.quest/platforms/bandcamp";
import {
  extractChannelId,
  isRadioGardenUrl,
} from "@avoid.quest/platforms/radiogarden";
import {
  getSoundCloudItem,
  isSoundCloudUrl,
  needsResolution,
  normalizeSoundCloudUrl,
  resolveShortLink,
} from "@avoid.quest/platforms/soundcloud";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { PlatformMetadata } from "@/lib/platform-types";
import { getCachedRadioGardenItem } from "@/lib/stations/directory-cache";
import { rateLimitMiddleware } from "./middleware";

const LoadPlatformItemSchema = z.object({
  url: z
    .string()
    .min(1, "URL is required")
    .max(2048, "URL too long")
    .refine((val) => URL.canParse(val), { message: "Invalid URL format" }),
});

export type LoadPlatformItemResponse = AppResult<{
  format?: "hls" | "progressive";
  metadata: PlatformMetadata;
  streamUrl: string;
}>;

type ResolvedPlatformItem = {
  format?: "hls" | "progressive";
  metadata: PlatformMetadata;
  streamUrl: string;
};

function appErrorFromCause(
  cause: unknown,
  init: Omit<AppErrorInit, "cause">
): AppError {
  return new AppError({ ...init, cause });
}

async function normalizePlatformUrl(url: string): Promise<string> {
  try {
    let normalizedUrl = url.trim();
    if (needsResolution(normalizedUrl)) {
      normalizedUrl = await resolveShortLink(normalizedUrl);
    }
    return normalizeBandcampUrl(normalizeSoundCloudUrl(normalizedUrl));
  } catch (error) {
    throw appErrorFromCause(error, {
      category: "dependency",
      code: "SOUNDCLOUD_SHORTLINK_RESOLVE_FAILED",
      expected: true,
      safeMessage: "Failed to resolve SoundCloud short link",
      status: 400,
    });
  }
}

function providerError(
  platform: "bandcamp" | "radiogarden" | "soundcloud",
  message: string
): AppError {
  const codes = {
    bandcamp: "BANDCAMP_ITEM_LOAD_FAILED",
    radiogarden: "RADIO_GARDEN_ITEM_LOAD_FAILED",
    soundcloud: "SOUNDCLOUD_ITEM_LOAD_FAILED",
  } as const;

  return new AppError({
    category: "dependency",
    code: codes[platform],
    expected: false,
    safeMessage: message,
    status: 500,
  });
}

async function resolveBandcampItem(url: string): Promise<ResolvedPlatformItem> {
  const result = await getBandcampItem(url);
  if (!result.success) {
    throw providerError(
      "bandcamp",
      result.error || "Failed to resolve Bandcamp item"
    );
  }
  return {
    format: result.format,
    metadata: result.metadata,
    streamUrl: result.streamUrl,
  };
}

async function resolveSoundCloudItem(
  url: string
): Promise<ResolvedPlatformItem> {
  const result = await getSoundCloudItem(url, {
    transcodingProtocols: ["hls", "progressive"],
  });
  if (!result.success) {
    throw providerError(
      "soundcloud",
      result.error || "Failed to resolve SoundCloud item"
    );
  }
  return {
    format: result.format,
    metadata: result.metadata,
    streamUrl: result.streamUrl,
  };
}

async function resolveRadioGardenItem(
  url: string
): Promise<ResolvedPlatformItem> {
  const channelId = extractChannelId(url);
  if (!channelId) {
    throw new AppError({
      category: "validation",
      code: "RADIO_GARDEN_CHANNEL_ID_MISSING",
      expected: true,
      safeMessage: "Could not extract Radio Garden channel ID from URL",
      status: 400,
    });
  }

  try {
    const result = await getCachedRadioGardenItem(
      env.RADIO_METADATA,
      channelId
    );
    if (!result.success) {
      throw providerError(
        "radiogarden",
        result.error || "Failed to resolve Radio Garden item"
      );
    }
    return {
      metadata: result.metadata,
      streamUrl: result.streamUrl,
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw providerError(
      "radiogarden",
      error instanceof Error && error.message
        ? error.message
        : "Failed to resolve Radio Garden item"
    );
  }
}

function resolvePlatformItem(
  normalizedUrl: string
): Promise<ResolvedPlatformItem> {
  if (isBandcampUrl(normalizedUrl)) {
    return resolveBandcampItem(normalizedUrl);
  }

  if (isSoundCloudUrl(normalizedUrl)) {
    return resolveSoundCloudItem(normalizedUrl);
  }

  if (isRadioGardenUrl(normalizedUrl)) {
    return resolveRadioGardenItem(normalizedUrl);
  }

  throw new AppError({
    category: "validation",
    code: "PLATFORM_UNSUPPORTED_URL",
    expected: true,
    safeMessage:
      "Unsupported server-side URL. Please enter a Bandcamp, SoundCloud, or Radio Garden URL.",
    status: 400,
  });
}

export const loadPlatformItem = createServerFn({ method: "POST" })
  .middleware([rateLimitMiddleware("load-platform-item")])
  .validator(LoadPlatformItemSchema)
  .handler(
    ({ data }): Promise<LoadPlatformItemResponse> =>
      runServerFn({
        fallback: {
          category: "dependency",
          code: "PLATFORM_ITEM_LOAD_FAILED",
          expected: false,
          safeMessage: "Failed to load platform item",
          status: 500,
        },
        operation: "loadPlatformItem",
        run: async () => {
          const normalizedUrl = await normalizePlatformUrl(data.url);
          const item = await resolvePlatformItem(normalizedUrl);

          if (!item.streamUrl.trim()) {
            throw new AppError({
              category: "dependency",
              code: "PLATFORM_EMPTY_STREAM_URL",
              expected: false,
              safeMessage: "Platform returned no playable stream URL",
              status: 500,
            });
          }

          try {
            const streamUrl = new URL(item.streamUrl);
            if (
              streamUrl.protocol !== "http:" &&
              streamUrl.protocol !== "https:"
            ) {
              throw new TypeError("Unsupported stream URL protocol");
            }
          } catch (error) {
            throw appErrorFromCause(error, {
              category: "dependency",
              code: "PLATFORM_INVALID_STREAM_URL",
              expected: false,
              safeMessage: "Platform returned an invalid stream URL",
              status: 500,
            });
          }

          return item;
        },
      })
  );
