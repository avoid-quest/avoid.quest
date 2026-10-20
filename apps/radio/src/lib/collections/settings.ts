import {
  getChangelogSeenAt,
  markChangelogSeen,
} from "@avoid.quest/ui/lib/changelog";
import {
  createCollection,
  localStorageCollectionOptions,
  type StorageApi,
  type StorageEventApi,
} from "@tanstack/react-db";
import { z } from "zod";
import { CHANGELOG_STORAGE_KEY, settings as defaultSettings } from "../const";
import { normalizePlayerMode } from "../normalize-player-mode";
import { generateId } from "../types";

const playerModeSchema = z.enum(["node", "single", "dj"]);

const playerSettingsSchema = z.object({
  mode: playerModeSchema.default("single"),
  restoreStateOnLoad: z.boolean().default(true),
});

const delaySettingsSchema = z.object({
  cueDelayMs: z.number().min(0).max(500).default(0),
  mainDelayMs: z.number().min(0).max(500).default(0),
});

const inputDeckSettingsSchema = z.object({
  channelFilter: z.number().min(-1).max(1),
  collapsed: z.boolean(),
  deviceId: z.string().nullable(),
  effectsDryWet: z.number().min(0).max(1),
  goLiveOnStart: z.boolean(),
  pan: z.number().min(-1).max(1),
  volume: z.number().min(0).max(1.585),
});

const audioSettingsSchema = z.object({
  cueOutputId: z.string().nullable().default(null),
  delay: delaySettingsSchema.optional(),
  inputDeck: inputDeckSettingsSchema.optional(),
  mainOutputId: z.string().default("default"),
});

const settingsSchema = z.object({
  audio: audioSettingsSchema.optional(),
  id: z.string(),
  player: playerSettingsSchema,
});

export type SettingsRecord = z.infer<typeof settingsSchema>;

const SETTINGS_ID = "app-settings";

export const SETTINGS_STORAGE_KEY = "radio-app-settings";

/** The stored mode the settings migration replaced, if it replaced one. */
let replacedPlayerMode: string | undefined;

/** Set once the browser refuses the startup settings; lasts for the visit. */
let keepSettingsInMemory = false;
const memorySettings = new Map<string, string>();

// Resolved as TanStack DB does, so a page without a window keeps its default.
const browserStorage =
  typeof window === "undefined" ? undefined : window.localStorage;

/** localStorage, or memory once the browser refuses the startup settings. */
const settingsStorage: StorageApi | undefined = browserStorage && {
  getItem: (key) =>
    keepSettingsInMemory
      ? (memorySettings.get(key) ?? null)
      : browserStorage.getItem(key),
  removeItem: (key) => {
    if (keepSettingsInMemory) {
      memorySettings.delete(key);
    } else {
      browserStorage.removeItem(key);
    }
  },
  setItem: (key, value) => {
    if (keepSettingsInMemory) {
      memorySettings.set(key, value);
    } else {
      browserStorage.setItem(key, value);
    }
  },
};

const forwardedStorageListeners = new WeakMap<
  (event: StorageEvent) => void,
  (event: StorageEvent) => void
>();

/**
 * Other tabs' writes, presented as `settingsStorage` events: TanStack DB only
 * takes events from its own storage. Memory-only settings ignore them.
 */
const settingsStorageEvents: StorageEventApi | undefined = settingsStorage && {
  addEventListener: (type, listener) => {
    const forward = (event: StorageEvent) => {
      if (keepSettingsInMemory || event.storageArea !== browserStorage) {
        return;
      }
      listener(
        new Proxy(event, {
          get: (target, property) =>
            property === "storageArea"
              ? settingsStorage
              : Reflect.get(target, property),
        })
      );
    };
    forwardedStorageListeners.set(listener, forward);
    window.addEventListener(type, forward);
  },
  removeEventListener: (type, listener) => {
    const forward = forwardedStorageListeners.get(listener);
    if (forward) {
      forwardedStorageListeners.delete(listener);
      window.removeEventListener(type, forward);
    }
  },
};

