import {
  createCollection,
  localStorageCollectionOptions,
} from "@tanstack/react-db";
import { z } from "zod";
import { EFFECT_TYPES, type EffectConfig } from "@/lib/audio/dsp/effects/types";
import { platformMetadataSchema } from "./schemas";

const radioSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    name: z.string(),
    streamUrl: z.string(),
    logoUrl: z.string().optional(),
    description: z.string().optional(),
    websiteUrl: z.string().optional(),
    order: z.number().optional(),
    enabled: z.boolean().optional(),
    platformMetadata: platformMetadataSchema,
  })
  .nullable();

const filterConfigSchema = z.object({
  type: z.enum([
    "lowpass",
    "highpass",
    "bandpass",
    "lowshelf",
    "highshelf",
    "peaking",
    "notch",
    "allpass",
  ]),
  frequency: z.number(),
  Q: z.number(),
  gain: z.number(),
  enabled: z.boolean(),
});

const effectConfigSchema = z
  .object({
    id: z.string(),
    type: z.enum(EFFECT_TYPES),
    enabled: z.boolean(),
    order: z.number(),
    dryWet: z.number(),
    inputGain: z.number(),
    outputGain: z.number(),
  })
  .passthrough()
  // Narrow Zod's inferred output to the full EffectConfig union.
  // passthrough() preserves effect-specific fields at runtime;
  // pipe() aligns the TypeScript type for downstream consumers.
  .pipe(
    z.custom<EffectConfig>(
      (val) =>
        val != null && typeof val === "object" && "type" in val && "id" in val
    )
  );

const deckStateSchema = z.object({
  id: z.string(),
  // Source
  radio: radioSchema,
  // Channel Strip
  volume: z.number(),
  muted: z.boolean(),
  pan: z.number(),
  speed: z.number(),
  channelFilter: z.number(),
  // Effects
  effects: z.array(effectConfigSchema),
  filter: filterConfigSchema,
  effectsDryWet: z.number(),
  // Playback
  repeat: z.boolean().default(false),
  autoplay: z.boolean().default(true),
});

const mixerStateSchema = z.object({
  id: z.string(),
  crossfadePosition: z.number(),
  masterVolume: z.number(),
  // CUE monitoring
  headphoneVolume: z.number().default(1),
  deckACueEnabled: z.boolean().default(false),
  deckBCueEnabled: z.boolean().default(false),
});

export type DeckRecord = z.infer<typeof deckStateSchema>;
export type MixerRecord = z.infer<typeof mixerStateSchema>;

const DECK_A_ID = "deck-a";
const DECK_B_ID = "deck-b";
const MIXER_ID = "mixer";

export const deckCollection = createCollection(
  localStorageCollectionOptions({
    id: "dj-decks",
    storageKey: "radio-app-dj-decks",
    getKey: (item) => item.id,
    schema: deckStateSchema,
  })
);

export const mixerCollection = createCollection(
  localStorageCollectionOptions({
    id: "dj-mixer",
    storageKey: "radio-app-dj-mixer",
    getKey: (item) => item.id,
    schema: mixerStateSchema,
  })
);

/**
 * Get deck A state
 */
export function getDeckA(): DeckRecord | undefined {
  return deckCollection.state.get(DECK_A_ID);
}

/**
 * Get deck B state
 */
export function getDeckB(): DeckRecord | undefined {
  return deckCollection.state.get(DECK_B_ID);
}

/**
 * Get mixer state
 */
export function getMixer(): MixerRecord | undefined {
  return mixerCollection.state.get(MIXER_ID);
}
