import { z } from "zod";
import type { PlatformMetadata } from "@/lib/platform-types";

/**
 * Platform metadata schema for persistence boundary validation.
 * Uses discriminated union on `platform` to ensure valid data from localStorage.
 * Each variant validates the discriminant + required fields but uses passthrough()
 * for platform-specific optional fields that vary by item type.
 * The final pipe(z.custom<PlatformMetadata>()) narrows the Zod output to the
 * full PlatformMetadata union type for downstream TypeScript consumers.
 */
const bandcampMetadataSchema = z
  .object({
    itemType: z.enum(["album", "track", "artist", "label", "collection"]),
    platform: z.literal("bandcamp"),
    url: z.string(),
  })
  .passthrough();

const soundcloudMetadataSchema = z
  .object({
    itemType: z.enum(["track", "playlist", "user"]),
    platform: z.literal("soundcloud"),
    url: z.string(),
  })
  .passthrough();

const youtubeMetadataSchema = z
  .object({
    itemType: z.enum(["video", "playlist"]),
    platform: z.literal("youtube"),
    url: z.string(),
  })
  .passthrough();

const deviceInputMetadataSchema = z
  .object({
    capture: z.literal("display").optional(),
    deviceId: z.string(),
    deviceLabel: z.string(),
    itemType: z.literal("track"),
    platform: z.literal("device-input"),
    sourceUrl: z.string().optional(),
    url: z.literal(""),
  })
  .passthrough();

const staticAudioMetadataSchema = z
  .object({
    fileName: z.string(),
    itemType: z.enum(["track", "playlist"]),
    platform: z.literal("static-audio"),
    url: z.string(),
  })
  .passthrough();

const radioGardenMetadataSchema = z
  .object({
    channelId: z.string(),
    itemType: z.literal("channel"),
    platform: z.literal("radiogarden"),
    url: z.string(),
  })
  .passthrough();

const radioBrowserMetadataSchema = z
  .object({
    hls: z.boolean().default(false),
    itemType: z.literal("station"),
    platform: z.literal("radio-browser"),
    stationUuid: z.string(),
    url: z.string(),
  })
  .passthrough();

const fileMetadataSchema = z
  .object({
    itemType: z.literal("track"),
    platform: z.literal("local-file"),
    url: z.literal(""),
  })
  .passthrough();

export const platformMetadataSchema = z
  .discriminatedUnion("platform", [
    bandcampMetadataSchema,
    radioBrowserMetadataSchema,
    radioGardenMetadataSchema,
    soundcloudMetadataSchema,
    youtubeMetadataSchema,
    deviceInputMetadataSchema,
    staticAudioMetadataSchema,
    fileMetadataSchema,
  ])
  .pipe(
    z.custom<PlatformMetadata>(
      (val) => val !== null && typeof val === "object" && "platform" in val
    )
  )
  .optional();