export const settingsCollection = createCollection(
  localStorageCollectionOptions({
    // Keep rows resident: the app reads `.state` outside live queries, and
    // TanStack DB reclaims unsubscribed collections after `gcTime` otherwise.
    gcTime: 0,
    getKey: (item) => item.id,
    id: "settings",
    schema: settingsSchema,
    startSync: true,
    storage: settingsStorage,
    storageEventApi: settingsStorageEvents,
    storageKey: SETTINGS_STORAGE_KEY,
  })
);

/** The newest What's new entry's date, set by the build; none in tests. */
function getNewestChangelogDate(): string | undefined {
  return typeof __CHANGELOG_NEWEST_DATE__ === "string"
    ? __CHANGELOG_NEWEST_DATE__
    : undefined;
}

/**
 * Initialize settings with defaults if empty
 */
export async function initializeSettings(): Promise<void> {
  // Wait for collection to load from localStorage first
  const existing = await settingsCollection.stateWhenReady();

  if (existing.size === 0) {
    const recovered = recoverStoredSettings();
    if (recovered.length > 0) {
      await insertStartupSettings(recovered);
      migrateLegacyPlayerMode();
      return;
    }
    // A first visit has nothing new to catch up on. Marked before the insert
    // so anything waiting for settings already sees the mark. A reset keeps
    // the mark it finds, so unread changes stay unread. The mark is the
    // newest entry's date, not this browser's clock, which can be off.
    if (getChangelogSeenAt(CHANGELOG_STORAGE_KEY) === null) {
      markChangelogSeen(CHANGELOG_STORAGE_KEY, getNewestChangelogDate());
    }
    await insertStartupSettings([
      {
        id: SETTINGS_ID,
        player: {
          mode: defaultSettings.player.mode,
          restoreStateOnLoad: defaultSettings.player.restoreStateOnLoad ?? true,
        },
      },
    ]);
  }

  migrateLegacyPlayerMode();
}

/**
 * Insert the settings the app starts with. If the browser refuses to save
 * them, e.g. storage is full or blocked, keep them in memory for this visit
 * rather than leave the app without settings. A failed write rolls the
 * insert back, so they are inserted again into memory.
 */
async function insertStartupSettings(rows: SettingsRecord[]): Promise<void> {
  try {
    await settingsCollection.insert(rows).isPersisted.promise;
  } catch (error) {
    if (keepSettingsInMemory || !settingsStorage) {
      throw error;
    }
    console.warn(
      "[settings] Could not save settings; keeping them for this visit",
      error
    );
    keepSettingsInMemory = true;
    await settingsCollection.insert(rows).isPersisted.promise;
  }
}

function recoverStoredSettings(): SettingsRecord[] {
  if (typeof localStorage === "undefined") {
    return [];
  }
  const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
  if (!raw) {
    return [];
  }
  const backupKey = `${SETTINGS_STORAGE_KEY}:corrupt`;
  const previous = localStorage.getItem(backupKey);
  if (previous !== raw) {
    // Backup failures must stop initialization before it replaces the original.
    localStorage.setItem(
      previous ? `${backupKey}:${generateId()}` : backupKey,
      raw
    );
  }
  const recovered = new Map<string, SettingsRecord>();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const entry of Object.values(parsed)) {
        const settings = recoverSettingsEntry(entry);
        if (settings) {
          recovered.set(settings.id, settings);
        }
      }
    }
  } catch (error) {
    console.warn("[settings] Could not recover saved settings", error);
  }
  return [...recovered.values()];
}

function recoverSettingsEntry(entry: unknown): SettingsRecord | undefined {
  const legacy = z
    .object({
      data: z
        .object({
          player: z.object({ mode: z.unknown().optional() }).passthrough(),
        })
        .passthrough(),
    })
    .safeParse(entry);
  if (!legacy.success) {
    return;
  }
  // Keep the existing legacy mode migration when recovering older data.
  const { data } = legacy.data;
  const { player } = data;
  const settings = settingsSchema.safeParse({
    ...data,
    player: { ...player, mode: normalizePlayerMode(player.mode) },
  });
  if (!settings.success) {
    return;
  }
  if (
    typeof player.mode === "string" &&
    player.mode !== settings.data.player.mode
  ) {
    replacedPlayerMode ??= player.mode;
  }
  return settings.data;
}

