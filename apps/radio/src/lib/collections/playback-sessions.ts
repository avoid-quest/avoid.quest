import {
  createCollection,
  localStorageCollectionOptions,
} from "@tanstack/react-db";
import { z } from "zod";
import { effectConfigSchema } from "@/lib/audio/dsp/effects/effect-config-schema";
import {
  collectLocalNamModelIds,
  createLocalNamModelId,
  deleteUnreferencedNamModels,
  getNamModel,
  saveNamModel,
} from "@/lib/audio/dsp/effects/nam-model-store";
import type { EffectConfig } from "@/lib/audio/dsp/effects/types";
import {
  DEFAULT_EFFECT_TEMPO,
  normalizeEffectTree,
  normalizeTempoBpm,
  updateEffectInTree,
  visitEffectTree,
} from "@/lib/audio/dsp/routing/effect-tree";
import type { Radio } from "@/lib/audio/playback/types";
import { radioMetadataConfigSchema } from "@/lib/metadata/schema";
import { compile } from "@/lib/node-graph/compile";
import {
  getRetainedNodeGraphs,
  type NodeStoreState,
  nodeStore,
} from "@/lib/node-graph/node-store";
import {
  EFFECT_NODE_TYPES,
  getNodeGraphReadOnlyVersion,
  isRadioSourceNode,
  type NodeGraph,
  nodeGraphSchema,
} from "@/lib/node-graph/schema";
import { deriveNodeChannels } from "@/lib/node-graph/session-channels";
import {
  buildNodeSessionFromGraph,
  buildNodeSessionFromTemplate,
} from "@/lib/node-graph/templates";
import { normalizePlayerMode } from "@/lib/normalize-player-mode";
import {
  migrateMultipleSession,
  watchLegacyMultipleWrites,
} from "./migrations/multiple-to-node";
import { migrateNodeGraphSession } from "./migrations/node-graph-v2";
import { radiosCollection } from "./radios";
import { platformMetadataSchema } from "./schemas";
import {
  addSessionRadio,
  isSessionRadio,
  sessionRadiosCollection,
  wasSessionRadioRemoved,
} from "./session-radios";
import { settingsCollection } from "./settings";

const PLAYBACK_SESSIONS_STORAGE_KEY = "radio-app-playback-sessions";
const SETTINGS_ID = "app-settings";

export const PLAYBACK_SESSION_IDS = ["single", "node", "dj"] as const;
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
    countryTitle: z.string().optional(),
    description: z.string().optional(),
    enabled: z.boolean().optional(),
    id: z.union([z.string(), z.number()]).optional(),
    isSystem: z.boolean().optional(),
    logoUrl: z.string().optional(),
    metadataConfig: radioMetadataConfigSchema.optional(),
    name: z.string(),
    order: z.number().optional(),
    placeTitle: z.string().optional(),
    platformMetadata: platformMetadataSchema,
    streamFormat: z.enum(["hls", "progressive"]).optional(),
    streamUrl: z.string(),
    websiteUrl: z.string().optional(),
  })
  .nullable();

const filterConfigSchema = z.object({
  enabled: z.boolean(),
  frequency: z.number(),
  gain: z.number(),
  Q: z.number(),
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
});

const playbackChannelRoleSchema = z.enum([
  "single-primary",
  "single-secondary",
  "deck-a",
  "deck-b",
  "node",
]);

const playbackChannelSchema = z.object({
  autoplay: z.boolean().default(true),
  channelFilter: z.number(),
  cueEnabled: z.boolean().default(false),
  effects: z.array(effectConfigSchema),
  effectsDryWet: z.number(),
  filter: filterConfigSchema,
  id: z.string(),
  muted: z.boolean(),
  order: z.number().default(0),
  pan: z.number(),
  radio: radioSchema,
  repeat: z.boolean().default(false),
  role: playbackChannelRoleSchema,
  speed: z.number(),
  volume: z.number(),
});

