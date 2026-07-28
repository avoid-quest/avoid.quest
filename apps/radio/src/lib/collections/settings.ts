import {
  createCollection,
  localStorageCollectionOptions,
} from "@tanstack/react-db";
import { z } from "zod";
import { settings as defaultSettings } from "../const";

const playerModeSchema = z.enum(["multiple", "single", "dj"]);

const singleModeSettingsSchema = z.object({
  transitionDuration: z.number().default(2000),
});

const playerSettingsSchema = z.object({
  mode: playerModeSchema.default("single"),
  restoreStateOnLoad: z.boolean().default(true),
  single: singleModeSettingsSchema.optional(),
});

const delaySettingsSchema = z.object({
  mainDelayMs: z.number().min(0).max(500).default(0),
  cueDelayMs: z.number().min(0).max(500).default(0),
});

const inputDeckSettingsSchema = z.object({
  deviceId: z.string().nullable(),
  volume: z.number().min(0).max(1.585),
  pan: z.number().min(-1).max(1),
  channelFilter: z.number().min(-1).max(1),
  effectsDryWet: z.number().min(0).max(1),
  goLiveOnStart: z.boolean(),
  collapsed: z.boolean(),
});

const audioSettingsSchema = z.object({
  mainOutputId: z.string().default("default"),
  cueOutputId: z.string().nullable().default(null),
  delay: delaySettingsSchema.optional(),
  inputDeck: inputDeckSettingsSchema.optional(),
});

const settingsSchema = z.object({
  id: z.string(),
  player: playerSettingsSchema,
  audio: audioSettingsSchema.optional(),
});

export type SettingsRecord = z.infer<typeof settingsSchema>;

const SETTINGS_ID = "app-settings";

export const settingsCollection = createCollection(
  localStorageCollectionOptions({
    id: "settings",
    startSync: true,
    storageKey: "radio-app-settings",
    getKey: (item) => item.id,
    schema: settingsSchema,
  })
);

/**
 * Initialize settings with defaults if empty
 */
export async function initializeSettings(): Promise<void> {
  // Wait for collection to load from localStorage first
  const existing = await settingsCollection.stateWhenReady();

  if (existing.size === 0) {
    settingsCollection.insert({
      id: SETTINGS_ID,
      player: {
        mode: defaultSettings.player.mode,
        restoreStateOnLoad: defaultSettings.player.restoreStateOnLoad ?? true,
        single: defaultSettings.player.single,
      },
    });
  }
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
 * Update single mode transition duration
 */
export function setSingleModeTransitionDuration(duration: number): void {
  const existing = getSettings();
  if (existing) {
    settingsCollection.update(SETTINGS_ID, (draft) => {
      if (draft.player.single) {
        draft.player.single.transitionDuration = duration;
      } else {
        draft.player.single = { transitionDuration: duration };
      }
    });
  }
}

/**
 * Update full player settings
 */
export function updatePlayerSettings(
  updater: (player: SettingsRecord["player"]) => Partial<{
    mode: "single" | "multiple" | "dj";
    restoreStateOnLoad: boolean;
    single: { transitionDuration: number };
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
      if (updates.single !== undefined) {
        draft.player.single = updates.single;
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
      mainOutputId: "default",
      cueOutputId: null,
      delay: {
        mainDelayMs: 0,
        cueDelayMs: 0,
      },
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
  return audio.delay ?? { mainDelayMs: 0, cueDelayMs: 0 };
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
          mainOutputId: deviceId,
          cueOutputId: null,
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
          mainOutputId: "default",
          cueOutputId: deviceId,
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
          draft.audio.delay = { mainDelayMs: delayMs, cueDelayMs: 0 };
        }
      } else {
        draft.audio = {
          mainOutputId: "default",
          cueOutputId: null,
          delay: { mainDelayMs: delayMs, cueDelayMs: 0 },
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
          draft.audio.delay = { mainDelayMs: 0, cueDelayMs: delayMs };
        }
      } else {
        draft.audio = {
          mainOutputId: "default",
          cueOutputId: null,
          delay: { mainDelayMs: 0, cueDelayMs: delayMs },
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
  deviceId: null,
  volume: 1,
  pan: 0,
  channelFilter: 0,
  effectsDryWet: 1,
  goLiveOnStart: false,
  collapsed: true,
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
          mainOutputId: "default",
          cueOutputId: null,
          inputDeck: { ...currentSettings, ...updates },
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
