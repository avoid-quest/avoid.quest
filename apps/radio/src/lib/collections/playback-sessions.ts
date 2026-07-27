import {
  createCollection,
  localStorageCollectionOptions,
} from "@tanstack/react-db";
import { z } from "zod";
import {
  collectLocalNamModelIds,
  createLocalNamModelId,
  deleteUnreferencedNamModels,
  getNamModel,
  saveNamModel,
} from "@/lib/audio/dsp/effects/nam-model-store";
import { createDefaultEffectConfig } from "@/lib/audio/dsp/effects/registry";
import {
  EFFECT_TYPES,
  type EffectChainConfig,
  type EffectConfig,
  OPENDAW_TIDAL_FRACTIONS,
} from "@/lib/audio/dsp/effects/types";
import {
  DEFAULT_EFFECT_TEMPO,
  isValidFrequencySplitShape,
  normalizeEffectTree,
  normalizeTempoBpm,
  updateEffectInTree,
  visitEffectTree,
} from "@/lib/audio/dsp/routing/effect-tree";
import type { Radio } from "@/lib/audio/playback/types";
import { radioMetadataConfigSchema } from "@/lib/metadata/schema";
import { radiosCollection } from "./radios";
import { platformMetadataSchema } from "./schemas";
import { isSessionRadio, sessionRadiosCollection } from "./session-radios";
import { settingsCollection } from "./settings";

const PLAYBACK_SESSIONS_STORAGE_KEY = "radio-app-playback-sessions";
const SETTINGS_ID = "app-settings";

export const PLAYBACK_SESSION_IDS = ["single", "multiple", "dj"] as const;
export type PlaybackSessionId = (typeof PLAYBACK_SESSION_IDS)[number];

export const SINGLE_ACTIVE_CHANNEL_ID = "single-a";
export const SINGLE_STANDBY_CHANNEL_ID = "single-b";
export const DECK_A_CHANNEL_ID = "deck-a";
export const DECK_B_CHANNEL_ID = "deck-b";

const LEGACY_SINGLE_STATE_KEY = "radio-app-single-state";
const LEGACY_DJ_DECKS_KEY = "radio-app-dj-decks";
const LEGACY_DJ_MIXER_KEY = "radio-app-dj-mixer";

const radioSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    name: z.string(),
    streamUrl: z.string(),
    streamFormat: z.enum(["hls", "progressive"]).optional(),
    logoUrl: z.string().optional(),
    description: z.string().optional(),
    websiteUrl: z.string().optional(),
    placeTitle: z.string().optional(),
    countryTitle: z.string().optional(),
    order: z.number().optional(),
    enabled: z.boolean().optional(),
    isSystem: z.boolean().optional(),
    platformMetadata: platformMetadataSchema,
    metadataConfig: radioMetadataConfigSchema.optional(),
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

const effectSidechainSchema = z.object({
  channelId: z.string().min(1),
});

let effectConfigSchema: z.ZodType<EffectConfig>;

function closestTidalDivision(rate: number): string {
  const period = 1 / Math.max(0.001, rate);
  const secondsPerBeat = 60 / DEFAULT_EFFECT_TEMPO;
  return OPENDAW_TIDAL_FRACTIONS.reduce(
    (best, division) => {
      const [numerator = 1, denominator = 4] = division.split("/").map(Number);
      const [bestNumerator = 1, bestDenominator = 4] = best
        .split("/")
        .map(Number);
      const duration = secondsPerBeat * 4 * (numerator / denominator);
      const bestDuration =
        secondsPerBeat * 4 * (bestNumerator / bestDenominator);
      return Math.abs(duration - period) < Math.abs(bestDuration - period)
        ? division
        : best;
    },
    "1/4" as (typeof OPENDAW_TIDAL_FRACTIONS)[number]
  );
}

function migrateLegacyDelay(config: Record<string, unknown>): void {
  if (config.delayMusical === undefined) {
    config.delayMusical =
      config.tempoSync === true && typeof config.tempoDivision === "string"
        ? config.tempoDivision
        : "Off";
  }
  if (config.delayMillis === undefined) {
    config.delayMillis =
      config.tempoSync === true
        ? 0
        : Math.max(0, Number(config.delayTime ?? 0.3)) * 1000;
  }
  if (config.cross === undefined) {
    config.cross =
      typeof config.crossFeedback === "number" ? config.crossFeedback : 0;
  }
}

