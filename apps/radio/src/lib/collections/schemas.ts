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
    platform: z.literal("bandcamp"),
    itemType: z.enum(["album", "track", "artist", "label", "collection"]),
    url: z.string(),
  })
  .passthrough();

const soundcloudMetadataSchema = z
  .object({
    platform: z.literal("soundcloud"),
    itemType: z.enum(["track", "playlist", "user"]),
    url: z.string(),
  })
  .passthrough();

const youtubeMetadataSchema = z
  .object({
    platform: z.literal("youtube"),
    itemType: z.enum(["video", "playlist"]),
    url: z.string(),
  })
  .passthrough();

const deviceInputMetadataSchema = z
  .object({
    platform: z.literal("device-input"),
    itemType: z.literal("track"),
    url: z.literal(""),
    deviceId: z.string(),
    deviceLabel: z.string(),
  })
  .passthrough();

const staticAudioMetadataSchema = z
  .object({
    platform: z.literal("static-audio"),
    itemType: z.enum(["track", "playlist"]),
    url: z.string(),
    fileName: z.string(),
  })
  .passthrough();

const fileMetadataSchema = z
  .object({
    platform: z.literal("local-file"),
    itemType: z.literal("track"),
    url: z.literal(""),
  })
  .passthrough();

export const platformMetadataSchema = z
  .discriminatedUnion("platform", [
    bandcampMetadataSchema,
    soundcloudMetadataSchema,
    youtubeMetadataSchema,
    deviceInputMetadataSchema,
    staticAudioMetadataSchema,
    fileMetadataSchema,
  ])
  .pipe(
    z.custom<PlatformMetadata>(
      (val) => val != null && typeof val === "object" && "platform" in val
    )
  )
  .optional();
