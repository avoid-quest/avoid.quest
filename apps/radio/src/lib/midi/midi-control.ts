import type { EffectConfig } from "@/lib/audio/dsp/effects/types";
import type { ChannelEffects } from "@/lib/channel-effects";
import type { DeckId } from "@/lib/dj-deck";
import {
  collectEffectIds,
  createEffectMidiActions,
  type EffectChangeFactory,
} from "./effect-actions";
import { getMidiPresetById } from "./presets";
import {
  applyTransform,
  type MidiAction,
  type MidiDeviceInfo,
  type MidiMapping,
  type MidiTargetId,
  type MidiTransform,
} from "./types";

export type PersistedMidiControlState = {
  activePresetId: string | null;
  enabled: boolean;
  mappings: MidiMapping[];
};

export type PersistedMidiControl = {
  state: PersistedMidiControlState;
  version: number;
};

export type MidiMappingPersistence = {
  read(): PersistedMidiControl | null;
  write(value: PersistedMidiControl): void;
};

export type MidiBrowserInput = {
  device: MidiDeviceInfo;
  subscribe(listener: (data: Uint8Array) => void): () => void;
};

export type MidiBrowserAccess = {
  inputs(): readonly MidiBrowserInput[];
  subscribeStateChange(listener: () => void): () => void;
};

export type MidiBrowserAdapter = {
  cancelFrame(frameId: number): void;
  isSupported(): boolean;
  now(): number;
  requestAccess(): Promise<MidiBrowserAccess>;
  requestFrame(callback: () => void): number;
  subscribePermission(
    listener: (permission: "denied" | "granted" | "prompt") => void
  ): () => void;
};

export type MidiActionDescriptor = Omit<MidiAction, "dispatch">;

export type MidiControlSnapshot = {
  actions: readonly MidiActionDescriptor[];
  activePresetId: string | null;
  devices: readonly MidiDeviceInfo[];
  djActive: boolean;
  enabled: boolean;
  error: Error | null;
  learningTarget: MidiTargetId | null;
  mappings: readonly MidiMapping[];
  mappingsByTarget: ReadonlyMap<MidiTargetId, MidiMapping>;
  status:
    | "connected"
    | "connecting"
    | "denied"
    | "error"
    | "granted"
    | "prompt"
    | "unsupported";
};

export type MidiControlChange =
  | {
      type: "update-transform";
      targetId: MidiTargetId;
      patch: Partial<MidiTransform>;
    }
  | {
      type: "start-learn";
      targetId: MidiTargetId;
    }
  | {
      type: "set-enabled";
      enabled: boolean;
    }
  | {
      type: "stop-learn";
    }
  | {
      type: "remove-mapping";
      targetId: MidiTargetId;
    }
  | {
      type: "load-preset";
      presetId: string;
    }
  | {
      type: "clear-mappings";
    };

type CreateMidiControlOptions = {
  browser: MidiBrowserAdapter;
  effects?: Pick<ChannelEffects, "change">;
  persistence: MidiMappingPersistence;
  staticActions: readonly MidiAction[];
};

type EffectBinding = {
  actions: MidiAction[];
  deckId: DeckId;
  disposed: boolean;
  pending: Promise<void>;
  queuedContinuous: Map<MidiTargetId, QueuedEffectChange>;
  revision: number;
  tree: readonly EffectConfig[];
};

type QueuedEffectChange = {
  coalesceKey?: MidiTargetId;
  dispatchRevision: number;
  factory: EffectChangeFactory;
};

type ParsedMidiMessage = {
  channel: number;
  control: number;
  message: number;
  rawValue: number;
  type: MidiMapping["type"];
};

const LEGACY_TARGET_IDS: Record<string, string> = {
  "deck-a:effect-drywet": "deck-a:effects-drywet",
  "deck-a:pause": "",
  "deck-a:pitch": "deck-a:speed",
  "deck-a:play": "deck-a:play-pause",
  "deck-b:effect-drywet": "deck-b:effects-drywet",
  "deck-b:pause": "",
  "deck-b:pitch": "deck-b:speed",
  "deck-b:play": "deck-b:play-pause",
  crossfader: "mixer:crossfader",
  "headphone-volume": "mixer:headphone-volume",
  "master-volume": "mixer:master-volume",
};