function migrateLegacyCompressor(config: Record<string, unknown>): void {
  for (const [native, legacy] of [
    ["automakeup", "autoMakeup"],
    ["autoattack", "autoAttack"],
    ["autorelease", "autoRelease"],
  ] as const) {
    if (config[native] === undefined && config[legacy] !== undefined) {
      config[native] = config[legacy];
    }
  }
}

function migrateLegacyEffectConfig(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const migrated = { ...value } as Record<string, unknown>;
  if (migrated.type === "delay") {
    migrateLegacyDelay(migrated);
  } else if (
    migrated.type === "tidal" &&
    migrated.rateDivision === undefined &&
    typeof migrated.rate === "number"
  ) {
    migrated.rateDivision = closestTidalDivision(migrated.rate);
  } else if (migrated.type === "compressor") {
    migrateLegacyCompressor(migrated);
  }
  return migrated;
}

const effectChainConfigSchema: z.ZodType<EffectChainConfig> = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string(),
    order: z.number(),
    gain: z.number(),
    pan: z.number(),
    muted: z.boolean(),
    solo: z.boolean(),
    effects: z.array(effectConfigSchema),
  })
);

effectConfigSchema = z.lazy(() =>
  z.preprocess(
    migrateLegacyEffectConfig,
    z
      .object({
        id: z.string(),
        type: z.enum(EFFECT_TYPES),
        enabled: z.boolean(),
        order: z.number(),
        dryWet: z.number(),
        inputGain: z.number(),
        outputGain: z.number(),
        sidechain: effectSidechainSchema.optional(),
        chains: z.array(effectChainConfigSchema).optional(),
        crossoverFrequencies: z.array(z.number()).optional(),
      })
      .passthrough()
      .superRefine((value, context) => {
        if (
          (value.type === "fxComposite" ||
            value.type === "stereoSplit" ||
            value.type === "frequencySplit") &&
          !value.chains
        ) {
          context.addIssue({
            code: "custom",
            message: `${value.type} requires child chains`,
            path: ["chains"],
          });
        }
        if (value.type === "stereoSplit" && value.chains?.length !== 2) {
          context.addIssue({
            code: "custom",
            message: "Stereo Split requires left and right chains",
            path: ["chains"],
          });
        }
        if (
          value.type === "frequencySplit" &&
          !isValidFrequencySplitShape(
            value.chains ?? [],
            value.crossoverFrequencies ?? []
          )
        ) {
          context.addIssue({
            code: "custom",
            message:
              "Frequency Split requires 2–4 bands with ascending crossovers",
            path: ["chains"],
          });
        }
      })
      .transform(
        (value) =>
          ({
            ...createDefaultEffectConfig(value.type, value.id, value.order),
            ...value,
          }) as EffectConfig
      )
  )
);

const playbackChannelRoleSchema = z.enum([
  "single-primary",
  "single-secondary",
  "deck-a",
  "deck-b",
  "multiple",
]);

const playbackChannelSchema = z.object({
  id: z.string(),
  role: playbackChannelRoleSchema,
  radio: radioSchema,
  volume: z.number(),
  muted: z.boolean(),
  pan: z.number(),
  speed: z.number(),
  channelFilter: z.number(),
  effects: z.array(effectConfigSchema),
  filter: filterConfigSchema,
  effectsDryWet: z.number(),
  repeat: z.boolean().default(false),
  autoplay: z.boolean().default(true),
  cueEnabled: z.boolean().default(false),
  order: z.number().default(0),
});

const playbackSessionSchema = z
  .object({
    id: z.enum(PLAYBACK_SESSION_IDS),
    channels: z.array(playbackChannelSchema),
    masterVolume: z.number().default(1),
    crossfadePosition: z.number().default(0.5),
    headphoneVolume: z.number().default(1),
    tempo: z.number().positive().default(DEFAULT_EFFECT_TEMPO),
    activeChannelId: z.string().nullable().default(null),
  })
  .transform((session) => ({
    ...session,
    tempo: normalizeTempoBpm(session.tempo),
    channels: session.channels.map((channel) => ({
      ...channel,
      effects: normalizeEffectTree(channel.effects),
    })),
  }));

export type PlaybackChannelRecord = z.infer<typeof playbackChannelSchema>;
export type PlaybackSessionRecord = z.infer<typeof playbackSessionSchema>;

export function parsePlaybackSessionRecord(
  value: unknown
): PlaybackSessionRecord {
  return playbackSessionSchema.parse(value);
}

