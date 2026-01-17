import { z } from "zod";
import type { PlatformMetadata } from "@/lib/platform-types";

/**
 * Shared schema for platform metadata.
 * Uses a loose custom type since it comes from external APIs
 * and the full types (BandcampMetadata | SoundCloudMetadata) are complex unions.
 */
export const platformMetadataSchema = z.custom<PlatformMetadata>().optional();