function parseMidiMessage(data: Uint8Array): ParsedMidiMessage | null {
  if (data.length < 3) {
    return null;
  }
  const statusByte = data[0] ?? 0;
  // biome-ignore lint/suspicious/noBitwiseOperators: MIDI protocol encodes the message kind in the high nibble.
  const message = statusByte & 0xf0;
  if (!(message === 0xb0 || message === 0x90 || message === 0x80)) {
    return null;
  }
  // biome-ignore lint/suspicious/noBitwiseOperators: MIDI protocol encodes the channel in the low nibble.
  const channel = statusByte & 0x0f;
  return {
    channel,
    control: data[1] ?? 0,
    message,
    rawValue: data[2] ?? 0,
    type: message === 0xb0 ? "cc" : "note",
  };
}

function migratePersistedControl(
  stored: PersistedMidiControl
): PersistedMidiControl {
  if (stored.version >= 2) {
    return stored;
  }
  const mappings = (
    Array.isArray(stored.state.mappings)
      ? (stored.state.mappings as unknown as Record<string, unknown>[])
      : []
  )
    .map((mapping) => {
      const legacyId = String(mapping.actionId ?? mapping.targetId ?? "");
      const targetId = LEGACY_TARGET_IDS[legacyId] ?? legacyId;
      if (!targetId) {
        return null;
      }
      return {
        channel: mapping.channel,
        control: mapping.control,
        type: mapping.type,
        targetId,
        ...(mapping.transform ? { transform: mapping.transform } : {}),
      } as MidiMapping;
    })
    .filter((mapping): mapping is MidiMapping => mapping !== null);
  return {
    state: { ...stored.state, mappings },
    version: 2,
  };
}