const DEFAULT_FILTER: PlaybackChannelRecord["filter"] = {
  type: "lowpass",
  frequency: 1000,
  Q: 1,
  gain: 0,
  enabled: false,
};

export function createDefaultChannel(
  id: string,
  role: PlaybackChannelRecord["role"],
  order = 0
): PlaybackChannelRecord {
  return {
    id,
    role,
    radio: null,
    volume: 1,
    muted: false,
    pan: 0,
    speed: 1,
    channelFilter: 0,
    effects: [],
    filter: { ...DEFAULT_FILTER },
    effectsDryWet: 1,
    repeat: false,
    autoplay: true,
    cueEnabled: false,
    order,
  };
}

function normalizeRadio(value: unknown): Radio | null {
  const parsed = radioSchema.safeParse(value);
  return parsed.success ? (parsed.data as Radio | null) : null;
}

function normalizeChannel(
  value: unknown,
  fallback: PlaybackChannelRecord
): PlaybackChannelRecord {
  const parsed = playbackChannelSchema.safeParse(value);
  if (!parsed.success) {
    return fallback;
  }
  return {
    ...parsed.data,
    effects: normalizeEffectTree(parsed.data.effects),
  };
}

function readLegacyLocalStorage<T>(key: string): T | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function readLegacyCollectionState<
  T extends { state?: { values?: unknown[] } },
>(key: string): unknown[] {
  const parsed = readLegacyLocalStorage<T>(key);
  const values = parsed?.state?.values;
  return Array.isArray(values) ? values : [];
}

function isSessionOnlyRadio(radio: Radio | null): boolean {
  return radio ? isSessionRadio(radio) : false;
}

function readStoredSessionRadioIds(): Set<string> {
  return new Set(
    Array.from(sessionRadiosCollection.state.values()).map((radio) =>
      String(radio.id)
    )
  );
}

export function buildSingleSessionFromLegacyState(legacySingle?: {
  radio?: unknown;
  volume?: number;
}): PlaybackSessionRecord {
  const defaultPrimary = createDefaultChannel(
    SINGLE_ACTIVE_CHANNEL_ID,
    "single-primary",
    0
  );
  const defaultSecondary = createDefaultChannel(
    SINGLE_STANDBY_CHANNEL_ID,
    "single-secondary",
    1
  );
  const radio = normalizeRadio(legacySingle?.radio ?? null);
  const volume =
    typeof legacySingle?.volume === "number" ? legacySingle.volume : 1;

  return {
    id: "single",
    channels: [
      {
        ...defaultPrimary,
        radio,
        volume,
      },
      defaultSecondary,
    ],
    masterVolume: 1,
    crossfadePosition: 0.5,
    headphoneVolume: 1,
    tempo: DEFAULT_EFFECT_TEMPO,
    activeChannelId: radio ? SINGLE_ACTIVE_CHANNEL_ID : null,
  };
}

function readLegacySingleState():
  | {
      radio?: unknown;
      volume?: number;
    }
  | undefined {
  const legacySingleValues = readLegacyCollectionState<{
    state?: { values?: Array<{ radio?: unknown; volume?: number }> };
  }>(LEGACY_SINGLE_STATE_KEY);
  return legacySingleValues[0] as
    | { radio?: unknown; volume?: number }
    | undefined;
}

