import { z } from "zod";

export const radioMetadataConfigSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({
    kind: z.literal("icecast-status"),
    url: z.string().optional(),
  }),
  z.object({
    kind: z.literal("airtime-live-info"),
    urls: z.array(z.string()).min(1),
  }),
  z.object({
    kind: z.literal("nts-live-api"),
    channel: z.enum(["1", "2"]),
  }),
  z.object({
    kind: z.literal("radio-blackout-api"),
    url: z.string().optional(),
  }),
  z.object({ kind: z.literal("icy") }),
]);