/**
 * Settings step of the Multiple → Node migration. A stored "multiple" becomes
 * "node", and an unknown mode becomes "single". Settings load unvalidated, so
 * this runs right after they load, before anything else updates the record.
 * It also runs when another tab writes a legacy mode back. Idempotent.
 *
 * It lives here rather than beside the session step, so the critical settings
 * chunk does not pull in the graph compiler.
 */
export function migrateLegacyPlayerMode(): void {
  const mode: unknown = getSettings()?.player.mode;
  if (mode === undefined) {
    return;
  }
  const next = normalizePlayerMode(mode);
  if (next === mode) {
    return;
  }
  try {
    settingsCollection.update(SETTINGS_ID, (draft) => {
      draft.player.mode = next;
    });
    replacedPlayerMode ??= String(mode);
  } catch (error) {
    // A record stale elsewhere fails validation on update. Readers normalise
    // the mode, so startup goes on rather than failing here.
    console.warn("[settings] Could not rewrite the legacy player mode", error);
  }
}

/** The mode `migrateLegacyPlayerMode` first replaced, for the backup. */
export function getReplacedPlayerMode(): string | undefined {
  return replacedPlayerMode;
}

/**
 * Get current settings (singleton)
 */
export function getSettings(): SettingsRecord | undefined {
  return settingsCollection.state.get(SETTINGS_ID);
}

/**
 * Update player mode
 */
export function setPlayerMode(mode: z.infer<typeof playerModeSchema>): void {
  const existing = getSettings();
  if (existing) {
    settingsCollection.update(SETTINGS_ID, (draft) => {
      draft.player.mode = mode;
    });
  } else {
    settingsCollection.insert({
      id: SETTINGS_ID,
      player: {
        mode,
        restoreStateOnLoad: true,
      },
    });
  }
}

/**
 * Update restore state on load setting
 */
export function setRestoreStateOnLoad(restore: boolean): void {
  const existing = getSettings();
  if (existing) {
    settingsCollection.update(SETTINGS_ID, (draft) => {
      draft.player.restoreStateOnLoad = restore;
    });
  }
}

/**
 * Update full player settings
 */
export function updatePlayerSettings(
  updater: (player: SettingsRecord["player"]) => Partial<{
    mode: "single" | "node" | "dj";
    restoreStateOnLoad: boolean;
  }>
): void {
  const existing = getSettings();
  if (existing) {
    settingsCollection.update(SETTINGS_ID, (draft) => {
      const updates = updater(existing.player);
      if (updates.mode !== undefined) {
        draft.player.mode = updates.mode;
      }
      if (updates.restoreStateOnLoad !== undefined) {
        draft.player.restoreStateOnLoad = updates.restoreStateOnLoad;
      }
    });
  }
}

// ============================================
// Audio Settings
// ============================================

/**
 * Get audio settings with defaults
 */
export function getAudioSettings(): NonNullable<SettingsRecord["audio"]> {
  const settings = getSettings();
  return (
    settings?.audio ?? {
      cueOutputId: null,
      delay: {
        cueDelayMs: 0,
        mainDelayMs: 0,
      },
      mainOutputId: "default",
    }
  );
}

/**
 * Get delay settings with defaults
 */
export function getDelaySettings(): {
  mainDelayMs: number;
  cueDelayMs: number;
} {
  const audio = getAudioSettings();
  return audio.delay ?? { cueDelayMs: 0, mainDelayMs: 0 };
}

export function shouldUseNativeSinglePlayback(
  audio = getAudioSettings()
): boolean {
  const mainDelayMs = audio.delay?.mainDelayMs ?? 0;
  return audio.mainOutputId === "default" && mainDelayMs === 0;
}

/**
 * Set main output device
 */
export function setMainOutputDevice(deviceId: string): void {
  const existing = getSettings();
  if (existing) {
    settingsCollection.update(SETTINGS_ID, (draft) => {
      if (draft.audio) {
        draft.audio.mainOutputId = deviceId;
      } else {
        draft.audio = {
          cueOutputId: null,
          mainOutputId: deviceId,
        };
      }
    });
  }
}

/**
 * Set CUE/headphone output device
 */