export function buildDjSessionFromLegacyState(params?: {
  legacyDecks?: unknown[];
  legacyMixer?: {
    crossfadePosition?: number;
    masterVolume?: number;
    headphoneVolume?: number;
    deckACueEnabled?: boolean;
    deckBCueEnabled?: boolean;
  };
}): PlaybackSessionRecord {
  const defaultDeckA = createDefaultChannel(DECK_A_CHANNEL_ID, "deck-a", 0);
  const defaultDeckB = createDefaultChannel(DECK_B_CHANNEL_ID, "deck-b", 1);
  const legacyDecks = params?.legacyDecks ?? [];
  const legacyDeckMap = new Map(
    legacyDecks
      .map((deck) => deck as { id?: string })
      .filter((deck) => typeof deck.id === "string")
      .map((deck) => [deck.id as string, deck])
  );
  const legacyMixer = params?.legacyMixer;

  const legacyDeckA = legacyDeckMap.get(DECK_A_CHANNEL_ID) as
    | Record<string, unknown>
    | undefined;
  const legacyDeckB = legacyDeckMap.get(DECK_B_CHANNEL_ID) as
    | Record<string, unknown>
    | undefined;

  const deckA = normalizeChannel(
    {
      ...defaultDeckA,
      ...legacyDeckA,
      id: DECK_A_CHANNEL_ID,
      role: "deck-a",
      radio: normalizeRadio(legacyDeckA?.radio ?? null),
      cueEnabled: legacyMixer?.deckACueEnabled ?? false,
    },
    defaultDeckA
  );
  const deckB = normalizeChannel(
    {
      ...defaultDeckB,
      ...legacyDeckB,
      id: DECK_B_CHANNEL_ID,
      role: "deck-b",
      radio: normalizeRadio(legacyDeckB?.radio ?? null),
      cueEnabled: legacyMixer?.deckBCueEnabled ?? false,
    },
    defaultDeckB
  );

  return {
    id: "dj",
    channels: [deckA, deckB],
    masterVolume: legacyMixer?.masterVolume ?? 1,
    crossfadePosition: legacyMixer?.crossfadePosition ?? 0.5,
    headphoneVolume: legacyMixer?.headphoneVolume ?? 1,
    tempo: DEFAULT_EFFECT_TEMPO,
    activeChannelId: null,
  };
}

function readLegacyDjState(): {
  legacyDecks: unknown[];
  legacyMixer:
    | {
        crossfadePosition?: number;
        masterVolume?: number;
        headphoneVolume?: number;
        deckACueEnabled?: boolean;
        deckBCueEnabled?: boolean;
      }
    | undefined;
} {
  const legacyDecks = readLegacyCollectionState<{
    state?: {
      values?: Array<{
        id?: string;
        radio?: unknown;
        volume?: number;
        muted?: boolean;
        pan?: number;
        speed?: number;
        channelFilter?: number;
        effects?: unknown[];
        filter?: unknown;
        effectsDryWet?: number;
        repeat?: boolean;
        autoplay?: boolean;
      }>;
    };
  }>(LEGACY_DJ_DECKS_KEY);

  const legacyMixerValues = readLegacyCollectionState<{
    state?: {
      values?: Array<{
        crossfadePosition?: number;
        masterVolume?: number;
        headphoneVolume?: number;
        deckACueEnabled?: boolean;
        deckBCueEnabled?: boolean;
      }>;
    };
  }>(LEGACY_DJ_MIXER_KEY);

  return {
    legacyDecks,
    legacyMixer: legacyMixerValues[0] as
      | {
          crossfadePosition?: number;
          masterVolume?: number;
          headphoneVolume?: number;
          deckACueEnabled?: boolean;
          deckBCueEnabled?: boolean;
        }
      | undefined,
  };
}

export function buildMultipleSessionFromRadios(
  radios: Array<Radio & { enabled?: boolean; order?: number }>
): PlaybackSessionRecord {
  const enabledRadios = radios
    .filter((radio) => radio.enabled)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  return {
    id: "multiple",
    channels: enabledRadios.map((radio, index) => ({
      ...createDefaultChannel(getMultipleChannelId(radio), "multiple", index),
      radio,
    })),
    masterVolume: 1,
    crossfadePosition: 0.5,
    headphoneVolume: 1,
    tempo: DEFAULT_EFFECT_TEMPO,
    activeChannelId: null,
  };
}

function buildSingleSessionFromLegacy(): PlaybackSessionRecord {
  return buildSingleSessionFromLegacyState(readLegacySingleState());
}

function buildDjSessionFromLegacy(): PlaybackSessionRecord {
  return buildDjSessionFromLegacyState(readLegacyDjState());
}

function buildMultipleSessionFromEnabledRadios(): PlaybackSessionRecord {
  return buildMultipleSessionFromRadios(
    Array.from(radiosCollection.state.values()) as Array<
      Radio & { enabled?: boolean; order?: number }
    >
  );
}

function upsertSession(session: PlaybackSessionRecord): void {
  const existing = playbackSessionsCollection.state.get(session.id);
  if (existing) {
    playbackSessionsCollection.update(session.id, (draft) => {
      Object.assign(draft, session);
    });
    return;
  }
  playbackSessionsCollection.insert(session);
}