const playbackSessionSchema = z
  .object({
    activeChannelId: z.string().nullable().default(null),
    channels: z.array(playbackChannelSchema),
    crossfadePosition: z.number().default(0.5),
    graph: nodeGraphSchema.optional(),
    headphoneVolume: z.number().default(1),
    id: z.enum(PLAYBACK_SESSION_IDS),
    masterVolume: z.number().default(1),
    tempo: z.number().positive().default(DEFAULT_EFFECT_TEMPO),
  })
  .transform((session) => ({
    ...session,
    channels: session.channels.map((channel) => ({
      ...channel,
      effects: normalizeEffectTree(channel.effects),
    })),
    tempo: normalizeTempoBpm(session.tempo),
  }));

export type PlaybackChannelRecord = z.infer<typeof playbackChannelSchema>;
export type PlaybackSessionRecord = z.infer<typeof playbackSessionSchema>;

export function parsePlaybackSessionRecord(
  value: unknown
): PlaybackSessionRecord {
  return playbackSessionSchema.parse(value);
}

const DEFAULT_FILTER: PlaybackChannelRecord["filter"] = {
  enabled: false,
  frequency: 1000,
  gain: 0,
  Q: 1,
  type: "lowpass",
};

export function createDefaultChannel(
  id: string,
  role: PlaybackChannelRecord["role"],
  order = 0
): PlaybackChannelRecord {
  return {
    autoplay: true,
    channelFilter: 0,
    cueEnabled: false,
    effects: [],
    effectsDryWet: 1,
    filter: { ...DEFAULT_FILTER },
    id,
    muted: false,
    order,
    pan: 0,
    radio: null,
    repeat: false,
    role,
    speed: 1,
    volume: 1,
  };
}