export function createMidiControl({
  browser,
  effects,
  persistence,
  staticActions,
}: CreateMidiControlOptions) {
  const stored = persistence.read();
  const migrated = stored ? migratePersistedControl(stored) : null;
  if (stored && migrated && migrated !== stored) {
    persistence.write(migrated);
  }
  const persisted = migrated?.state ?? {
    activePresetId: null,
    enabled: false,
    mappings: [],
  };
  let mappings = persisted.mappings;
  let mappingsByTarget = new Map(
    mappings.map((mapping) => [mapping.targetId, mapping] as const)
  );
  let mappingsByKey = new Map(
    mappings.map(
      (mapping) =>
        [
          `${mapping.channel}:${mapping.control}:${mapping.type}`,
          mapping,
        ] as const
    )
  );
  const listeners = new Set<() => void>();
  const actions = new Map(
    staticActions.map((action) => [action.targetId, action] as const)
  );
  let actionDescriptors = staticActions.map(
    ({ dispatch: _, ...action }) => action
  );
  const effectBindings = new Map<DeckId, EffectBinding>();
  const lastButtonDispatch = new Map<MidiTargetId, number>();
  const inputCleanups = new Set<() => void>();
  const pendingValues = new Map<MidiTargetId, number>();
  let accessCleanup: (() => void) | null = null;
  let access: MidiBrowserAccess | null = null;
  let connectRevision = 0;
  let devices: readonly MidiDeviceInfo[] = [];
  let djActive = false;
  let error: Error | null = null;
  let effectDispatchRevision = 0;
  let frameId: number | null = null;
  let learningTarget: MidiTargetId | null = null;
  let lastCcDispatchTime = 0;
  let lifecycleRevision = 0;
  let permissionCleanup: (() => void) | null = null;
  let status: MidiControlSnapshot["status"] = browser.isSupported()
    ? "prompt"
    : "unsupported";
  let snapshot: MidiControlSnapshot;

  const rebuildSnapshot = () => {
    snapshot = {
      actions: actionDescriptors,
      activePresetId: persisted.activePresetId,
      devices,
      djActive,
      enabled: persisted.enabled,
      error,
      learningTarget,
      mappings,
      mappingsByTarget,
      status,
    };
  };
  const notify = () => {
    rebuildSnapshot();
    for (const listener of listeners) {
      listener();
    }
  };
  rebuildSnapshot();

  const persist = () => {
    persisted.mappings = mappings;
    persistence.write({ state: persisted, version: 2 });
  };

  const cancelPendingDispatch = () => {
    effectDispatchRevision += 1;
    for (const binding of effectBindings.values()) {
      binding.queuedContinuous.clear();
    }
    if (frameId !== null) {
      browser.cancelFrame(frameId);
      frameId = null;
    }
    pendingValues.clear();
  };

  const rebuildMappings = () => {
    mappingsByTarget = new Map(
      mappings.map((mapping) => [mapping.targetId, mapping] as const)
    );
    mappingsByKey = new Map(
      mappings.map(
        (mapping) =>
          [
            `${mapping.channel}:${mapping.control}:${mapping.type}`,
            mapping,
          ] as const
      )
    );
  };

  const rebuildActions = () => {
    actions.clear();
    for (const action of staticActions) {
      actions.set(action.targetId, action);
    }
    for (const binding of effectBindings.values()) {
      for (const action of binding.actions) {
        actions.set(action.targetId, action);
      }
    }
    actionDescriptors = [...actions.values()].map(
      ({ dispatch: _, ...action }) => action
    );
    notify();
  };

  const removeMappingsForEffects = (effectIds: ReadonlySet<string>) => {
    if (effectIds.size === 0) {
      return;
    }
    const next = mappings.filter((mapping) => {
      for (const effectId of effectIds) {
        if (mapping.targetId.includes(`:effect:${effectId}:`)) {
          return false;
        }
      }
      return true;
    });
    if (next.length === mappings.length) {
      return;
    }
    cancelPendingDispatch();
    mappings = next;
    rebuildMappings();
    persist();
  };

  const enqueueEffectChange = (
    binding: EffectBinding,
    factory: EffectChangeFactory,
    coalesceKey?: MidiTargetId
  ) => {
    const queued = coalesceKey
      ? binding.queuedContinuous.get(coalesceKey)
      : undefined;
    if (queued) {
      queued.factory = factory;
      return;
    }
    if (!coalesceKey) {
      binding.queuedContinuous.clear();
    }
    const changeRequest: QueuedEffectChange = {
      dispatchRevision: effectDispatchRevision,
      factory,
    };
    if (coalesceKey) {
      changeRequest.coalesceKey = coalesceKey;
      binding.queuedContinuous.set(coalesceKey, changeRequest);
    }
    const lifecycle = lifecycleRevision;
    binding.pending = binding.pending
      .then(async () => {
        if (
          changeRequest.coalesceKey &&
          binding.queuedContinuous.get(changeRequest.coalesceKey) ===
            changeRequest
        ) {
          binding.queuedContinuous.delete(changeRequest.coalesceKey);
        }
        if (
          binding.disposed ||
          changeRequest.dispatchRevision !== effectDispatchRevision
        ) {
          return;
        }
        const change = changeRequest.factory(binding.tree);
        if (!change) {
          return;
        }
        if (!effects) {
          throw new Error("ChannelEffects is unavailable");
        }
        const revision = binding.revision;
        const result = await effects.change(
          { channelId: binding.deckId, sessionId: "dj" },
          change
        );
        if (
          effectBindings.get(binding.deckId) !== binding ||
          binding.revision !== revision
        ) {
          return;
        }
        binding.revision += 1;
        binding.tree = result.desired.tree;
        binding.actions = createEffectMidiActions({
          change: (next, key) => enqueueEffectChange(binding, next, key),
          deckId: binding.deckId,
          tree: binding.tree,
        });
        rebuildActions();
      })
      .catch((caught) => {
        if (
          lifecycleRevision !== lifecycle ||
          binding.disposed ||
          effectBindings.get(binding.deckId) !== binding
        ) {
          return;
        }
        error = caught instanceof Error ? caught : new Error(String(caught));
        notify();
      });
  };

  const dispatchPending = () => {
    frameId = null;
    const now = browser.now();
    if (now - lastCcDispatchTime < 33) {
      if (pendingValues.size > 0) {
        frameId = browser.requestFrame(dispatchPending);
      }
      return;
    }
    lastCcDispatchTime = now;
    for (const [targetId, value] of pendingValues) {
      actions.get(targetId)?.dispatch(value);
    }
    pendingValues.clear();
  };

  const learnFromMessage = (message: ParsedMidiMessage) => {
    if (!learningTarget) {
      return false;
    }
    cancelPendingDispatch();
    mappings = [
      ...mappings.filter((mapping) => mapping.targetId !== learningTarget),
      {
        channel: message.channel,
        control: message.control,
        type: message.type,
        targetId: learningTarget,
      },
    ];
    learningTarget = null;
    persisted.activePresetId = null;
    rebuildMappings();
    persist();
    notify();
    return true;
  };

  const dispatchButton = (
    action: MidiAction,
    targetId: MidiTargetId,
    message: ParsedMidiMessage,
    value: number
  ) => {
    if (action.type !== "button") {
      return false;
    }
    if (message.message === 0x80 || message.rawValue === 0) {
      return true;
    }
    const now = browser.now();
    const last = lastButtonDispatch.get(targetId);
    if (last === undefined || now - last > 50) {
      lastButtonDispatch.set(targetId, now);
      action.dispatch(value);
    }
    return true;
  };

  const handleMessage = (data: Uint8Array) => {
    const message = parseMidiMessage(data);
    if (!message || learnFromMessage(message)) {
      return;
    }
    const mapping = mappingsByKey.get(
      `${message.channel}:${message.control}:${message.type}`
    );
    if (!(mapping && persisted.enabled && djActive)) {
      return;
    }
    const action = actions.get(mapping.targetId);
    if (!action) {
      return;
    }
    const value = applyTransform(
      message.rawValue / 127,
      mapping.transform ?? {}
    );
    if (dispatchButton(action, mapping.targetId, message, value)) {
      return;
    }
    pendingValues.set(mapping.targetId, value);
    frameId ??= browser.requestFrame(dispatchPending);
  };

  const attachInputs = () => {
    for (const cleanup of inputCleanups) {
      cleanup();
    }
    inputCleanups.clear();
    devices = access?.inputs().map((input) => input.device) ?? [];
    for (const input of access?.inputs() ?? []) {
      inputCleanups.add(input.subscribe(handleMessage));
    }
    notify();
  };

  const isStaleConnect = (lifecycle: number, revision: number) =>
    lifecycleRevision !== lifecycle || connectRevision !== revision;

  return {
    change(change: MidiControlChange): void {
      switch (change.type) {
        case "start-learn":
          learningTarget = change.targetId;
          notify();
          return;
        case "stop-learn":
          learningTarget = null;
          notify();
          return;
        case "set-enabled":
          if (!change.enabled) {
            cancelPendingDispatch();
          }
          persisted.enabled = change.enabled;
          persist();
          notify();
          return;
        case "load-preset": {
          const preset = getMidiPresetById(change.presetId);
          if (!preset) {
            return;
          }
          cancelPendingDispatch();
          mappings = [...preset.mappings];
          persisted.activePresetId = preset.id;
          rebuildMappings();
          persist();
          notify();
          return;
        }
        case "remove-mapping":
          cancelPendingDispatch();
          mappings = mappings.filter(
            (mapping) => mapping.targetId !== change.targetId
          );
          persisted.activePresetId = null;
          rebuildMappings();
          persist();
          notify();
          return;
        case "clear-mappings":
          cancelPendingDispatch();
          mappings = [];
          persisted.activePresetId = null;
          rebuildMappings();
          persist();
          notify();
          return;
        default:
          break;
      }
      cancelPendingDispatch();
      mappings = mappings.map((mapping) =>
        mapping.targetId === change.targetId
          ? {
              ...mapping,
              transform: {
                ...mapping.transform,
                ...change.patch,
              } as MidiTransform,
            }
          : mapping
      );
      rebuildMappings();
      persist();
      notify();
    },
    activateDj(): () => void {
      djActive = true;
      notify();
      return () => {
        cancelPendingDispatch();
        djActive = false;
        notify();
      };
    },
    async connect(): Promise<MidiControlSnapshot> {
      if (!browser.isSupported()) {
        status = "unsupported";
        notify();
        return snapshot;
      }
      const lifecycle = lifecycleRevision;
      const revision = ++connectRevision;
      status = "connecting";
      notify();
      try {
        const requestedAccess = access ?? (await browser.requestAccess());
        if (isStaleConnect(lifecycle, revision)) {
          return snapshot;
        }
        access = requestedAccess;
        if (!accessCleanup) {
          const cleanup = access.subscribeStateChange(() => {
            if (lifecycleRevision === lifecycle && access === requestedAccess) {
              attachInputs();
            }
          });
          if (isStaleConnect(lifecycle, revision)) {
            cleanup();
            return snapshot;
          }
          accessCleanup = cleanup;
        }
        status = "connected";
        error = null;
        attachInputs();
      } catch (caught) {
        if (isStaleConnect(lifecycle, revision)) {
          return snapshot;
        }
        error = caught instanceof Error ? caught : new Error(String(caught));
        status = "denied";
        devices = [];
        notify();
      }
      return snapshot;
    },
    bindDeckEffects(deckId: DeckId) {
      const existing = effectBindings.get(deckId);
      if (existing) {
        existing.disposed = true;
      }
      const binding: EffectBinding = {
        actions: [],
        deckId,
        disposed: false,
        pending: Promise.resolve(),
        queuedContinuous: new Map(),
        revision: 0,
        tree: [],
      };
      effectBindings.set(deckId, binding);
      return {
        reconcile(tree: readonly EffectConfig[]) {
          if (binding.disposed) {
            return;
          }
          binding.revision += 1;
          const previousIds = collectEffectIds(binding.tree);
          const nextIds = collectEffectIds(tree);
          removeMappingsForEffects(
            new Set([...previousIds].filter((id) => !nextIds.has(id)))
          );
          binding.tree = tree;
          binding.actions = createEffectMidiActions({
            change: (next, key) => enqueueEffectChange(binding, next, key),
            deckId,
            tree,
          });
          rebuildActions();
        },
        dispose() {
          if (effectBindings.get(deckId) !== binding) {
            return;
          }
          binding.disposed = true;
          effectBindings.delete(deckId);
          rebuildActions();
        },
      };
    },
    start(): void {
      if (permissionCleanup || !browser.isSupported()) {
        return;
      }
      const lifecycle = lifecycleRevision;
      permissionCleanup = browser.subscribePermission((permission) => {
        if (lifecycleRevision !== lifecycle) {
          return;
        }
        if (status !== "connected" || permission !== "granted") {
          status = permission;
        }
        notify();
      });
    },
    cleanup(): void {
      lifecycleRevision += 1;
      connectRevision += 1;
      cancelPendingDispatch();
      lastButtonDispatch.clear();
      lastCcDispatchTime = 0;
      permissionCleanup?.();
      permissionCleanup = null;
      accessCleanup?.();
      accessCleanup = null;
      for (const cleanup of inputCleanups) {
        cleanup();
      }
      inputCleanups.clear();
      access = null;
      devices = [];
      djActive = false;
      learningTarget = null;
      error = null;
      for (const binding of effectBindings.values()) {
        binding.disposed = true;
      }
      effectBindings.clear();
      status = browser.isSupported() ? "prompt" : "unsupported";
      rebuildActions();
      listeners.clear();
    },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type MidiControl = ReturnType<typeof createMidiControl>;
