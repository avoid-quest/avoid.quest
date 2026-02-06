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
  headphoneVolume: z.number(),
  deckACueEnabled: z.boolean(),
  deckBCueEnabled: z.boolean(),
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

const defaultDeckState: Omit<DeckRecord, "id"> = {
  radio: null,
  volume: 1,
  muted: false,
  pan: 0,
  speed: 1,
  channelFilter: 0,
  effects: [],
  filter: {
    type: "lowpass",
    frequency: 1000,
    Q: 1,
    gain: 0,
    enabled: false,
  },
  effectsDryWet: 1,
  repeat: false,
  autoplay: true,
};

/**
 * Initialize DJ state with defaults (only if not already present)
 */
export async function initializeDjState(): Promise<void> {
  // Wait for collections to load from localStorage first
  const [decks, mixer] = await Promise.all([
    deckCollection.stateWhenReady(),
    mixerCollection.stateWhenReady(),
  ]);

  if (!decks.has(DECK_A_ID)) {
    deckCollection.insert({ id: DECK_A_ID, ...defaultDeckState });
  }

  if (!decks.has(DECK_B_ID)) {
    deckCollection.insert({ id: DECK_B_ID, ...defaultDeckState });
  }

  if (!mixer.has(MIXER_ID)) {
    mixerCollection.insert({
      id: MIXER_ID,
      crossfadePosition: 0.5,
      masterVolume: 1,
      headphoneVolume: 1,
      deckACueEnabled: false,
      deckBCueEnabled: false,
    });
  }
}

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

/**
 * Update deck A
 */
export function updateDeckA(updater: (draft: DeckRecord) => void): void {
  // @ts-expect-error - WritableObjectDeep is compatible with DeckRecord in practice
  deckCollection.update(DECK_A_ID, updater);
}

/**
 * Update deck B
 */
export function updateDeckB(updater: (draft: DeckRecord) => void): void {
  // @ts-expect-error - WritableObjectDeep is compatible with DeckRecord in practice
  deckCollection.update(DECK_B_ID, updater);
}

/**
 * Update mixer
 */
export function updateMixer(updater: (draft: MixerRecord) => void): void {
  mixerCollection.update(MIXER_ID, updater);
}

/**
 * Reset deck to defaults
 */
export function resetDeck(deckId: typeof DECK_A_ID | typeof DECK_B_ID): void {
  deckCollection.update(deckId, (draft) => {
    draft.radio = null;
    draft.volume = 1;
    draft.muted = false;
    draft.pan = 0;
    draft.speed = 1;
    draft.channelFilter = 0;
    draft.effects = [];
    draft.filter = {
      type: "lowpass",
      frequency: 1000,
      Q: 1,
      gain: 0,
      enabled: false,
    };
    draft.effectsDryWet = 1;
    draft.repeat = false;
    draft.autoplay = true;
  });
}

/**
 * Reset all DJ state
 */
export function resetAllDjState(): void {
  resetDeck(DECK_A_ID);
  resetDeck(DECK_B_ID);
  mixerCollection.update(MIXER_ID, (draft) => {
    draft.crossfadePosition = 0.5;
    draft.masterVolume = 1;
    draft.headphoneVolume = 1;
    draft.deckACueEnabled = false;
    draft.deckBCueEnabled = false;
  });
}
