import { z } from "zod";

export const radioSchema = z.object({
  name: z.string().min(1, "Name is required"),
  streamUrl: z.url("Must be a valid URL").min(1, "Stream URL is required"),
  description: z.string().optional(),
  logoUrl: z.url("Must be a valid URL").optional().or(z.literal("")),
  websiteUrl: z.url("Must be a valid URL").optional().or(z.literal("")),
});

export type RadioFormData = z.infer<typeof radioSchema>;
