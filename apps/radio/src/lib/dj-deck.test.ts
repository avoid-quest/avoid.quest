import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  type AudioState,
  createDefaultEffectConfig,
  type Radio,
} from "@/lib/audio";
import {
  createDefaultChannel,
  getPlaybackChannel,
  playbackSessionsCollection,
  updatePlaybackChannel,
  updatePlaybackSession,
} from "@/lib/collections/playback-sessions";
import {
  clearDjErrorSurface,
  reportDjErrorSurface,
} from "@/lib/dj/dj-error-surface";
import { calculateDjCrossfadeVolumes } from "@/lib/dj-crossfade";
import { getDjError } from "@/lib/stores/dj-runtime-store";
import { getPlaybackChannelRuntime } from "@/lib/stores/playback-runtime-store";
import {
  type ChannelEffects,
  type ChannelEffectsChange,
  type ChannelEffectsRef,
  createChannelEffects,
} from "./channel-effects";
import {
  createDjDeckModule,
  type DjDeckAudioAdapter,
  type DjDeckPlatformAdapter,
} from "./dj-deck";
import {
  BANDCAMP_PLATFORM_ID,
  PLATFORM_ITEMS,
  STATIC_AUDIO_PLATFORM_ID,
} from "./dj-library-sources";
import type { OutputRouting } from "./output-routing";
import type { PlaybackActionContext } from "./playback-action-context";

async function resetPlaybackSessions(): Promise<void> {
  await playbackSessionsCollection.stateWhenReady();
  for (const sessionId of playbackSessionsCollection.state.keys()) {
    playbackSessionsCollection.delete(sessionId);
  }
}

function insertDjSession(): void {
  playbackSessionsCollection.insert({
    activeChannelId: null,
    channels: [
      createDefaultChannel("deck-a", "deck-a", 0),
      createDefaultChannel("deck-b", "deck-b", 1),
    ],
    crossfadePosition: 0.5,
    headphoneVolume: 1,
    id: "dj",
    masterVolume: 1,
    tempo: 120,
  });
}

function createAudioAdapter(): DjDeckAudioAdapter & {
  activeSounds: Set<string>;
  cleanedSounds: string[];
  emit: (soundId: string, state: AudioState) => void;
} {
  const activeSounds = new Set<string>();
  const cleanedSounds: string[] = [];
  const listeners = new Map<string, (state: AudioState) => void>();
  return {
    activate({ onState, soundId }) {
      activeSounds.add(soundId);
      listeners.set(soundId, onState);
      return () => {
        cleanedSounds.push(soundId);
        activeSounds.delete(soundId);
        listeners.delete(soundId);
      };
    },
    activeSounds,
    applyStrip: mock(() => undefined),
    change: mock(() => undefined),
    cleanedSounds,
    emit(soundId, state) {
      listeners.get(soundId)?.(state);
    },
    getCueTap: mock(() => null),
    getDeviceChannelCount: mock(() => null),
    loadFile: mock(() => Promise.reject(new Error("not configured"))),
    refresh: mock(() => Promise.resolve()),
    releaseFileUrl: mock(() => undefined),
    resume: mock(() => Promise.resolve()),
    setDeviceChannelSelection: mock(() => undefined),
    startDevice: mock(() => Promise.resolve()),
    transport: mock(() => Promise.resolve()),
  };
}

function createEffects(): ChannelEffects {
  return {
    bind: mock(() =>
      Promise.resolve({
        desired: {
          dryWet: 1,
          sidechainSoundId: null,
          tempo: 120,
          tree: [],
        },
        runtime: {
          backend: "compatibility" as const,
          ready: true,
          status: "ready" as const,
        },
      })
    ),
    change: mock(() =>
      Promise.resolve({
        desired: {
          dryWet: 1,
          sidechainSoundId: null,
          tempo: 120,
          tree: [],
        },
        runtime: {
          backend: "compatibility" as const,
          ready: true,
          status: "ready" as const,
        },
      })
    ),
    setTempo: mock(() => Promise.resolve([])),
    unbind: mock(() => undefined),
  };
}

function createPersistingEffects(): {
  change: ReturnType<typeof mock>;
  effects: ChannelEffects;
} {
  const implementation = createChannelEffects({
    runtime: {
      reconcile: mock(() =>
        Promise.resolve({
          backend: "compatibility" as const,
          ready: true,
          status: "ready" as const,
        })
      ),
    },
  });
  const change = mock((ref: ChannelEffectsRef, input: ChannelEffectsChange) =>
    implementation.change(ref, input)
  );
  return {
    change,
    effects: { ...implementation, change },
  };
}

function createOutput(): OutputRouting {
  return {
    applySettings: mock(() =>
      Promise.resolve({
        cueActive: false,
        deckCueEnabled: {},
        headphoneVolume: 1,
        settings: {
          cueDelayMs: 0,
          cueOutputId: null,
          mainDelayMs: 0,
          mainOutputId: "default",
        },
        sinkSelectionSupported: true,
      })
    ),
    registerCueDeck: mock(() => ({
      cleanup: mock(() => undefined),
      enabled: false,
      replaceTap: mock(() => undefined),
      setEnabled: mock(() => undefined),
    })),
    releaseCue: mock(() => undefined),
    subscribeErrors: mock(() => () => undefined),
  } as unknown as OutputRouting;
}

function createReportingOutput(): {
  output: OutputRouting;
  reportError: (error: Error) => void;
} {
  let listener: ((error: Error) => void) | null = null;
  return {
    output: {
      ...createOutput(),
      subscribeErrors: mock((next) => {
        listener = next;
        return () => {
          listener = null;
        };
      }),
    } as unknown as OutputRouting,
    reportError(error) {
      listener?.(error);
    },
  };
}

function createPlatform(): DjDeckPlatformAdapter {
  return {
    loadItem: mock(() => Promise.reject(new Error("not configured"))),
    resolveStream: mock(() => Promise.resolve(null)),
  };
}

function createContext(): PlaybackActionContext {
  return {
    audio: {} as PlaybackActionContext["audio"],
    audioEngine: {} as PlaybackActionContext["audioEngine"],
    channels: {} as PlaybackActionContext["channels"],
    getMainOutputRouter: () => null,
    lifecycle: { mainOutputSettingsApplied: true },
    reportError: mock(() => undefined),
    resetAudioManager: mock(() => undefined),
    resumeAudioContext: mock(() => Promise.resolve()),
  };
}

function withDisplayMedia(
  getDisplayMedia: () => Promise<MediaStream>
): () => void {
  const original = globalThis.navigator;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { mediaDevices: { getDisplayMedia } },
  });
  return () =>
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: original,
    });
}

function sharedRadio(): Radio {
  return {
    id: "device-input-left",
    name: "Spotify",
    platformMetadata: {
      capture: "display",
      channelCount: 2,
      channelSelection: { left: 0, right: 1 },
      deviceId: "display",
      deviceLabel: "Spotify",
      itemType: "track",
      platform: "device-input",
      sourceUrl: "https://open.spotify.com/track/abc",
      url: "",
    },
    streamUrl: "",
  };
}

beforeEach(async () => {
  await resetPlaybackSessions();
  insertDjSession();
});