function pruneStaleMultipleSessionChannels(): void {
  const multipleSession = playbackSessionsCollection.state.get("multiple");
  if (!multipleSession) {
    return;
  }

  const sessionRadioIds = readStoredSessionRadioIds();
  const channels = multipleSession.channels.filter((channel) => {
    if (!isSessionOnlyRadio(channel.radio)) {
      return true;
    }

    return sessionRadioIds.has(String(channel.radio?.id));
  });

  if (channels.length === multipleSession.channels.length) {
    return;
  }

  replacePlaybackChannels("multiple", channels);
}

export const playbackSessionsCollection = createCollection(
  localStorageCollectionOptions({
    id: "playback-sessions",
    storageKey: PLAYBACK_SESSIONS_STORAGE_KEY,
    getKey: (item) => item.id,
    schema: playbackSessionSchema,
  })
);

type PlaybackSessionUpdater = (draft: PlaybackSessionRecord) => void;
type PlaybackSessionRecordUpdate = (
  this: typeof playbackSessionsCollection,
  key: PlaybackSessionId,
  updater: PlaybackSessionUpdater
) => void;

function updatePlaybackSessionRecord(
  id: PlaybackSessionId,
  updater: PlaybackSessionUpdater
): void {
  // TanStack DB's draft type is narrower than this validated nested schema,
  // so keep the cast at the collection boundary and preserve the method binding.
  const updateRecord =
    playbackSessionsCollection.update as unknown as PlaybackSessionRecordUpdate;
  updateRecord.call(playbackSessionsCollection, id, updater);
}

function collectSessionNamModelIds(
  session: PlaybackSessionRecord | undefined
): Set<string> {
  return new Set(
    session?.channels.flatMap((channel) => [
      ...collectLocalNamModelIds(channel.effects),
    ]) ?? []
  );
}

function collectReferencedNamModelIds(): Set<string> {
  return new Set(
    [...playbackSessionsCollection.state.values()].flatMap((session) => [
      ...collectSessionNamModelIds(session),
    ])
  );
}

function scheduleNamModelCleanup(candidates: Iterable<string>): void {
  const pending = [...new Set(candidates)];
  if (pending.length === 0) {
    return;
  }
  queueMicrotask(() => {
    deleteUnreferencedNamModels(pending, collectReferencedNamModelIds()).catch(
      (error) =>
        console.warn(
          "[playback-sessions] Could not garbage-collect local NAM models",
          error
        )
    );
  });
}

function collectNamModels(
  effects: readonly EffectConfig[]
): Extract<EffectConfig, { type: "neuralAmp" }>[] {
  const models: Extract<EffectConfig, { type: "neuralAmp" }>[] = [];
  visitEffectTree(effects, (effect) => {
    if (effect.type === "neuralAmp") {
      models.push(effect);
    }
  });
  return models;
}

async function externalizeChannelNamModels(
  originalEffects: readonly EffectConfig[]
): Promise<EffectConfig[]> {
  let effects = [...originalEffects];
  for (const model of collectNamModels(effects)) {
    if (!model.modelData) {
      if (model.modelId?.startsWith("local-nam:")) {
        await getNamModel(model.modelId).catch(() => null);
      }
      continue;
    }
    const modelId = model.modelId?.startsWith("local-nam:")
      ? model.modelId
      : createLocalNamModelId();
    try {
      await saveNamModel(modelId, model.modelData);
      effects = updateEffectInTree(effects, model.id, {
        modelId,
        modelData: null,
      } as Partial<EffectConfig>);
    } catch (error) {
      console.warn(
        `[playback-sessions] Could not externalize NAM model ${model.modelName ?? model.id}`,
        error
      );
    }
  }
  return effects;
}

async function externalizeStoredNamModels(): Promise<void> {
  for (const session of playbackSessionsCollection.state.values()) {
    for (const channel of session.channels) {
      const effects = await externalizeChannelNamModels(channel.effects);
      if (effects.some((effect, index) => effect !== channel.effects[index])) {
        updatePlaybackChannel(session.id, channel.id, (draft) => {
          draft.effects = effects;
        });
      }
    }
  }
}