/** A channel radio as the session schema accepts it, or null. */
export function normalizeRadio(value: unknown): Radio | null {
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
    activeChannelId: radio ? SINGLE_ACTIVE_CHANNEL_ID : null,
    channels: [
      {
        ...defaultPrimary,
        radio,
        volume,
      },
      defaultSecondary,
    ],
    crossfadePosition: 0.5,
    headphoneVolume: 1,
    id: "single",
    masterVolume: 1,
    tempo: DEFAULT_EFFECT_TEMPO,
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
      cueEnabled: legacyMixer?.deckACueEnabled ?? false,
      id: DECK_A_CHANNEL_ID,
      radio: normalizeRadio(legacyDeckA?.radio ?? null),
      role: "deck-a",
    },
    defaultDeckA
  );
  const deckB = normalizeChannel(
    {
      ...defaultDeckB,
      ...legacyDeckB,
      cueEnabled: legacyMixer?.deckBCueEnabled ?? false,
      id: DECK_B_CHANNEL_ID,
      radio: normalizeRadio(legacyDeckB?.radio ?? null),
      role: "deck-b",
    },
    defaultDeckB
  );

  return {
    activeChannelId: null,
    channels: [deckA, deckB],
    crossfadePosition: legacyMixer?.crossfadePosition ?? 0.5,
    headphoneVolume: legacyMixer?.headphoneVolume ?? 1,
    id: "dj",
    masterVolume: legacyMixer?.masterVolume ?? 1,
    tempo: DEFAULT_EFFECT_TEMPO,
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

function buildSingleSessionFromLegacy(): PlaybackSessionRecord {
  return buildSingleSessionFromLegacyState(readLegacySingleState());
}

function buildDjSessionFromLegacy(): PlaybackSessionRecord {
  return buildDjSessionFromLegacyState(readLegacyDjState());
}

/**
 * The Starter patch, for a new node session: one empty Station slot wired to
 * Speakers. "All my stations" and the other templates stay in the Templates
 * menu.
 */
function buildDefaultNodeSession(): PlaybackSessionRecord {
  return buildNodeSessionFromTemplate("starter");
}

function upsertSession(session: PlaybackSessionRecord): void {
  if (session.id === "node" && getNodeSessionReadOnlyVersion() !== null) {
    return;
  }
  const existing = playbackSessionsCollection.state.get(session.id);
  if (existing) {
    playbackSessionsCollection.update(session.id, (draft) => {
      Object.assign(draft, session);
    });
    return;
  }
  playbackSessionsCollection.insert(session);
}

/**
 * Registers every session radio a Station in `graph` holds back into this
 * tab's session radios. The patch stores the whole radio, so a station
 * picked from search and never saved keeps playing in a new tab, as it
 * does after a reload; without this its Station stayed filled with no
 * lane behind it. One this tab removed on purpose stays removed.
 */
function registerNodeSessionRadios(graph: NodeGraph): void {
  const sessionRadioIds = readStoredSessionRadioIds();
  for (const node of graph.nodes) {
    const radio = isRadioSourceNode(node) ? (node.data.radio as Radio) : null;
    if (
      radio &&
      isSessionOnlyRadio(radio) &&
      !sessionRadioIds.has(String(radio.id)) &&
      !wasSessionRadioRemoved(String(radio.id))
    ) {
      addSessionRadio(radio);
      sessionRadioIds.add(String(radio.id));
    }
  }
}

/** Prepares and validates the entire session without writing or collecting models. */
export function prepareNodeSessionGraph(
  graph: NodeGraph,
  masterVolume?: number
): PlaybackSessionRecord {
  const session = playbackSessionsCollection.state.get("node");
  if (!session) {
    return playbackSessionsCollection.validateData(
      buildNodeSessionFromGraph(graph, masterVolume),
      "insert"
    );
  }
  const channels = deriveNodeChannels(
    compile(graph, { crossOriginIsolated: false }),
    session.channels
  );
  return playbackSessionsCollection.validateData(
    {
      ...session,
      activeChannelId: channels.some(
        (channel) => channel.id === session.activeChannelId
      )
        ? session.activeChannelId
        : null,
      channels,
      graph,
      masterVolume: masterVolume ?? session.masterVolume,
    },
    "insert"
  );
}

/**
 * Writes `graph` as the node session's patch, with its derived lane
 * channels, in one update, or inserts the session when there is none.
 * Session-only sources are registered in this tab. A newer stored patch is
 * left untouched unless an explicit backup import replaces it.
 */
export function writeNodeSessionGraph(
  graph: NodeGraph,
  masterVolume?: number,
  { replaceReadOnly = false }: { replaceReadOnly?: boolean } = {}
): NodeGraph | null {
  if (!replaceReadOnly && getNodeSessionReadOnlyVersion() !== null) {
    return null;
  }
  const prepared = prepareNodeSessionGraph(graph, masterVolume);
  registerNodeSessionRadios(graph);
  if (playbackSessionsCollection.state.has("node")) {
    const previousModelIds = collectSessionNamModelIds(
      playbackSessionsCollection.state.get("node")
    );
    updatePlaybackSessionRecord("node", (draft) => {
      draft.graph = prepared.graph;
      draft.channels = prepared.channels;
      draft.activeChannelId = prepared.activeChannelId;
      draft.masterVolume = prepared.masterVolume;
    });
    scheduleNamModelCleanup(previousModelIds);
  } else {
    playbackSessionsCollection.insert(prepared);
  }
  return prepared.graph as NodeGraph;
}

/** Registers the stored patch's session radios in this tab. */
function restoreNodeSessionRadios(): void {
  if (getNodeSessionReadOnlyVersion() !== null) {
    return;
  }
  const graph = playbackSessionsCollection.state.get("node")?.graph;
  if (graph) {
    registerNodeSessionRadios(graph);
  }
}

export const playbackSessionsCollection = createCollection(
  localStorageCollectionOptions({
    getKey: (item) => item.id,
    id: "playback-sessions",
    schema: playbackSessionSchema,
    startSync: true,
    storageKey: PLAYBACK_SESSIONS_STORAGE_KEY,
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

/**
 * FX configs a Node graph holds. A bypassed or unwired FX node never reaches
 * a lane, so the derived channels alone would let its NAM model be deleted.
 */
function collectGraphEffects(
  graph: NodeGraph | null | undefined
): EffectConfig[] {
  if (getNodeGraphReadOnlyVersion(graph) !== null) {
    return [];
  }
  return (
    graph?.nodes.flatMap((node) =>
      EFFECT_NODE_TYPES.some((type) => type === node.type) &&
      "effect" in node.data
        ? [node.data.effect as EffectConfig]
        : []
    ) ?? []
  );
}

function collectSessionNamModelIds(
  session: PlaybackSessionRecord | undefined
): Set<string> {
  // A retired record kept for a later migration run loads unvalidated.
  const channels = Array.isArray(session?.channels) ? session.channels : [];
  return new Set([
    ...channels.flatMap((channel) =>
      Array.isArray(channel?.effects)
        ? [...collectLocalNamModelIds(channel.effects)]
        : []
    ),
    ...collectLocalNamModelIds(collectGraphEffects(session?.graph)),
  ]);
}

function collectRetainedNamModelIds(
  state: NodeStoreState = nodeStore.state
): Set<string> {
  return new Set(
    [...getRetainedNodeGraphs(state)].flatMap((graph) => [
      ...collectLocalNamModelIds(collectGraphEffects(graph)),
    ])
  );
}

function collectReferencedNamModelIds(): Set<string> {
  return new Set([
    ...collectRetainedNamModelIds(),
    ...[...playbackSessionsCollection.state.values()].flatMap((session) => [
      ...collectSessionNamModelIds(session),
    ]),
  ]);
}

function scheduleNamModelCleanup(candidates: Iterable<string>): void {
  const pending = [...new Set(candidates)];
  if (pending.length === 0) {
    return;
  }
  queueMicrotask(() => {
    // This release cannot determine all references in a future graph.
    if (getNodeSessionReadOnlyVersion() !== null) {
      return;
    }
    deleteUnreferencedNamModels(pending, collectReferencedNamModelIds()).catch(
      (error) =>
        console.warn(
          "[playback-sessions] Could not garbage-collect local NAM models",
          error
        )
    );
  });
}

// History eviction and reset can release models without changing a session.
let observedNodeState = nodeStore.state;
nodeStore.subscribe((state) => {
  const previous = observedNodeState;
  observedNodeState = state;
  if (previous.graph !== state.graph || previous.history !== state.history) {
    scheduleNamModelCleanup(collectRetainedNamModelIds(previous));
  }
});

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
  const effects = [...originalEffects];
  const externalized = await Promise.all(
    collectNamModels(effects).map(async (model) => {
      const { modelData } = model;
      if (!modelData) {
        if (model.modelId?.startsWith("local-nam:")) {
          await getNamModel(model.modelId).catch(() => null);
        }
        return null;
      }
      const modelId = model.modelId?.startsWith("local-nam:")
        ? model.modelId
        : createLocalNamModelId();
      try {
        await saveNamModel(modelId, modelData);
        return { model, modelId };
      } catch (error) {
        console.warn(
          `[playback-sessions] Could not externalize NAM model ${model.modelName ?? model.id}`,
          error
        );
        return null;
      }
    })
  );
  return externalized.reduce<EffectConfig[]>((updatedEffects, result) => {
    if (!result) {
      return updatedEffects;
    }
    return updateEffectInTree(updatedEffects, result.model.id, {
      modelData: null,
      modelId: result.modelId,
    } as Partial<EffectConfig>);
  }, effects);
}

/**
 * Loads the models FX nodes that reach no lane hold, so wiring one later
 * finds its bytes: the audio adapter reads local models from the cache.
 */
async function hydrateGraphNamModels(): Promise<void> {
  const modelIds = [...playbackSessionsCollection.state.values()].flatMap(
    (session) => [
      ...collectLocalNamModelIds(collectGraphEffects(session.graph)),
    ]
  );
  await Promise.all(
    [...new Set(modelIds)].map((modelId) =>
      getNamModel(modelId).catch(() => null)
    )
  );
}

async function externalizeStoredNamModels(): Promise<void> {
  await hydrateGraphNamModels();
  const channels = [...playbackSessionsCollection.state.values()].flatMap(
    (session) =>
      // A retired record left for a later migration run cannot be updated.
      PLAYBACK_SESSION_IDS.includes(session.id) &&
      getNodeGraphReadOnlyVersion(session.graph) === null
        ? session.channels.map((channel) => ({
            channel,
            sessionId: session.id,
          }))
        : []
  );
  const updates = await Promise.all(
    channels.map(async ({ channel, sessionId }) => {
      const effects = await externalizeChannelNamModels(channel.effects);
      return { channel, effects, sessionId };
    })
  );
  for (const { channel, effects, sessionId } of updates) {
    if (effects.some((effect, index) => effect !== channel.effects[index])) {
      updatePlaybackChannel(sessionId, channel.id, (draft) => {
        draft.effects = effects;
      });
    }
  }
}

let stopWatchingLegacyWrites: (() => void) | null = null;

/**
 * Stops the cross-tab Multiple listeners that `initializePlaybackSessions`
 * starts, so a test can write Multiple records without them converting.
 */
export function stopLegacyMultipleListeners(): void {
  stopWatchingLegacyWrites?.();
  stopWatchingLegacyWrites = null;
}

export async function initializePlaybackSessions(): Promise<void> {
  await Promise.all([
    playbackSessionsCollection.stateWhenReady(),
    radiosCollection.stateWhenReady(),
    settingsCollection.stateWhenReady(),
    sessionRadiosCollection.stateWhenReady(),
  ]);

  // Before any update: a stale "multiple" record would fail validation.
  const legacyCollections = {
    radios: radiosCollection,
    sessionRadios: sessionRadiosCollection,
    sessions: playbackSessionsCollection,
  };
  const hasStoredNodeGraph = Boolean(
    playbackSessionsCollection.state.get("node")?.graph
  );
  migrateMultipleSession(legacyCollections);
  // Likewise a node session a v1 release stored: its graph is upgraded
  // before restoreNodeSessionRadios or restore update it.
  migrateNodeGraphSession(playbackSessionsCollection);
  stopWatchingLegacyWrites ??= watchLegacyMultipleWrites({
    ...legacyCollections,
    settings: settingsCollection,
  });

  const settings = settingsCollection.state.get(SETTINGS_ID);
  const shouldRestore = settings?.player.restoreStateOnLoad !== false;
  const discardedModelIds = shouldRestore
    ? []
    : [...collectReferencedNamModelIds()];
  if (shouldRestore) {
    await externalizeStoredNamModels();
  }

  if (!shouldRestore) {
    upsertSession(buildSingleSessionFromLegacyState());
    // Playback starts paused; disabling restoration must not erase a patch.
    if (!hasStoredNodeGraph) {
      upsertSession(buildDefaultNodeSession());
    }
    upsertSession(buildDjSessionFromLegacyState());
    scheduleNamModelCleanup(discardedModelIds);
  } else if (playbackSessionsCollection.state.size === 0) {
    upsertSession(buildSingleSessionFromLegacy());
    upsertSession(buildDefaultNodeSession());
    upsertSession(buildDjSessionFromLegacy());
  } else {
    if (!playbackSessionsCollection.state.has("single")) {
      upsertSession(buildSingleSessionFromLegacy());
    }
    if (!playbackSessionsCollection.state.has("node")) {
      upsertSession(buildDefaultNodeSession());
    }
    if (!playbackSessionsCollection.state.has("dj")) {
      upsertSession(buildDjSessionFromLegacy());
    }
  }

  restoreNodeSessionRadios();

  const activeMode = normalizePlayerMode(settings?.player.mode);
  const activeSession = playbackSessionsCollection.state.get(activeMode);
  if (activeSession) {
    try {
      updatePlaybackSession(activeMode, (draft) => {
        draft.masterVolume = draft.masterVolume ?? 1;
      });
    } catch (error) {
      // A patch the v2 step kept unread, for want of a backup, fails it.
      console.warn("[playback-sessions] Could not touch the session", error);
    }
  }
}

export function getPlaybackSession(
  id: PlaybackSessionId
): PlaybackSessionRecord | undefined {
  return playbackSessionsCollection.state.get(id);
}

/** Stored graphs load without schema validation, including future versions. */
export function getNodeSessionReadOnlyVersion(): number | null {
  return getNodeGraphReadOnlyVersion(getPlaybackSession("node")?.graph);
}

export function updatePlaybackSession(
  id: PlaybackSessionId,
  updater: PlaybackSessionUpdater
): void {
  const existing = getPlaybackSession(id);
  if (
    existing &&
    !(id === "node" && getNodeSessionReadOnlyVersion() !== null)
  ) {
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

/**
 * Channel id of the lane a Node-mode source node plays on. The managed sound
 * id is then `node:n:<nodeId>`, which the graph compiler also emits.
 */
export function getNodeChannelId(nodeId: string): string {
  return `n:${nodeId}`;
}