describe("DjDeckModule", () => {
  test("keeps the current generation active when a library item only opens a platform picker", async () => {
    const audio = createAudioAdapter();
    const module = createDjDeckModule({
      audio,
      context: createContext(),
      effects: createEffects(),
      output: createOutput(),
      platform: createPlatform(),
    });
    const deck = module.deck("deck-a");
    const current: Radio = {
      id: "station-1",
      name: "Station 1",
      streamUrl: "https://radio.example/one.mp3",
    };

    await deck.load({ radio: current, type: "radio" });
    const [pendingItem] = PLATFORM_ITEMS;
    if (!pendingItem) {
      throw new Error("Expected a platform picker library item");
    }
    reportDjErrorSurface(
      "Reload the active source",
      "DJ_PLAYBACK_FAILED",
      undefined,
      current,
      "deck-a"
    );
    const result = await deck.load({
      radio: pendingItem,
      type: "library",
    });
    audio.emit("left_station-1:1", {
      error: null,
      hasEnded: false,
      isBuffering: false,
      isLoading: false,
      isPlaying: true,
      volume: 1,
    });

    expect(result).toEqual({ platform: "external", type: "pending-platform" });
    expect(getDjError()).toBe("Reload the active source");
    expect(getPlaybackChannel("dj", "deck-a")?.radio).toEqual(current);
    expect(getPlaybackChannelRuntime("deck-a")).toMatchObject({
      isPlaying: true,
      soundId: "left_station-1:1",
    });

    await deck.load({
      radio: {
        id: "station-2",
        name: "Station 2",
        streamUrl: "https://radio.example/two.mp3",
      },
      type: "radio",
    });
    expect(getPlaybackChannelRuntime("deck-a").soundId).toBe(
      "left_station-2:2"
    );
  });

  test("owns pending platform-source observation and cancellation", async () => {
    const module = createDjDeckModule({
      audio: createAudioAdapter(),
      context: createContext(),
      effects: createEffects(),
      output: createOutput(),
      platform: createPlatform(),
    });
    const [pendingItem] = PLATFORM_ITEMS;
    if (!pendingItem) {
      throw new Error("Expected a platform picker library item");
    }
    const listener = mock(() => undefined);
    const unsubscribe = module.pendingSource.subscribe(listener);

    await module.deck("deck-a").load({
      radio: pendingItem,
      type: "library",
    });

    expect(module.pendingSource.getSnapshot()).toEqual({
      "deck-a": "external",
      "deck-b": null,
    });
    expect(listener).toHaveBeenCalledTimes(1);

    module.pendingSource.cancel("deck-a");

    expect(module.pendingSource.getSnapshot()).toEqual({
      "deck-a": null,
      "deck-b": null,
    });
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    await module.deck("deck-b").load({
      radio: pendingItem,
      type: "library",
    });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test("keeps the active source generation when a replacement is rejected", async () => {
    const audio = createAudioAdapter();
    const module = createDjDeckModule({
      audio,
      context: createContext(),
      effects: createEffects(),
      output: createOutput(),
      platform: createPlatform(),
    });
    const deck = module.deck("deck-a");
    await deck.load({
      radio: {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      },
      type: "radio",
    });
    audio.emit("left_station-1:1", {
      error: null,
      hasEnded: false,
      isBuffering: false,
      isLoading: false,
      isPlaying: true,
      volume: 1,
    });

    await deck.load({
      radio: {
        id: "unsafe",
        name: "Unsafe",
        streamUrl: "https://radio.example/safe.mp3",
      },
      streamUrl: "javascript:alert(1)",
      type: "track-url",
    });
    audio.emit("left_station-1:1", {
      error: null,
      hasEnded: false,
      isBuffering: false,
      isLoading: false,
      isPlaying: false,
      volume: 1,
    });

    expect(getPlaybackChannelRuntime("deck-a")).toMatchObject({
      isPlaying: false,
      soundId: "left_station-1:1",
    });
  });

  test("replaces a Deck source as one persisted and runtime transaction", async () => {
    const audio = createAudioAdapter();
    const module = createDjDeckModule({
      audio,
      context: createContext(),
      effects: createEffects(),
      output: createOutput(),
      platform: createPlatform(),
    });
    const deck = module.deck("deck-a");
    const first: Radio = {
      id: "station-1",
      name: "Station 1",
      streamUrl: "https://radio.example/one.mp3",
    };
    const second: Radio = {
      id: "station-2",
      name: "Station 2",
      streamUrl: "https://radio.example/two.mp3",
    };

    await deck.load({ radio: first, type: "radio" });
    await deck.load({ radio: second, type: "radio" });

    expect(getPlaybackChannel("dj", "deck-a")?.radio).toEqual(second);
    expect(getPlaybackChannelRuntime("deck-a").soundId).toBe(
      "left_station-2:2"
    );
    expect(audio.activeSounds).toEqual(new Set(["left_station-2:2"]));
  });

  test("replaces a loading source when a track is requested", async () => {
    const audio = createAudioAdapter();
    const module = createDjDeckModule({
      audio,
      context: createContext(),
      effects: createEffects(),
      output: createOutput(),
      platform: createPlatform(),
    });
    const deck = module.deck("deck-a");
    await deck.load({
      radio: {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      },
      type: "radio",
    });
    audio.emit("left_station-1:1", {
      error: null,
      hasEnded: false,
      isBuffering: false,
      isLoading: true,
      isPlaying: false,
      volume: 1,
    });

    await deck.load({
      radio: {
        id: "station-2",
        name: "Station 2",
        streamUrl: "https://radio.example/two.mp3",
      },
      streamUrl: "https://radio.example/two.mp3",
      type: "track-url",
    });

    expect(getPlaybackChannel("dj", "deck-a")?.radio?.id).toBe("station-2");
    expect(getPlaybackChannelRuntime("deck-a").soundId).toBe(
      "left_station-2:2"
    );
  });

  test("clears a deactivated source when replacement activation fails", async () => {
    const audio = createAudioAdapter();
    const module = createDjDeckModule({
      audio,
      context: createContext(),
      effects: createEffects(),
      output: createOutput(),
      platform: createPlatform(),
    });
    const deck = module.deck("deck-a");
    const previous: Radio = {
      id: "local-file-left-1",
      name: "Local",
      platformMetadata: {
        displayName: "Local",
        duration: 120,
        fileName: "local.mp3",
        fileSize: 1024,
        itemType: "track",
        mimeType: "audio/mpeg",
        objectUrl: "blob:https://radio.example/local",
        platform: "local-file",
        url: "",
      },
      streamUrl: "blob:https://radio.example/local",
    };

    await deck.load({ radio: previous, type: "radio" });
    audio.activate = mock(() => {
      throw new Error("decoder unavailable");
    });
    await deck.load({
      radio: {
        id: "station-2",
        name: "Station 2",
        streamUrl: "https://radio.example/two.mp3",
      },
      type: "radio",
    });

    expect(getPlaybackChannel("dj", "deck-a")?.radio).toBeNull();
    expect(getPlaybackChannelRuntime("deck-a").soundId).toBeNull();
    expect(audio.activeSounds).toEqual(new Set());
    expect(audio.releaseFileUrl).toHaveBeenCalledWith(previous.streamUrl);
  });

  test("loads a device input and persists its runtime channel shape", async () => {
    const audio = createAudioAdapter();
    audio.getDeviceChannelCount = mock(() => 4);
    const module = createDjDeckModule({
      audio,
      context: createContext(),
      effects: createEffects(),
      output: createOutput(),
      platform: createPlatform(),
    });

    await module.deck("deck-a").load({
      deviceId: "interface-1",
      deviceLabel: "Audio Interface",
      type: "device-input",
    });

    expect(getPlaybackChannel("dj", "deck-a")?.radio).toMatchObject({
      id: "device-input-left",
      name: "Audio Interface",
      platformMetadata: {
        channelCount: 4,
        channelSelection: { left: 0, right: 1 },
        deviceId: "interface-1",
        platform: "device-input",
      },
    });
    expect(audio.startDevice).toHaveBeenCalledWith(
      "left_device-input-left:1",
      "interface-1",
      undefined,
      { left: 0, right: 1 }
    );
    expect(audio.setDeviceChannelSelection).not.toHaveBeenCalled();
  });

  test("seeds a crossfaded input fader before opening capture", async () => {
    updatePlaybackSession("dj", (draft) => {
      draft.crossfadePosition = 1;
    });
    const audio = createAudioAdapter();
    let faderBeforeCapture: unknown = null;
    audio.startDevice = mock(() => {
      faderBeforeCapture = (
        audio.change as ReturnType<typeof mock>
      ).mock.calls.at(-1);
      return Promise.resolve();
    });
    const module = createDjDeckModule({
      audio,
      context: createContext(),
      effects: createEffects(),
      output: createOutput(),
      platform: createPlatform(),
    });
    await module.deck("deck-a").load({
      deviceId: "interface-1",
      deviceLabel: "Interface",
      type: "device-input",
    });
    expect(audio.startDevice).toHaveBeenCalledTimes(1);
    expect(faderBeforeCapture).toEqual([
      "left_device-input-left:1",
      { type: "volume", volume: calculateDjCrossfadeVolumes(1, 1, 1)[0] },
    ]);
  });

  test("ignores a stale device completion after a newer source owns the Deck", async () => {
    const audio = createAudioAdapter();
    let finishFirst: (() => void) | null = null;
    audio.startDevice = mock((_soundId, deviceId) => {
      if (deviceId !== "interface-1") {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        finishFirst = resolve;
      });
    });
    const module = createDjDeckModule({
      audio,
      context: createContext(),
      effects: createEffects(),
      output: createOutput(),
      platform: createPlatform(),
    });
    const deck = module.deck("deck-a");

    const stale = deck.load({
      deviceId: "interface-1",
      deviceLabel: "Old Interface",
      type: "device-input",
    });
    await Promise.resolve();
    await deck.load({
      deviceId: "interface-2",
      deviceLabel: "New Interface",
      type: "device-input",
    });
    (finishFirst as (() => void) | null)?.();
    await stale;

    expect(getPlaybackChannel("dj", "deck-a")?.radio).toMatchObject({
      name: "New Interface",
      platformMetadata: { deviceId: "interface-2" },
    });
    expect(getPlaybackChannelRuntime("deck-a").soundId).toBe(
      "left_device-input-left:2"
    );
  });

  test("cleans a stale same-device resource after its delayed start completes", async () => {
    const audio = createAudioAdapter();
    let finishFirst: (() => void) | null = null;
    let startCount = 0;
    audio.startDevice = mock(() => {
      startCount += 1;
      if (startCount > 1) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        finishFirst = resolve;
      });
    });
    const module = createDjDeckModule({
      audio,
      context: createContext(),
      effects: createEffects(),
      output: createOutput(),
      platform: createPlatform(),
    });
    const deck = module.deck("deck-a");
    const intent = {
      deviceId: "interface-1",
      deviceLabel: "Audio Interface",
      type: "device-input" as const,
    };

    const stale = deck.load(intent);
    await Promise.resolve();
    const staleSoundId = getPlaybackChannelRuntime("deck-a").soundId;
    await deck.load(intent);
    const currentSoundId = getPlaybackChannelRuntime("deck-a").soundId;
    const cleanupsBeforeCompletion = audio.cleanedSounds.filter(
      (soundId) => soundId === staleSoundId
    ).length;
    (finishFirst as (() => void) | null)?.();
    await stale;

    expect(currentSoundId).not.toBe(staleSoundId);
    expect(
      audio.cleanedSounds.filter((soundId) => soundId === staleSoundId).length
    ).toBeGreaterThan(cleanupsBeforeCompletion);
    if (!currentSoundId) {
      throw new Error("Expected the current device resource to remain active");
    }
    expect(audio.activeSounds).toEqual(new Set([currentSoundId]));
  });

  test("restores a shared display source paused without opening the picker", async () => {
    const getDisplayMedia = mock(() =>
      Promise.reject(new Error("Must not open the picker without a gesture"))
    );
    const restoreNavigator = withDisplayMedia(getDisplayMedia);
    try {
      const audio = createAudioAdapter();
      const module = createDjDeckModule({
        audio,
        context: createContext(),
        effects: createEffects(),
        output: createOutput(),
        platform: createPlatform(),
      });
      const shared: Radio = {
        id: "device-input-left",
        name: "Spotify",
        platformMetadata: {
          capture: "display",
          channelCount: 2,
          channelSelection: { left: 0, right: 1 },
          deviceId: "display",
          deviceLabel: "Spotify",
          itemType: "track",
          platform: "device-input",
          sourceUrl: "https://open.spotify.com/track/abc",
          url: "",
        },
        streamUrl: "",
      };

      await module.deck("deck-a").load({ radio: shared, type: "radio" });

      expect(getDisplayMedia).not.toHaveBeenCalled();
      expect(audio.startDevice).not.toHaveBeenCalled();
      expect(getPlaybackChannel("dj", "deck-a")?.radio).toEqual(shared);
      expect(getPlaybackChannelRuntime("deck-a").soundId).toBe(
        "left_device-input-left:1"
      );
    } finally {
      restoreNavigator();
    }
  });

  test("keeps the current source when the display picker is cancelled", async () => {
    const restoreNavigator = withDisplayMedia(() =>
      Promise.reject(new DOMException("Cancelled", "NotAllowedError"))
    );
    try {
      const audio = createAudioAdapter();
      const module = createDjDeckModule({
        audio,
        context: createContext(),
        effects: createEffects(),
        output: createOutput(),
        platform: createPlatform(),
      });
      const deck = module.deck("deck-a");
      const station: Radio = {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      };
      await deck.load({ radio: station, type: "radio" });

      await expect(
        deck.load({
          capture: "display",
          deviceId: "display",
          deviceLabel: "Spotify",
          sourceUrl: "https://open.spotify.com/track/abc",
          type: "device-input",
        })
      ).rejects.toThrow("Sharing was cancelled");

      expect(getPlaybackChannel("dj", "deck-a")?.radio).toEqual(station);
      expect(getPlaybackChannelRuntime("deck-a").soundId).toBe(
        "left_station-1:1"
      );
      expect(audio.activeSounds).toEqual(new Set(["left_station-1:1"]));
      expect(audio.startDevice).not.toHaveBeenCalled();
    } finally {
      restoreNavigator();
    }
  });

  test.each([
    ["a cancelled picker reports nothing", "NotAllowedError", null],
    [
      "a missing tab-audio API reports its own advice",
      null,
      "Tab audio sharing is unavailable. Use desktop Chrome or Edge, or an audio input device.",
    ],
  ] as const)(
    "Go live on a restored share: %s",
    async (_name, domError, message) => {
      const restoreNavigator =
        domError === null
          ? (() => {
              const original = globalThis.navigator;
              Object.defineProperty(globalThis, "navigator", {
                configurable: true,
                value: { mediaDevices: {} },
              });
              return () =>
                Object.defineProperty(globalThis, "navigator", {
                  configurable: true,
                  value: original,
                });
            })()
          : withDisplayMedia(() =>
              Promise.reject(new DOMException("Permission denied", domError))
            );
      try {
        const context = createContext();
        const module = createDjDeckModule({
          audio: createAudioAdapter(),
          context,
          effects: createEffects(),
          output: createOutput(),
          platform: createPlatform(),
        });
        const deck = module.deck("deck-a");
        await deck.load({ radio: sharedRadio(), type: "radio" });

        await deck.transport({ type: "play" });

        if (message === null) {
          expect(context.reportError).not.toHaveBeenCalled();
        } else {
          expect(context.reportError).toHaveBeenCalledWith(
            expect.objectContaining({ userMessage: message })
          );
        }
      } finally {
        restoreNavigator();
      }
    }
  );

  test("retains every folder track across track changes and releases the folder on replacement", async () => {
    const audio = createAudioAdapter();
    audio.loadFile = mock((file) =>
      Promise.resolve({
        displayName: file.name,
        duration: 10,
        fileName: file.name,
        fileSize: file.size,
        mimeType: "audio/mpeg",
        objectUrl: `blob:https://radio.example/${file.name}`,
      })
    );
    const module = createDjDeckModule({
      audio,
      context: createContext(),
      effects: createEffects(),
      output: createOutput(),
      platform: createPlatform(),
    });
    const deck = module.deck("deck-a");
    await deck.load({
      files: [new File(["audio"], "2.mp3"), new File(["audio"], "1.mp3")],
      type: "files",
    });
    const channel = getPlaybackChannel("dj", "deck-a");
    expect(channel?.autoplay).toBe(true);
    expect(channel?.radio?.platformMetadata?.platform).toBe("static-audio");
    const radio = channel?.radio as Radio;
    await deck.load({
      radio,
      streamUrl: "blob:https://radio.example/2.mp3",
      type: "track-url",
    });
    expect(audio.releaseFileUrl).not.toHaveBeenCalled();
    await deck.load({
      radio: { name: "Station", streamUrl: "https://radio.example/live" },
      type: "radio",
    });
    expect(audio.releaseFileUrl).toHaveBeenCalledWith(
      "blob:https://radio.example/1.mp3"
    );
    expect(audio.releaseFileUrl).toHaveBeenCalledWith(
      "blob:https://radio.example/2.mp3"
    );
  });

  test("tells the file form when a parsed folder fails to activate", async () => {
    const audio = createAudioAdapter();
    audio.loadFile = mock((file) =>
      Promise.resolve({
        displayName: file.name,
        duration: 10,
        fileName: file.name,
        fileSize: file.size,
        mimeType: "audio/mpeg",
        objectUrl: `blob:https://radio.example/${file.name}`,
      })
    );
    audio.activate = mock(() => {
      throw new Error("decoder unavailable");
    });
    const module = createDjDeckModule({
      audio,
      context: createContext(),
      effects: createEffects(),
      output: createOutput(),
      platform: createPlatform(),
    });

    const result = await module.deck("deck-a").load({
      files: [new File(["audio"], "1.mp3"), new File(["audio"], "2.mp3")],
      type: "files",
    });

    expect(result).toEqual({
      message: "the deck couldn't play it",
      type: "failed",
    });
    expect(getPlaybackChannel("dj", "deck-a")?.radio).toBeNull();
    expect(audio.releaseFileUrl).toHaveBeenCalledWith(
      "blob:https://radio.example/1.mp3"
    );
    expect(audio.releaseFileUrl).toHaveBeenCalledWith(
      "blob:https://radio.example/2.mp3"
    );
  });

  test("keeps a file URL until a replacement source commits", async () => {
    const audio = createAudioAdapter();
    audio.loadFile = mock(() =>
      Promise.resolve({
        displayName: "Local",
        duration: 120,
        fileName: "local.mp3",
        fileSize: 1024,
        mimeType: "audio/mpeg",
        objectUrl: "blob:https://radio.example/local",
      })
    );
    const module = createDjDeckModule({
      audio,
      context: createContext(),
      effects: createEffects(),
      output: createOutput(),
      platform: createPlatform(),
    });
    const deck = module.deck("deck-a");

    await deck.load({
      file: new File(["audio"], "local.mp3", { type: "audio/mpeg" }),
      type: "file",
    });
    expect(audio.releaseFileUrl).not.toHaveBeenCalled();

    await deck.load({
      radio: {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      },
      type: "radio",
    });

    expect(audio.releaseFileUrl).toHaveBeenCalledTimes(1);
    expect(audio.releaseFileUrl).toHaveBeenCalledWith(
      "blob:https://radio.example/local"
    );
  });

  test("tells the file form when a parsed file fails to activate", async () => {
    const audio = createAudioAdapter();
    audio.loadFile = mock(() =>
      Promise.resolve({
        displayName: "Local",
        duration: 120,
        fileName: "local.mp3",
        fileSize: 1024,
        mimeType: "audio/mpeg",
        objectUrl: "blob:https://radio.example/local",
      })
    );
    audio.activate = mock(() => {
      throw new Error("decoder unavailable");
    });
    const module = createDjDeckModule({
      audio,
      context: createContext(),
      effects: createEffects(),
      output: createOutput(),
      platform: createPlatform(),
    });

    const result = await module.deck("deck-a").load({
      file: new File(["audio"], "local.mp3", { type: "audio/mpeg" }),
      type: "file",
    });

    expect(result).toEqual({
      message: "the deck couldn't play it",
      type: "failed",
    });
    expect(getPlaybackChannel("dj", "deck-a")?.radio).toBeNull();
    expect(audio.releaseFileUrl).toHaveBeenCalledWith(
      "blob:https://radio.example/local"
    );
  });

  test("keeps a resolved remote URL paused when replacing a playing source", async () => {
    const audio = createAudioAdapter();
    const platform = createPlatform();
    platform.loadItem = mock(() =>
      Promise.resolve({
        radio: {
          id: "remote-1",
          name: "Remote file",
          streamUrl: "https://radio.example/remote.mp3",
        },
        success: true as const,
      })
    );
    const module = createDjDeckModule({
      audio,
      context: createContext(),
      effects: createEffects(),
      output: createOutput(),
      platform,
    });
    const deck = module.deck("deck-a");
    await deck.load({
      radio: {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      },
      type: "radio",
    });
    audio.emit("left_station-1:1", {
      error: null,
      hasEnded: false,
      isBuffering: false,
      isLoading: false,
      isPlaying: true,
      volume: 1,
    });

    await deck.load({
      type: "static-audio-url",
      url: "https://radio.example/remote.mp3",
    });

    expect(getPlaybackChannel("dj", "deck-a")?.radio?.id).toBe("remote-1");
    expect(audio.transport).not.toHaveBeenCalledWith(
      "left_remote-1:2",
      expect.objectContaining({ type: "play" })
    );
  });

  test("rejects unsafe track streams before activating browser audio", async () => {
    const audio = createAudioAdapter();
    const module = createDjDeckModule({
      audio,
      context: createContext(),
      effects: createEffects(),
      output: createOutput(),
      platform: createPlatform(),
    });

    await module.deck("deck-a").load({
      radio: {
        id: "unsafe",
        name: "Unsafe",
        streamUrl: "https://radio.example/safe.mp3",
      },
      streamUrl: "javascript:alert(1)",
      type: "track-url",
    });

    expect(audio.activeSounds).toEqual(new Set());
    expect(getPlaybackChannel("dj", "deck-a")?.radio).toBeNull();
  });

  test("restores the channel strip, Effects, and CUE from persisted state", async () => {
    const audio = createAudioAdapter();
    const effects = createEffects();
    const output = createOutput();
    const tap = {} as AudioNode;
    audio.getCueTap = mock(() => tap);
    updatePlaybackChannel("dj", "deck-a", (draft) => {
      draft.muted = true;
      draft.cueEnabled = true;
    });
    const module = createDjDeckModule({
      audio,
      context: createContext(),
      effects,
      output,
      platform: createPlatform(),
    });
    await module.deck("deck-a").load({
      radio: {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      },
      type: "radio",
    });

    audio.emit("left_station-1:1", {
      error: null,
      hasEnded: false,
      isBuffering: false,
      isLoading: false,
      isPlaying: true,
      volume: 1,
    });
    await Promise.resolve();

    expect(effects.bind).toHaveBeenCalledWith(
      { channelId: "deck-a", sessionId: "dj" },
      "left_station-1:1"
    );
    expect(audio.applyStrip).toHaveBeenCalledWith(
      "left_station-1:1",
      expect.objectContaining({ cueEnabled: true, muted: true })
    );
    expect(output.registerCueDeck).toHaveBeenCalledWith("deck-a", tap, true);
  });

  test("reports a saved CUE output that cannot be restored", async () => {
    const audio = createAudioAdapter();
    const output = createOutput();
    output.applySettings = mock(() =>
      Promise.reject(new Error("Saved CUE output unavailable"))
    );
    const module = createDjDeckModule({
      audio,
      context: createContext(),
      effects: createEffects(),
      output,
      platform: createPlatform(),
    });
    await module.deck("deck-a").load({
      radio: {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      },
      type: "radio",
    });

    audio.emit("left_station-1:1", {
      error: null,
      hasEnded: false,
      isBuffering: false,
      isLoading: false,
      isPlaying: true,
      volume: 1,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(getDjError()).toBe("Saved CUE output unavailable");
  });

  test("reports output routing failures while a Deck is active", async () => {
    const routing = createReportingOutput();
    const module = createDjDeckModule({
      audio: createAudioAdapter(),
      context: createContext(),
      effects: createEffects(),
      output: routing.output,
      platform: createPlatform(),
    });

    await module.deck("deck-a").load({
      radio: {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      },
      type: "radio",
    });
    routing.reportError(new Error("Output graph replacement failed"));

    expect(getDjError()).toBe("Output graph replacement failed");
  });

  test("persists channel changes and reconciles the Effects tree", async () => {
    const audio = createAudioAdapter();
    const effects = createEffects();
    const module = createDjDeckModule({
      audio,
      context: createContext(),
      effects,
      output: createOutput(),
      platform: createPlatform(),
    });
    const deck = module.deck("deck-a");
    await deck.load({
      radio: {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      },
      type: "radio",
    });

    deck.change({ pan: 0.25, type: "pan" });
    deck.change({ type: "effects-dry-wet", value: 0.4 });
    await Promise.resolve();

    expect(getPlaybackChannel("dj", "deck-a")?.pan).toBe(0.25);
    expect(audio.change).toHaveBeenCalledWith("left_station-1:1", {
      pan: 0.25,
      type: "pan",
    });
    expect(effects.change).toHaveBeenCalledWith(
      { channelId: "deck-a", sessionId: "dj" },
      { type: "set-dry-wet", value: 0.4 }
    );
  });

  test("resets persisted controls and Effects through the Deck interface", async () => {
    const audio = createAudioAdapter();
    const { change, effects } = createPersistingEffects();
    const module = createDjDeckModule({
      audio,
      context: createContext(),
      effects,
      output: createOutput(),
      platform: createPlatform(),
    });
    const deck = module.deck("deck-a");
    const radio: Radio = {
      id: "station-1",
      name: "Station 1",
      streamUrl: "https://radio.example/one.mp3",
    };
    await deck.load({ radio, type: "radio" });
    updatePlaybackChannel("dj", "deck-a", (draft) => {
      draft.volume = 0.4;
      draft.muted = true;
      draft.pan = 0.25;
      draft.speed = 1.2;
      draft.channelFilter = 0.5;
      draft.effects = [createDefaultEffectConfig("delay", "delay-1", 0)];
      draft.effectsDryWet = 0.3;
    });

    await deck.transport({ type: "reset" });

    expect(getPlaybackChannel("dj", "deck-a")).toMatchObject({
      channelFilter: 0,
      effects: [],
      effectsDryWet: 1,
      muted: false,
      pan: 0,
      radio,
      speed: 1,
      volume: 1,
    });
    expect(change).toHaveBeenCalledWith(
      { channelId: "deck-a", sessionId: "dj" },
      { tree: [], type: "replace" }
    );
    expect(change).toHaveBeenCalledWith(
      { channelId: "deck-a", sessionId: "dj" },
      { type: "set-dry-wet", value: 1 }
    );
    expect(getPlaybackChannelRuntime("deck-a").soundId).toBe(
      "left_station-1:2"
    );
    expect(audio.activeSounds).toEqual(new Set(["left_station-1:2"]));
  });

  test("Reset on a shared tab keeps the share and resets its strip in place", async () => {
    const stream = {
      getAudioTracks: () => [{ readyState: "live" }],
      getTracks: () => [],
    } as unknown as MediaStream;
    const getDisplayMedia = mock(() => Promise.resolve(stream));
    const restoreNavigator = withDisplayMedia(getDisplayMedia);
    try {
      const audio = createAudioAdapter();
      const { change, effects } = createPersistingEffects();
      const module = createDjDeckModule({
        audio,
        context: createContext(),
        effects,
        output: createOutput(),
        platform: createPlatform(),
      });
      const deck = module.deck("deck-a");
      await deck.load({
        capture: "display",
        deviceId: "display",
        deviceLabel: "Spotify",
        sourceUrl: "https://open.spotify.com/track/abc",
        type: "device-input",
      });
      const { soundId } = getPlaybackChannelRuntime("deck-a");
      updatePlaybackChannel("dj", "deck-a", (draft) => {
        draft.muted = true;
        draft.pan = 0.25;
        draft.volume = 0.4;
      });

      await deck.transport({ type: "reset" });

      expect(getDisplayMedia).toHaveBeenCalledTimes(1);
      expect(audio.startDevice).toHaveBeenCalledTimes(1);
      expect(getPlaybackChannelRuntime("deck-a").soundId).toBe(soundId);
      expect(audio.activeSounds).toEqual(new Set([soundId as string]));
      expect(getPlaybackChannel("dj", "deck-a")).toMatchObject({
        muted: false,
        pan: 0,
        radio: { platformMetadata: { capture: "display" } },
        volume: 1,
      });
      expect(audio.change).toHaveBeenCalledWith(soundId, {
        muted: false,
        type: "mute",
      });
      expect(audio.change).toHaveBeenCalledWith(soundId, {
        pan: 0,
        type: "pan",
      });
      expect(change).toHaveBeenCalledWith(
        { channelId: "deck-a", sessionId: "dj" },
        { tree: [], type: "replace" }
      );
    } finally {
      restoreNavigator();
    }
  });

  test("persists both Effects resets before yielding to a newer change", async () => {
    const effects = createEffects();
    const { change } = effects;
    const firstReset = Promise.withResolvers<void>();
    const changes: ChannelEffectsChange[] = [];
    effects.change = mock((ref, input) => {
      changes.push(input);
      if (input.type === "replace") {
        return firstReset.promise.then(() => change(ref, input));
      }
      return change(ref, input);
    });
    const module = createDjDeckModule({
      audio: createAudioAdapter(),
      context: createContext(),
      effects,
      output: createOutput(),
      platform: createPlatform(),
    });
    const deck = module.deck("deck-a");
    await deck.load({
      radio: {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      },
      type: "radio",
    });

    const reset = deck.transport({ type: "reset" });
    deck.change({ type: "effects-dry-wet", value: 0.4 });
    try {
      expect(changes).toEqual([
        { tree: [], type: "replace" },
        { type: "set-dry-wet", value: 1 },
        { type: "set-dry-wet", value: 0.4 },
      ]);
    } finally {
      firstReset.resolve();
    }
    await reset;
  });

  test("does not let a pending reset replace a newer source", async () => {
    const audio = createAudioAdapter();
    const { effects } = createPersistingEffects();
    const { change } = effects;
    let releaseReset: (() => void) | null = null;
    const resetGate = new Promise<void>((resolve) => {
      releaseReset = resolve;
    });
    effects.change = mock(async (ref, input) => {
      if (input.type === "replace") {
        await resetGate;
      }
      return await change(ref, input);
    });
    const module = createDjDeckModule({
      audio,
      context: createContext(),
      effects,
      output: createOutput(),
      platform: createPlatform(),
    });
    const deck = module.deck("deck-a");
    await deck.load({
      radio: {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      },
      type: "radio",
    });

    const reset = deck.transport({ type: "reset" });
    await Promise.resolve();
    await deck.load({
      radio: {
        id: "station-2",
        name: "Station 2",
        streamUrl: "https://radio.example/two.mp3",
      },
      type: "radio",
    });
    (releaseReset as (() => void) | null)?.();
    await reset;

    expect(getPlaybackChannel("dj", "deck-a")?.radio?.id).toBe("station-2");
    expect(getPlaybackChannelRuntime("deck-a").soundId).toBe(
      "left_station-2:2"
    );
  });

  test("ejecting a Deck source keeps its effects and channel settings", async () => {
    const audio = createAudioAdapter();
    const { change, effects } = createPersistingEffects();
    const module = createDjDeckModule({
      audio,
      context: createContext(),
      effects,
      output: createOutput(),
      platform: createPlatform(),
    });
    const deck = module.deck("deck-a");
    await deck.load({
      radio: {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      },
      type: "radio",
    });
    updatePlaybackChannel("dj", "deck-a", (draft) => {
      draft.effects = [createDefaultEffectConfig("delay", "delay-1", 0)];
      draft.effectsDryWet = 0.3;
    });

    await deck.load({ radio: null, type: "radio" });

    expect(getPlaybackChannel("dj", "deck-a")).toMatchObject({
      effects: [expect.objectContaining({ id: "delay-1" })],
      effectsDryWet: 0.3,
      radio: null,
    });
    expect(change).not.toHaveBeenCalledWith(
      { channelId: "deck-a", sessionId: "dj" },
      { tree: [], type: "replace" }
    );
    expect(getPlaybackChannelRuntime("deck-a").soundId).toBeNull();
    expect(audio.activeSounds).toEqual(new Set());
  });

  test("supersedes a pending play when a newer source owns the Deck", async () => {
    const audio = createAudioAdapter();
    let resume: (() => void) | null = null;
    audio.resume = mock(
      () =>
        new Promise<void>((resolve) => {
          resume = resolve;
        })
    );
    const module = createDjDeckModule({
      audio,
      context: createContext(),
      effects: createEffects(),
      output: createOutput(),
      platform: createPlatform(),
    });
    const deck = module.deck("deck-a");
    await deck.load({
      radio: {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      },
      type: "radio",
    });

    const stalePlay = deck.transport({ type: "play" });
    await Promise.resolve();
    await deck.load({
      radio: {
        id: "station-2",
        name: "Station 2",
        streamUrl: "https://radio.example/two.mp3",
      },
      type: "radio",
    });
    (resume as (() => void) | null)?.();
    await stalePlay;

    expect(audio.transport).not.toHaveBeenCalledWith(
      "left_station-1:1",
      expect.objectContaining({ type: "play" })
    );
  });

  test("repeats an ended Deck without reconstructing its source", async () => {
    const audio = createAudioAdapter();
    const module = createDjDeckModule({
      audio,
      context: createContext(),
      effects: createEffects(),
      output: createOutput(),
      platform: createPlatform(),
    });
    const deck = module.deck("deck-a");
    await deck.load({
      radio: {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      },
      type: "radio",
    });
    deck.change({ enabled: true, type: "repeat" });

    audio.emit("left_station-1:1", {
      error: null,
      hasEnded: true,
      isBuffering: false,
      isLoading: false,
      isPlaying: false,
      volume: 1,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(audio.transport).toHaveBeenCalledWith("left_station-1:1", {
      position: 0,
      type: "seek",
    });
    expect(audio.transport).toHaveBeenCalledWith("left_station-1:1", {
      type: "play",
      volume: calculateDjCrossfadeVolumes(0.5, 1, 1)[0],
    });
    expect(audio.activeSounds).toEqual(new Set(["left_station-1:1"]));
  });

  test("does not continue a repeated source after a replacement wins during seek", async () => {
    const audio = createAudioAdapter();
    let finishSeek: (() => void) | null = null;
    audio.transport = mock((_soundId, intent) => {
      if (intent.type !== "seek") {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        finishSeek = resolve;
      });
    });
    const module = createDjDeckModule({
      audio,
      context: createContext(),
      effects: createEffects(),
      output: createOutput(),
      platform: createPlatform(),
    });
    const deck = module.deck("deck-a");
    await deck.load({
      radio: {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      },
      type: "radio",
    });
    deck.change({ enabled: true, type: "repeat" });
    audio.emit("left_station-1:1", {
      error: null,
      hasEnded: true,
      isBuffering: false,
      isLoading: false,
      isPlaying: false,
      volume: 1,
    });
    await Promise.resolve();

    await deck.load({
      radio: {
        id: "station-2",
        name: "Station 2",
        streamUrl: "https://radio.example/two.mp3",
      },
      type: "radio",
    });
    (finishSeek as (() => void) | null)?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(getPlaybackChannel("dj", "deck-a")?.radio?.id).toBe("station-2");
    expect(audio.transport).not.toHaveBeenCalledWith("left_station-1:1", {
      type: "play",
      volume: 1,
    });
  });

  test("suppresses a stale repeat play rejection after a replacement owns the Deck", async () => {
    const audio = createAudioAdapter();
    const context = createContext();
    let rejectPlay: ((error: Error) => void) | null = null;
    audio.transport = mock((_soundId, intent) => {
      if (intent.type !== "play") {
        return Promise.resolve();
      }
      return new Promise<void>((_resolve, reject) => {
        rejectPlay = reject;
      });
    });
    const module = createDjDeckModule({
      audio,
      context,
      effects: createEffects(),
      output: createOutput(),
      platform: createPlatform(),
    });
    const deck = module.deck("deck-a");
    await deck.load({
      radio: {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      },
      type: "radio",
    });
    deck.change({ enabled: true, type: "repeat" });
    audio.emit("left_station-1:1", {
      error: null,
      hasEnded: true,
      isBuffering: false,
      isLoading: false,
      isPlaying: false,
      volume: 1,
    });
    await Promise.resolve();

    await deck.load({
      radio: {
        id: "station-2",
        name: "Station 2",
        streamUrl: "https://radio.example/two.mp3",
      },
      type: "radio",
    });
    (rejectPlay as ((error: Error) => void) | null)?.(
      new Error("stale play failed")
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(context.reportError).not.toHaveBeenCalled();
    expect(getPlaybackChannelRuntime("deck-a")).toMatchObject({
      error: null,
      soundId: "left_station-2:2",
    });
  });

  test("continues a YouTube playlist without restarting after lazy resolution", async () => {
    const audio = createAudioAdapter();
    const platform = createPlatform();
    platform.resolveStream = mock(() =>
      Promise.resolve({
        streamFormat: "progressive" as const,
        streamUrl: "https://radio.example/second.mp3",
      })
    );
    const module = createDjDeckModule({
      audio,
      context: createContext(),
      effects: createEffects(),
      output: createOutput(),
      platform,
    });
    const radio: Radio = {
      id: "playlist-1",
      name: "Playlist",
      platformMetadata: {
        itemType: "playlist",
        platform: "youtube",
        tracks: [
          {
            name: "First",
            streamUrl: "https://radio.example/first.mp3",
            videoId: "first",
          },
          { name: "Second", streamUrl: "", videoId: "second" },
        ],
        url: "https://youtube.com/playlist?list=playlist-1",
      },
      streamUrl: "https://radio.example/first.mp3",
    };
    await module.deck("deck-a").load({ radio, type: "radio" });

    audio.emit("left_playlist-1:1", {
      error: null,
      hasEnded: true,
      isBuffering: false,
      isLoading: false,
      isPlaying: false,
      volume: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const continuedSound = getPlaybackChannelRuntime("deck-a").soundId;
    audio.emit(continuedSound ?? "", {
      error: null,
      hasEnded: true,
      isBuffering: false,
      isLoading: false,
      isPlaying: false,
      volume: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getPlaybackChannel("dj", "deck-a")?.radio?.streamUrl).toBe(
      "https://radio.example/second.mp3"
    );
    expect(platform.resolveStream).toHaveBeenCalledTimes(1);
  });

  test("refreshes an interrupted provider stream only for its owning generation", async () => {
    const audio = createAudioAdapter();
    const platform = createPlatform();
    platform.resolveStream = mock(() =>
      Promise.resolve({
        streamFormat: "progressive" as const,
        streamUrl: "https://radio.example/refreshed.mp3",
      })
    );
    const module = createDjDeckModule({
      audio,
      context: createContext(),
      effects: createEffects(),
      output: createOutput(),
      platform,
    });
    await module.deck("deck-a").load({
      radio: {
        id: "yt-1",
        name: "YouTube",
        platformMetadata: {
          itemType: "video",
          platform: "youtube",
          url: "https://youtube.com/watch?v=abc",
          videoId: "abc",
        },
        streamUrl: "https://radio.example/old.mp3",
      },
      type: "radio",
    });

    audio.emit("left_yt-1:1", {
      error: {
        code: "STREAM_INTERRUPTED",
        id: "error-1",
        message: "expired",
        position: 42,
        timestamp: Date.now(),
      },
      hasEnded: false,
      isBuffering: false,
      isLoading: false,
      isPlaying: false,
      volume: 1,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(audio.refresh).toHaveBeenCalledWith(
      "left_yt-1:1",
      "https://radio.example/refreshed.mp3",
      42,
      "progressive"
    );
    expect(getPlaybackChannelRuntime("deck-a").error).toBeNull();
  });

  test("preserves browser audio error codes when reporting state failures", async () => {
    const audio = createAudioAdapter();
    const context = createContext();
    const module = createDjDeckModule({
      audio,
      context,
      effects: createEffects(),
      output: createOutput(),
      platform: createPlatform(),
    });
    await module.deck("deck-a").load({
      radio: {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      },
      type: "radio",
    });

    audio.emit("left_station-1:1", {
      error: {
        code: "STREAM_DECODE_FAILED",
        id: "error-1",
        message: "decoder failed",
        timestamp: Date.now(),
      },
      hasEnded: false,
      isBuffering: false,
      isLoading: false,
      isPlaying: false,
      volume: 1,
    });

    expect(context.reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "STREAM_DECODE_FAILED",
        mode: "dj",
      })
    );
  });

  test("reports an interrupted provider stream that cannot be resolved", async () => {
    const audio = createAudioAdapter();
    const module = createDjDeckModule({
      audio,
      context: createContext(),
      effects: createEffects(),
      output: createOutput(),
      platform: createPlatform(),
    });
    await module.deck("deck-a").load({
      radio: {
        id: "yt-1",
        name: "YouTube",
        platformMetadata: {
          itemType: "video",
          platform: "youtube",
          url: "https://youtube.com/watch?v=abc",
          videoId: "abc",
        },
        streamUrl: "https://radio.example/old.mp3",
      },
      type: "radio",
    });

    audio.emit("left_yt-1:1", {
      error: {
        code: "STREAM_INTERRUPTED",
        id: "error-1",
        message: "expired",
        position: 42,
        timestamp: Date.now(),
      },
      hasEnded: false,
      isBuffering: false,
      isLoading: false,
      isPlaying: false,
      volume: 1,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(getDjError()).toBe(
      "Failed to refresh YouTube stream - please reload"
    );
  });

  test("deactivation releases Deck bindings, CUE, Effects, and file URLs", async () => {
    const audio = createAudioAdapter();
    audio.loadFile = mock(() =>
      Promise.resolve({
        displayName: "Local",
        duration: 120,
        fileName: "local.mp3",
        fileSize: 1024,
        mimeType: "audio/mpeg",
        objectUrl: "blob:https://radio.example/local",
      })
    );
    const effects = createEffects();
    const output = createOutput();
    const module = createDjDeckModule({
      audio,
      context: createContext(),
      effects,
      output,
      platform: createPlatform(),
    });
    await module.deck("deck-a").load({
      file: new File(["audio"], "local.mp3", { type: "audio/mpeg" }),
      type: "file",
    });

    module.deactivate();

    expect(audio.activeSounds).toEqual(new Set());
    expect(effects.unbind).toHaveBeenCalledWith({
      channelId: "deck-a",
      sessionId: "dj",
    });
    expect(output.releaseCue).toHaveBeenCalledTimes(1);
    expect(getPlaybackChannelRuntime("deck-a").soundId).toBeNull();
    expect(audio.releaseFileUrl).toHaveBeenCalledTimes(1);
    expect(audio.releaseFileUrl).toHaveBeenCalledWith(
      "blob:https://radio.example/local"
    );

    module.deactivate();
    expect(audio.releaseFileUrl).toHaveBeenCalledTimes(1);
  });

  test("replaces the registered CUE tap when a new source becomes playable", async () => {
    const audio = createAudioAdapter();
    const output = createOutput();
    const replaceTap = mock(() => undefined);
    const registration = {
      cleanup: mock(() => undefined),
      enabled: true,
      replaceTap,
      setEnabled: mock(() => undefined),
    };
    output.registerCueDeck = mock(() => registration);
    const firstTap = { id: "first" } as unknown as AudioNode;
    const secondTap = { id: "second" } as unknown as AudioNode;
    audio.getCueTap = mock((soundId) =>
      soundId === "left_station-1:1" ? firstTap : secondTap
    );
    const module = createDjDeckModule({
      audio,
      context: createContext(),
      effects: createEffects(),
      output,
      platform: createPlatform(),
    });
    const deck = module.deck("deck-a");
    await deck.load({
      radio: {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      },
      type: "radio",
    });
    audio.emit("left_station-1:1", {
      error: null,
      hasEnded: false,
      isBuffering: false,
      isLoading: false,
      isPlaying: true,
      volume: 1,
    });
    await deck.load({
      radio: {
        id: "station-2",
        name: "Station 2",
        streamUrl: "https://radio.example/two.mp3",
      },
      type: "radio",
    });
    audio.emit("left_station-2:2", {
      error: null,
      hasEnded: false,
      isBuffering: false,
      isLoading: false,
      isPlaying: true,
      volume: 1,
    });

    expect(output.registerCueDeck).toHaveBeenCalledTimes(1);
    expect(replaceTap).toHaveBeenCalledWith(null);
    expect(replaceTap).toHaveBeenCalledWith(secondTap);
  });

  test("reports a user-safe error when browser playback fails", async () => {
    const audio = createAudioAdapter();
    const context = createContext();
    audio.resume = mock(() =>
      Promise.reject(new Error("decoder internals 73"))
    );
    const module = createDjDeckModule({
      audio,
      context,
      effects: createEffects(),
      output: createOutput(),
      platform: createPlatform(),
    });
    const deck = module.deck("deck-a");
    await deck.load({
      radio: {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      },
      type: "radio",
    });

    await deck.transport({ type: "play" });

    expect(context.reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "deck-a",
        mode: "dj",
        rawMessage: "decoder internals 73",
        userMessage: "Failed to play deck-a",
      })
    );
  });
});

describe("DjDeckModule crossfaded starts", () => {
  const station = (id: string): Radio => ({
    id,
    name: id,
    streamUrl: `https://radio.example/${id}.mp3`,
  });
  const playing: AudioState = {
    error: null,
    hasEnded: false,
    isBuffering: false,
    isLoading: false,
    isPlaying: true,
    volume: 1,
  };
  const playVolumes = (audio: DjDeckAudioAdapter, soundId: string) =>
    (audio.transport as ReturnType<typeof mock>).mock.calls
      .filter(
        ([calledSoundId, intent]) =>
          calledSoundId === soundId && intent.type === "play"
      )
      .map(([, intent]) => intent.volume as number);
  const setCrossfader = (position: number) =>
    updatePlaybackSession("dj", (draft) => {
      draft.crossfadePosition = position;
    });
  const createModule = (audio: DjDeckAudioAdapter) =>
    createDjDeckModule({
      audio,
      context: createContext(),
      effects: createEffects(),
      output: createOutput(),
      platform: createPlatform(),
    });

  test("starts a Deck silent when the crossfader sits on the other side", async () => {
    setCrossfader(1);
    const audio = createAudioAdapter();
    const deck = createModule(audio).deck("deck-a");
    await deck.load({ radio: station("one"), type: "radio" });

    await deck.transport({ type: "play" });

    const [volume] = playVolumes(audio, "left_one:1");
    expect(volume).toBeCloseTo(0, 6);
  });

  test("starts Deck B silent when the crossfader sits fully on A", async () => {
    setCrossfader(0);
    const audio = createAudioAdapter();
    const deck = createModule(audio).deck("deck-b");
    await deck.load({ radio: station("two"), type: "radio" });

    await deck.transport({ type: "play" });

    const [volume] = playVolumes(audio, "right_two:1");
    expect(volume).toBeCloseTo(0, 6);
  });

  test("restarts a playing Deck on a new source at its crossfaded gain", async () => {
    setCrossfader(1);
    const audio = createAudioAdapter();
    const deck = createModule(audio).deck("deck-a");
    await deck.load({ radio: station("one"), type: "radio" });
    audio.emit("left_one:1", playing);

    await deck.load({ radio: station("two"), type: "radio" });

    const [volume] = playVolumes(audio, "left_two:2");
    expect(volume).toBeCloseTo(0, 6);
  });

  test("repeats an ended Deck at its crossfaded gain", async () => {
    setCrossfader(1);
    const audio = createAudioAdapter();
    const deck = createModule(audio).deck("deck-a");
    await deck.load({ radio: station("one"), type: "radio" });
    deck.change({ enabled: true, type: "repeat" });

    audio.emit("left_one:1", { ...playing, hasEnded: true, isPlaying: false });
    await Promise.resolve();
    await Promise.resolve();

    const [volume] = playVolumes(audio, "left_one:1");
    expect(volume).toBeCloseTo(0, 6);
  });
});

describe("DjDeckModule pending sources", () => {
  const platformItem = (id: number): Radio => {
    const item = PLATFORM_ITEMS.find((radio) => radio.id === id);
    if (!item) {
      throw new Error(`Expected platform item ${id}`);
    }
    return item;
  };
  const station = (id: string): Radio => ({
    id,
    name: id,
    streamUrl: `https://radio.example/${id}.mp3`,
  });
  const createModule = (
    audio: DjDeckAudioAdapter = createAudioAdapter(),
    platform: DjDeckPlatformAdapter = createPlatform()
  ) =>
    createDjDeckModule({
      audio,
      context: createContext(),
      effects: createEffects(),
      output: createOutput(),
      platform,
    });

  test("keeps one Deck's source form open while the other Deck loads, ejects and resets", async () => {
    const module = createModule();
    await module
      .deck("deck-a")
      .load({ radio: platformItem(BANDCAMP_PLATFORM_ID), type: "library" });
    await module
      .deck("deck-b")
      .load({ radio: platformItem(STATIC_AUDIO_PLATFORM_ID), type: "library" });

    expect(module.pendingSource.getSnapshot()).toEqual({
      "deck-a": "bandcamp",
      "deck-b": "static-audio",
    });

    await module.deck("deck-b").load({ radio: station("two"), type: "radio" });
    await module.deck("deck-b").transport({ type: "reset" });
    await module
      .deck("deck-b")
      .load({ autoPlay: false, radio: null, type: "track" });

    expect(module.pendingSource.getSnapshot()).toEqual({
      "deck-a": "bandcamp",
      "deck-b": null,
    });

    module.pendingSource.cancel("deck-b");
    expect(module.pendingSource.getSnapshot()["deck-a"]).toBe("bandcamp");

    module.deactivate();
    expect(module.pendingSource.getSnapshot()).toEqual({
      "deck-a": null,
      "deck-b": null,
    });
  });

  test("keeps a Deck's file form open until the remote file commits", async () => {
    let finishLoad: ((radio: Radio) => void) | null = null;
    const platform = createPlatform();
    platform.loadItem = mock(
      () =>
        new Promise<Awaited<ReturnType<DjDeckPlatformAdapter["loadItem"]>>>(
          (resolve) => {
            finishLoad = (radio) => resolve({ radio, success: true });
          }
        )
    );
    const module = createModule(createAudioAdapter(), platform);
    const deck = module.deck("deck-b");
    await deck.load({
      radio: platformItem(STATIC_AUDIO_PLATFORM_ID),
      type: "library",
    });

    const loading = deck.load({
      type: "static-audio-url",
      url: "https://audio.example/track.mp3",
    });
    await Promise.resolve();

    expect(module.pendingSource.getSnapshot()["deck-b"]).toBe("static-audio");

    (finishLoad as ((radio: Radio) => void) | null)?.({
      id: "remote-track",
      name: "Remote track",
      streamUrl: "https://audio.example/track.mp3",
    });

    expect(await loading).toEqual({ type: "loaded" });
    expect(getPlaybackChannel("dj", "deck-b")?.radio?.id).toBe("remote-track");
    expect(module.pendingSource.getSnapshot()["deck-b"]).toBeNull();
  });

  test("returns a remote file failure to the form instead of the mixer", async () => {
    clearDjErrorSurface();
    const platform = createPlatform();
    platform.loadItem = mock(() =>
      Promise.resolve({
        code: "STATIC_AUDIO_CLIENT_RESOLUTION_FAILED",
        error: "Failed to fetch",
        success: false as const,
      })
    );
    const module = createModule(createAudioAdapter(), platform);
    const deck = module.deck("deck-b");
    await deck.load({
      radio: platformItem(STATIC_AUDIO_PLATFORM_ID),
      type: "library",
    });

    const result = await deck.load({
      type: "static-audio-url",
      url: "https://audio.example/missing.mp3",
    });

    expect(result).toEqual({ message: "Failed to fetch", type: "failed" });
    expect(module.pendingSource.getSnapshot()["deck-b"]).toBe("static-audio");
    expect(getDjError()).toBeNull();
    expect(getPlaybackChannel("dj", "deck-b")?.radio).toBeNull();
  });

  test("returns a local file failure to the form instead of the mixer", async () => {
    clearDjErrorSurface();
    const audio = createAudioAdapter();
    audio.loadFile = mock(() =>
      Promise.reject(new Error("Unsupported audio format"))
    );
    const module = createModule(audio);
    const deck = module.deck("deck-a");
    await deck.load({
      radio: platformItem(STATIC_AUDIO_PLATFORM_ID),
      type: "library",
    });

    const result = await deck.load({
      file: new File(["noise"], "noise.bin"),
      type: "file",
    });

    expect(result).toEqual({
      message: "Unsupported audio format",
      type: "failed",
    });
    expect(module.pendingSource.getSnapshot()["deck-a"]).toBe("static-audio");
    expect(getDjError()).toBeNull();
  });
});