export async function initializePlaybackSessions(): Promise<void> {
  await Promise.all([
    playbackSessionsCollection.stateWhenReady(),
    radiosCollection.stateWhenReady(),
    settingsCollection.stateWhenReady(),
    sessionRadiosCollection.stateWhenReady(),
  ]);
  await externalizeStoredNamModels();

  const settings = settingsCollection.state.get(SETTINGS_ID);
  const shouldRestore = settings?.player.restoreStateOnLoad !== false;

  if (!shouldRestore) {
    upsertSession(buildSingleSessionFromLegacyState());
    upsertSession(buildMultipleSessionFromEnabledRadios());
    upsertSession(buildDjSessionFromLegacyState());
  } else if (playbackSessionsCollection.state.size === 0) {
    upsertSession(buildSingleSessionFromLegacy());
    upsertSession(buildMultipleSessionFromEnabledRadios());
    upsertSession(buildDjSessionFromLegacy());
  } else {
    if (!playbackSessionsCollection.state.has("single")) {
      upsertSession(buildSingleSessionFromLegacy());
    }
    if (!playbackSessionsCollection.state.has("multiple")) {
      upsertSession(buildMultipleSessionFromEnabledRadios());
    }
    if (!playbackSessionsCollection.state.has("dj")) {
      upsertSession(buildDjSessionFromLegacy());
    }
  }

  pruneStaleMultipleSessionChannels();

  const activeMode = settings?.player.mode ?? "single";
  const activeSession = playbackSessionsCollection.state.get(activeMode);
  if (activeSession) {
    playbackSessionsCollection.update(activeMode, (draft) => {
      draft.masterVolume = draft.masterVolume ?? 1;
    });
  }
}

export function getPlaybackSession(
  id: PlaybackSessionId
): PlaybackSessionRecord | undefined {
  return playbackSessionsCollection.state.get(id);
}

export function updatePlaybackSession(
  id: PlaybackSessionId,
  updater: PlaybackSessionUpdater
): void {
  const existing = getPlaybackSession(id);
  if (existing) {
    const previousModelIds = collectSessionNamModelIds(existing);
    updatePlaybackSessionRecord(id, updater);
    scheduleNamModelCleanup(previousModelIds);
  }
}

export function deletePlaybackSession(id: PlaybackSessionId): void {
  const existing = getPlaybackSession(id);
  if (!existing) {
    return;
  }
  const previousModelIds = collectSessionNamModelIds(existing);
  playbackSessionsCollection.delete(id);
  scheduleNamModelCleanup(previousModelIds);
}

export function getPlaybackChannel(
  sessionId: PlaybackSessionId,
  channelId: string
): PlaybackChannelRecord | undefined {
  return getPlaybackSession(sessionId)?.channels.find(
    (channel) => channel.id === channelId
  );
}

export function updatePlaybackChannel(
  sessionId: PlaybackSessionId,
  channelId: string,
  updater: (draft: PlaybackChannelRecord) => void
): void {
  updatePlaybackSession(sessionId, (draft) => {
    const channel = draft.channels.find((entry) => entry.id === channelId);
    if (channel) {
      updater(channel);
    }
  });
}

export function upsertPlaybackChannel(
  sessionId: PlaybackSessionId,
  channel: PlaybackChannelRecord
): void {
  updatePlaybackSession(sessionId, (draft) => {
    const existingIndex = draft.channels.findIndex(
      (entry) => entry.id === channel.id
    );
    if (existingIndex >= 0) {
      draft.channels[existingIndex] = channel;
      return;
    }
    draft.channels.push(channel);
  });
}

export function removePlaybackChannel(
  sessionId: PlaybackSessionId,
  channelId: string
): void {
  updatePlaybackSession(sessionId, (draft) => {
    draft.channels = draft.channels.filter(
      (channel) => channel.id !== channelId
    );
    if (draft.activeChannelId === channelId) {
      draft.activeChannelId = null;
    }
  });
}

export function replacePlaybackChannels(
  sessionId: PlaybackSessionId,
  channels: PlaybackChannelRecord[]
): void {
  updatePlaybackSession(sessionId, (draft) => {
    draft.channels = channels;
    if (
      draft.activeChannelId &&
      !channels.some((channel) => channel.id === draft.activeChannelId)
    ) {
      draft.activeChannelId = null;
    }
  });
}

export function setPlaybackSessionActiveChannel(
  sessionId: PlaybackSessionId,
  channelId: string | null
): void {
  updatePlaybackSession(sessionId, (draft) => {
    draft.activeChannelId = channelId;
  });
}

export function setPlaybackSessionTempo(
  sessionId: PlaybackSessionId,
  tempo: number
): void {
  updatePlaybackSession(sessionId, (draft) => {
    draft.tempo = normalizeTempoBpm(tempo);
  });
}

export function getMultipleChannelId(
  radio: Pick<Radio, "id" | "name">
): string {
  return `multi:${String(radio.id ?? radio.name)}`;
}