export function setCueOutputDevice(deviceId: string | null): void {
  const existing = getSettings();
  if (existing) {
    settingsCollection.update(SETTINGS_ID, (draft) => {
      if (draft.audio) {
        draft.audio.cueOutputId = deviceId;
      } else {
        draft.audio = {
          cueOutputId: deviceId,
          mainOutputId: "default",
        };
      }
    });
  }
}

/**
 * Set main output delay (0-500ms)
 */
export function setMainDelayMs(delayMs: number): void {
  const existing = getSettings();
  if (existing) {
    settingsCollection.update(SETTINGS_ID, (draft) => {
      if (draft.audio) {
        if (draft.audio.delay) {
          draft.audio.delay.mainDelayMs = delayMs;
        } else {
          draft.audio.delay = { cueDelayMs: 0, mainDelayMs: delayMs };
        }
      } else {
        draft.audio = {
          cueOutputId: null,
          delay: { cueDelayMs: 0, mainDelayMs: delayMs },
          mainOutputId: "default",
        };
      }
    });
  }
}

/**
 * Set CUE output delay (0-500ms)
 */
export function setCueDelayMs(delayMs: number): void {
  const existing = getSettings();
  if (existing) {
    settingsCollection.update(SETTINGS_ID, (draft) => {
      if (draft.audio) {
        if (draft.audio.delay) {
          draft.audio.delay.cueDelayMs = delayMs;
        } else {
          draft.audio.delay = { cueDelayMs: delayMs, mainDelayMs: 0 };
        }
      } else {
        draft.audio = {
          cueOutputId: null,
          delay: { cueDelayMs: delayMs, mainDelayMs: 0 },
          mainOutputId: "default",
        };
      }
    });
  }
}

// ============================================
// Input Deck Settings
// ============================================

export type InputDeckSettings = z.infer<typeof inputDeckSettingsSchema>;

const defaultInputDeckSettings: InputDeckSettings = {
  channelFilter: 0,
  collapsed: true,
  deviceId: null,
  effectsDryWet: 1,
  goLiveOnStart: false,
  pan: 0,
  volume: 1,
};

/**
 * Get input deck settings with defaults
 */
export function getInputDeckSettings(): InputDeckSettings {
  const settings = getSettings();
  return settings?.audio?.inputDeck ?? defaultInputDeckSettings;
}

/**
 * Update input deck settings
 */
export function updateInputDeckSettings(
  updater: (settings: InputDeckSettings) => Partial<InputDeckSettings>
): void {
  const existing = getSettings();
  if (existing) {
    settingsCollection.update(SETTINGS_ID, (draft) => {
      const currentSettings =
        draft.audio?.inputDeck ?? defaultInputDeckSettings;
      const updates = updater(currentSettings);

      if (draft.audio) {
        draft.audio.inputDeck = { ...currentSettings, ...updates };
      } else {
        draft.audio = {
          cueOutputId: null,
          inputDeck: { ...currentSettings, ...updates },
          mainOutputId: "default",
        };
      }
    });
  }
}

/**
 * Set input deck device ID
 */
export function setInputDeckDeviceId(deviceId: string | null): void {
  updateInputDeckSettings(() => ({ deviceId }));
}

/**
 * Set input deck volume
 */
export function setInputDeckVolume(volume: number): void {
  updateInputDeckSettings(() => ({ volume }));
}

/**
 * Set input deck pan
 */
export function setInputDeckPan(pan: number): void {
  updateInputDeckSettings(() => ({ pan }));
}

/**
 * Set input deck channel filter
 */
export function setInputDeckChannelFilter(channelFilter: number): void {
  updateInputDeckSettings(() => ({ channelFilter }));
}

/**
 * Set input deck effects dry/wet
 */
export function setInputDeckEffectsDryWet(effectsDryWet: number): void {
  updateInputDeckSettings(() => ({ effectsDryWet }));
}

/**
 * Set input deck collapsed state
 */
export function setInputDeckCollapsed(collapsed: boolean): void {
  updateInputDeckSettings(() => ({ collapsed }));
}

/**
 * Set input deck go live on start preference
 */
export function setInputDeckGoLiveOnStart(goLiveOnStart: boolean): void {
  updateInputDeckSettings(() => ({ goLiveOnStart }));
}
