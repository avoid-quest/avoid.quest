import { env } from "cloudflare:workers";
import { AppError, type AppResult, runServerFn } from "@avoid.quest/error";
import {
  createPlayablePlatformResolver,
  normalizePlayablePlatformUrl,
  type PlayablePlatformResolutionError,
} from "@avoid.quest/platforms";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type {
  PlatformMetadata,
  StaticAudioMetadata,
} from "@/lib/platform-types";
import { readInvidiousOptions } from "./invidious-env";
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

function toPlatformResolutionError(message: string): AppError {
  return new AppError({
    code: "PLATFORM_ITEM_RESOLUTION_FAILED",
    safeMessage: message || "Failed to resolve platform item",
    category: "dependency",
    expected: false,
    status: 500,
  });
}

async function normalizePlatformUrl(url: string): Promise<string> {
  try {
    return await normalizePlayablePlatformUrl(url);
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

function toAppError(error: PlayablePlatformResolutionError): AppError {
  if (error.code === "unsupported-url") {
    return new AppError({
      code: "PLATFORM_UNSUPPORTED_URL",
      safeMessage:
        "Unsupported URL. Please enter a Bandcamp, SoundCloud, YouTube, Radio Garden, or audio file URL.",
      category: "validation",
      expected: true,
      status: 400,
    });
  }

  if (error.code === "radiogarden-channel-id-missing") {
    return new AppError({
      code: "RADIO_GARDEN_CHANNEL_ID_MISSING",
      safeMessage: error.message,
      category: "validation",
      expected: true,
      status: 400,
    });
  }

  const providerErrorCodes = {
    bandcamp: "BANDCAMP_ITEM_LOAD_FAILED",
    radiogarden: "RADIO_GARDEN_ITEM_LOAD_FAILED",
    soundcloud: "SOUNDCLOUD_ITEM_LOAD_FAILED",
    youtube: "YOUTUBE_ITEM_LOAD_FAILED",
  } as const;

  return new AppError({
    code:
      error.platform && error.platform in providerErrorCodes
        ? providerErrorCodes[error.platform as keyof typeof providerErrorCodes]
        : "PLATFORM_ITEM_RESOLUTION_FAILED",
    safeMessage: error.message || "Failed to resolve platform item",
    category: "dependency",
    expected: false,
    status: 500,
  });
}

async function resolveStaticAudioItem(url: string): Promise<{
  metadata: StaticAudioMetadata;
  streamUrl: string;
}> {
  const result = await getStaticAudioItem({ data: { url } });
  if (result.ok) {
    return {
      metadata: result.data.metadata,
      streamUrl: result.data.streamUrl,
    };
  }

  throw toPlatformResolutionError(result.error.message);
}

async function resolvePlatformItem(
  normalizedUrl: string
): Promise<ResolvedPlatformItem> {
  const resolver = createPlayablePlatformResolver<StaticAudioMetadata>({
    invidiousOptions: () => readInvidiousOptions(env),
    resolveStaticAudioItem,
  });
  const result = await resolver.resolveNormalizedItem(normalizedUrl);
  if (!result.success) {
    throw toAppError(result.error);
  }

  return {
    metadata: result.item.metadata,
    streamUrl: result.item.streamUrl,
  };
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
          const item = await resolvePlatformItem(normalizedUrl);

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
