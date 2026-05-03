import {
  createCollection,
  localStorageCollectionOptions,
} from "@tanstack/react-db";
import { z } from "zod";
import { platformMetadataSchema } from "./schemas";

const radioSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    name: z.string(),
    streamUrl: z.string(),
    logoUrl: z.string().optional(),
    description: z.string().optional(),
    websiteUrl: z.string().optional(),
    placeTitle: z.string().optional(),
    countryTitle: z.string().optional(),
    order: z.number().optional(),
    enabled: z.boolean().optional(),
    platformMetadata: platformMetadataSchema,
  })
  .nullable();

const singleStateSchema = z.object({
  id: z.string(),
  radio: radioSchema,
  volume: z.number().min(0).max(1).default(1),
});

export type SingleStateRecord = z.infer<typeof singleStateSchema>;

export const SINGLE_STATE_ID = "single-state";

export const singleStateCollection = createCollection(
  localStorageCollectionOptions({
    id: "single-state",
    storageKey: "radio-app-single-state",
    getKey: (item) => item.id,
    schema: singleStateSchema,
  })
);

export function getSingleState(): SingleStateRecord | undefined {
  return singleStateCollection.state.get(SINGLE_STATE_ID);
}
