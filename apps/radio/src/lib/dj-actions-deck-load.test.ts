import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  AudioManager,
  type AudioState,
  type ChannelSelection,
  createDefaultEffectConfig,
  type EffectConfig,
  type EffectType,
  type Radio,
} from "@/lib/audio";
import {
  createDefaultChannel,
  DECK_A_CHANNEL_ID,
  DECK_B_CHANNEL_ID,
  getPlaybackChannel,
  playbackSessionsCollection,
  updatePlaybackChannel,
} from "@/lib/collections/playback-sessions";
import { getPlaybackChannelRuntime } from "@/lib/stores/playback-runtime-store";
import {
  activateChannel,
  addChannelEffect,
  createAndAddChannelEffect,
  deactivateAllChannels,
  deactivateChannel,
  removeChannelEffect,
  reorderChannelEffects,
  setChannelEffectsDryWet,
  setChannelFilterValue,
  setChannelMuted,
  setChannelPan,
  setChannelSpeed,
  updateChannelEffect,
  updateChannelFilter,
} from "./channel-state-manager";
import {
  createDjDeckLoadWorkflow,
  type DeckLoadDependencies,
} from "./dj-actions-deck-load";
import type { DeckId } from "./dj-actions-decks";
import {
  getDeckLibrarySourceIntent,
  SEARCH_ALL_PLATFORM_ID,
  STATIC_AUDIO_PLATFORM_ID,
} from "./dj-library-sources";
import type { PlatformStreamResolution } from "./dj-platform-stream-port";
import type { PlaybackActionError } from "./playback-action-errors";

async function resetPlaybackSessions() {
  await playbackSessionsCollection.stateWhenReady();

  for (const sessionId of Array.from(playbackSessionsCollection.state.keys())) {
    playbackSessionsCollection.delete(sessionId);
  }
}

function insertDjSession() {
  playbackSessionsCollection.insert({
    id: "dj",
    channels: [
      createDefaultChannel(DECK_A_CHANNEL_ID, "deck-a", 0),
      createDefaultChannel(DECK_B_CHANNEL_ID, "deck-b", 1),
    ],
    masterVolume: 1,
    crossfadePosition: 0.5,
    headphoneVolume: 1,
    activeChannelId: null,
  });
}

function createDependencies(): DeckLoadDependencies {
  return {
    activateChannel,
    applyCrossfade: mock(() => undefined),
    applyStoredChannelStrip: mock(() => undefined),
    applyStoredEffectsAndFilters: mock(async () => undefined),
    clearDjError: mock(() => undefined),
    connectDeckCueBus: mock(() => undefined),
    deactivateChannel,
    getAudioManager: () => AudioManager.getInstance(),
    getDeviceChannelCount: mock((_soundId: string) => null),
    getSoundId: (radio: { id?: string | number }, side: string) =>
      `${side}_${radio.id}`,
    initializeAudioDevices: mock(async () => undefined),
    loadPlatformItem: mock((url: string) => {
      const displayName = url.split("/").at(-1)?.split(".")[0] ?? "audio";
      return Promise.resolve({
        success: true as const,
        radio: {
          name: displayName,
          streamUrl: url,
          platformMetadata: {
            platform: "static-audio" as const,
            itemType: "track" as const,
            url,
            fileName: displayName,
            displayName,
            duration: 0,
            fileSize: 0,
            mimeType: "audio/mpeg",
            streamUrl: url,
            isLocal: false,
          },
        },
      });
    }),
    loadTrack: mock(async () => undefined),
    pauseDeckSound: mock((_soundId: string) => undefined),
    playDeckSound: mock(async (_soundId: string, _volume: number) => undefined),
    resumeAudioContext: mock(async () => undefined),
    playDeviceSound: mock(
      async (_soundId: string, _deviceId: string) => undefined
    ),
    reportDjError: mock(() => undefined),
    resolvePlatformStreamUrl: mock(async () => null),
    seekDeckSound: mock((_soundId: string, _position: number) => undefined),
    setDeviceChannelSelection: mock(
      (_soundId: string, _selection: ChannelSelection) => undefined
    ),
    addDeckEffect: (deckId, type, effectId) =>
      createAndAddChannelEffect("dj", deckId, type, effectId),
    createEffectId: mock(() => "effect-1"),
    removeDeckEffect: (deckId, effectId) =>
      removeChannelEffect("dj", deckId, effectId),
    reorderDeckEffects: (deckId, effectIds) =>
      reorderChannelEffects("dj", deckId, effectIds),
    setDeckChannelFilter: (deckId, value) =>
      setChannelFilterValue("dj", deckId, value),
    setDeckEffectsDryWet: (deckId, value) =>
      setChannelEffectsDryWet("dj", deckId, value),
    setDeckMute: (deckId, muted) => setChannelMuted("dj", deckId, muted),
    setDeckPan: (deckId, pan) => setChannelPan("dj", deckId, pan),
    setDeckSpeed: (deckId, speed) => setChannelSpeed("dj", deckId, speed),
    setDeckVolume: mock((_deckId: DeckId, _volume: number) => undefined),
    updateDeckEffect: (deckId, effectId, effectConfig) =>
      updateChannelEffect("dj", deckId, effectId, effectConfig),
    updateDeckFilter: (deckId, filter) =>
      updateChannelFilter("dj", deckId, filter),
  };
}

function resolvedStream(
  streamUrl: string,
  streamFormat: Radio["streamFormat"] = "progressive"
): PlatformStreamResolution {
  return { streamFormat, streamUrl };
}

function createLocalFileRadio(
  objectUrl = "blob:https://radio.example/prior"
): Radio {
  return {
    id: "local-file-left-1",
    name: "Local Track",
    streamUrl: objectUrl,
    platformMetadata: {
      platform: "local-file",
      itemType: "track",
      url: "",
      fileName: "local.mp3",
      displayName: "Local",
      duration: 120,
      fileSize: 1024,
      mimeType: "audio/mpeg",
      objectUrl,
    },
  };
}

function createDeviceInputRadio(
  selection: ChannelSelection = { left: 0, right: 1 }
): Radio {
  return {
    id: "device-input-left",
    name: "Device 1",
    streamUrl: "",
    description: "Device input (mic/line-in)",
    enabled: true,
    platformMetadata: {
      platform: "device-input",
      itemType: "track",
      url: "",
      deviceId: "device-1",
      deviceLabel: "Device 1",
      channelSelection: selection,
      channelCount: 4,
    },
  };
}

function createPlaylistRadio(overrides: Partial<Radio> = {}): Radio {
  return {
    id: "playlist-1",
    name: "Playlist 1",
    streamUrl: "https://radio.example/current.mp3",
    platformMetadata: {
      platform: "soundcloud",
      itemType: "playlist",
      url: "https://soundcloud.example/playlist",
      name: "Playlist 1",
      artist: "Artist",
      artwork: "",
      trackCount: 2,
      tracks: [
        {
          name: "Current",
          streamUrl: "https://radio.example/current.mp3",
          duration: 120,
        },
        {
          name: "Next",
          streamUrl: "https://radio.example/next.mp3",
          duration: 180,
        },
      ],
    },
    ...overrides,
  };
}

async function flushContinuation() {
  await Promise.resolve();
  await Promise.resolve();
}

function captureDeckAudioState(manager: AudioManager): {
  emitAudioState: (audioState: AudioState) => void;
} {
  let onAudioState: (audioState: AudioState) => void = () => {
    throw new Error("Audio state subscriber was not registered");
  };

  manager.createSound = mock((_radio, soundId?: string) => soundId ?? "sound");
  manager.cleanupSound = mock((_soundId: string) => undefined);
  manager.subscribe = mock((_soundId, callback) => {
    onAudioState = callback;
    return mock(() => undefined);
  });
  manager.subscribeMeter = mock((_soundId, _callback) => mock(() => undefined));

  return {
    emitAudioState: (audioState) => {
      onAudioState(audioState);
    },
  };
}

function installMockAudioMetadata(duration = 123): () => void {
  const originalAudioDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "Audio"
  );

  class MockAudio {
    duration = duration;
    preload = "";
    readonly #listeners = new Map<string, Set<() => void>>();
    #src = "";

    addEventListener(type: string, listener: EventListener): void {
      const listeners = this.#listeners.get(type) ?? new Set<() => void>();
      listeners.add(listener as () => void);
      this.#listeners.set(type, listeners);
    }

    removeEventListener(type: string, listener: EventListener): void {
      this.#listeners.get(type)?.delete(listener as () => void);
    }

    get src(): string {
      return this.#src;
    }

    set src(value: string) {
      this.#src = value;
      if (value) {
        queueMicrotask(() => {
          for (const listener of this.#listeners.get("loadedmetadata") ?? []) {
            listener();
          }
        });
      }
    }
  }

  Object.defineProperty(globalThis, "Audio", {
    configurable: true,
    value: MockAudio,
  });

  return () => {
    if (originalAudioDescriptor) {
      Object.defineProperty(globalThis, "Audio", originalAudioDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "Audio");
    }
  };
}

beforeEach(async () => {
  await resetPlaybackSessions();
  deactivateAllChannels();
  AudioManager.resetInstance();
});

afterEach(async () => {
  await resetPlaybackSessions();
  deactivateAllChannels();
  AudioManager.resetInstance();
});

describe("DJ deck channel lifecycle", () => {
  test("maps browser placeholder items into pending platform source intents", () => {
    expect(
      getDeckLibrarySourceIntent({
        id: SEARCH_ALL_PLATFORM_ID,
        name: "Search All",
        streamUrl: "",
      })
    ).toEqual({ type: "pending-platform", platform: "external" });
    expect(
      getDeckLibrarySourceIntent({
        id: STATIC_AUDIO_PLATFORM_ID,
        name: "Audio File",
        streamUrl: "",
      })
    ).toEqual({ type: "pending-platform", platform: "static-audio" });
    expect(
      getDeckLibrarySourceIntent({
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      })
    ).toEqual({
      type: "load",
      source: {
        type: "radio",
        radio: {
          id: "station-1",
          name: "Station 1",
          streamUrl: "https://radio.example/one.mp3",
        },
      },
    });
  });

  test("loads, replaces, and ejects a deck through channel lifecycle cleanup", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    const manager = AudioManager.getInstance();
    const firstCleanup = mock(() => undefined);
    const secondCleanup = mock(() => undefined);
    manager.createSound = mock(
      (_radio, soundId?: string) => soundId ?? "sound"
    );
    manager.cleanupSound = mock((_soundId: string) => undefined);
    manager.subscribe = mock((soundId, _callback) =>
      soundId === "left_station-1" ? firstCleanup : secondCleanup
    );
    manager.subscribeMeter = mock((_soundId, _callback) =>
      mock(() => undefined)
    );
    const dependencies = createDependencies();
    const workflow = createDjDeckLoadWorkflow(dependencies);

    await workflow.loadDeckRadio("deck-a", {
      id: "station-1",
      name: "Station 1",
      streamUrl: "https://radio.example/one.mp3",
    });
    await workflow.loadDeckRadio("deck-a", {
      id: "station-2",
      name: "Station 2",
      streamUrl: "https://radio.example/two.mp3",
    });
    await workflow.loadDeckRadio("deck-a", null);

    expect(firstCleanup).toHaveBeenCalledTimes(1);
    expect(secondCleanup).toHaveBeenCalledTimes(1);
    expect(manager.cleanupSound).toHaveBeenNthCalledWith(1, "left_station-1");
    expect(manager.cleanupSound).toHaveBeenNthCalledWith(2, "left_station-2");
    expect(getPlaybackChannelRuntime("deck-a").soundId).toBeNull();
    expect(getPlaybackChannel("dj", "deck-a")?.radio).toBeNull();
  });

  test("does not persist a new deck radio when sound activation fails", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    const manager = AudioManager.getInstance();
    manager.createSound = mock(() => {
      throw new Error("create failed");
    });
    manager.cleanupSound = mock((_soundId: string) => undefined);
    manager.subscribe = mock((_soundId, _callback) => mock(() => undefined));
    manager.subscribeMeter = mock((_soundId, _callback) =>
      mock(() => undefined)
    );
    const dependencies = createDependencies();
    const workflow = createDjDeckLoadWorkflow(dependencies);

    await workflow.loadDeckRadio("deck-a", {
      id: "station-1",
      name: "Station 1",
      streamUrl: "https://radio.example/one.mp3",
    });

    expect(getPlaybackChannel("dj", "deck-a")?.radio).toBeNull();
    expect(getPlaybackChannelRuntime("deck-a").soundId).toBeNull();
    expect(dependencies.reportDjError).toHaveBeenCalledWith(
      "Failed to load deck-a",
      "DJ_LOAD_DECK_FAILED",
      expect.any(Error),
      expect.objectContaining({ id: "station-1" }),
      "deck-a"
    );
  });

  test("rolls back a loaded deck when lifecycle runtime subscription fails", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    const manager = AudioManager.getInstance();
    manager.createSound = mock(
      (_radio, soundId?: string) => soundId ?? "sound"
    );
    manager.cleanupSound = mock((_soundId: string) => undefined);
    manager.subscribe = mock(() => {
      throw new Error("subscription failed");
    });
    manager.subscribeMeter = mock((_soundId, _callback) =>
      mock(() => undefined)
    );
    const dependencies = createDependencies();
    const workflow = createDjDeckLoadWorkflow(dependencies);

    await workflow.loadDeckRadio("deck-a", {
      id: "station-1",
      name: "Station 1",
      streamUrl: "https://radio.example/one.mp3",
    });

    expect(getPlaybackChannel("dj", "deck-a")?.radio).toBeNull();
    expect(getPlaybackChannelRuntime("deck-a").soundId).toBeNull();
    expect(manager.cleanupSound).toHaveBeenCalledWith("left_station-1");
    expect(dependencies.reportDjError).toHaveBeenCalledWith(
      "Failed to load deck-a",
      "DJ_LOAD_DECK_FAILED",
      expect.any(Error),
      expect.objectContaining({ id: "station-1" }),
      "deck-a"
    );
  });

  test("keeps a prior local file URL when deck replacement activation fails", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    const priorRadio = createLocalFileRadio();
    updatePlaybackChannel("dj", "deck-a", (draft) => {
      draft.radio = priorRadio;
    });

    const originalRevokeObjectUrl = URL.revokeObjectURL;
    URL.revokeObjectURL = mock((_url: string) => undefined);

    try {
      const manager = AudioManager.getInstance();
      manager.createSound = mock(() => {
        throw new Error("create failed");
      });
      manager.cleanupSound = mock((_soundId: string) => undefined);
      manager.subscribe = mock((_soundId, _callback) => mock(() => undefined));
      manager.subscribeMeter = mock((_soundId, _callback) =>
        mock(() => undefined)
      );
      const dependencies = createDependencies();
      const workflow = createDjDeckLoadWorkflow(dependencies);

      await workflow.loadDeckRadio("deck-a", {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      });

      expect(getPlaybackChannel("dj", "deck-a")?.radio).toEqual(priorRadio);
      expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    } finally {
      URL.revokeObjectURL = originalRevokeObjectUrl;
    }
  });

  test("releases a prior local file URL after deck replacement succeeds", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    updatePlaybackChannel("dj", "deck-a", (draft) => {
      draft.radio = createLocalFileRadio();
    });

    const originalRevokeObjectUrl = URL.revokeObjectURL;
    URL.revokeObjectURL = mock((_url: string) => undefined);

    try {
      const manager = AudioManager.getInstance();
      manager.createSound = mock(
        (_radio, soundId?: string) => soundId ?? "sound"
      );
      manager.cleanupSound = mock((_soundId: string) => undefined);
      manager.subscribe = mock((_soundId, _callback) => mock(() => undefined));
      manager.subscribeMeter = mock((_soundId, _callback) =>
        mock(() => undefined)
      );
      const dependencies = createDependencies();
      const workflow = createDjDeckLoadWorkflow(dependencies);

      await workflow.loadDeckRadio("deck-a", {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      });

      expect(getPlaybackChannel("dj", "deck-a")?.radio).toEqual(
        expect.objectContaining({ id: "station-1" })
      );
      expect(URL.revokeObjectURL).toHaveBeenCalledWith(
        "blob:https://radio.example/prior"
      );
    } finally {
      URL.revokeObjectURL = originalRevokeObjectUrl;
    }
  });

  test("keeps replacement source when prior local file was released before play rollback", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    const manager = AudioManager.getInstance();
    const { emitAudioState } = captureDeckAudioState(manager);
    const rawError = new Error("play failed");
    const dependencies = {
      ...createDependencies(),
      playDeckSound: mock(() => Promise.reject(rawError)),
    };
    const workflow = createDjDeckLoadWorkflow(dependencies);

    await workflow.loadDeckRadio("deck-a", createLocalFileRadio());
    emitAudioState({
      isPlaying: true,
      isLoading: false,
      isBuffering: false,
      hasEnded: false,
      volume: 1,
      error: null,
    });

    const originalRevokeObjectUrl = URL.revokeObjectURL;
    URL.revokeObjectURL = mock((_url: string) => undefined);

    try {
      await workflow.loadDeckRadio("deck-a", {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      });

      expect(URL.revokeObjectURL).toHaveBeenCalledWith(
        "blob:https://radio.example/prior"
      );
      expect(getPlaybackChannel("dj", "deck-a")?.radio).toEqual(
        expect.objectContaining({ id: "station-1" })
      );
      expect(getPlaybackChannelRuntime("deck-a").soundId).toBeNull();
      expect(dependencies.reportDjError).toHaveBeenCalledWith(
        "Failed to load deck-a",
        "DJ_LOAD_DECK_FAILED",
        rawError,
        expect.objectContaining({ id: "station-1" }),
        "deck-a"
      );
    } finally {
      URL.revokeObjectURL = originalRevokeObjectUrl;
    }
  });

  test("releases a prior local file URL after a superseded replacement persists", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    updatePlaybackChannel("dj", "deck-a", (draft) => {
      draft.radio = createLocalFileRadio();
    });

    const originalRevokeObjectUrl = URL.revokeObjectURL;
    URL.revokeObjectURL = mock((_url: string) => undefined);

    try {
      const manager = AudioManager.getInstance();
      manager.createSound = mock(
        (_radio, soundId?: string) => soundId ?? "sound"
      );
      manager.cleanupSound = mock((_soundId: string) => undefined);
      manager.subscribe = mock((_soundId, _callback) => mock(() => undefined));
      manager.subscribeMeter = mock((_soundId, _callback) =>
        mock(() => undefined)
      );
      const firstDeviceLoad = {
        resolve: null as (() => void) | null,
      };
      const dependencies = {
        ...createDependencies(),
        playDeviceSound: mock((_soundId: string, deviceId: string) => {
          if (deviceId === "device-1") {
            return new Promise<void>((resolve) => {
              firstDeviceLoad.resolve = resolve;
            });
          }
          return Promise.resolve();
        }),
      };
      const workflow = createDjDeckLoadWorkflow(dependencies);

      const firstLoad = workflow.loadDeckDeviceInput(
        "deck-a",
        "device-1",
        "Device 1"
      );
      await Promise.resolve();
      await workflow.loadDeckDeviceInput("deck-a", "device-2", "Device 2");
      if (!firstDeviceLoad.resolve) {
        throw new Error("First device load was not started");
      }
      firstDeviceLoad.resolve();
      await firstLoad;

      expect(getPlaybackChannel("dj", "deck-a")?.radio).toEqual(
        expect.objectContaining({
          name: "Device 2",
          platformMetadata: expect.objectContaining({
            platform: "device-input",
            deviceId: "device-2",
          }),
        })
      );
      expect(URL.revokeObjectURL).toHaveBeenCalledWith(
        "blob:https://radio.example/prior"
      );
    } finally {
      URL.revokeObjectURL = originalRevokeObjectUrl;
    }
  });

  test("releases a prior local file URL after clearing a deck", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    const manager = AudioManager.getInstance();
    manager.createSound = mock(
      (_radio, soundId?: string) => soundId ?? "sound"
    );
    manager.cleanupSound = mock((_soundId: string) => undefined);
    manager.subscribe = mock((_soundId, _callback) => mock(() => undefined));
    manager.subscribeMeter = mock((_soundId, _callback) =>
      mock(() => undefined)
    );
    const dependencies = createDependencies();
    const workflow = createDjDeckLoadWorkflow(dependencies);

    await workflow.loadDeckRadio("deck-a", createLocalFileRadio());

    const originalRevokeObjectUrl = URL.revokeObjectURL;
    URL.revokeObjectURL = mock((_url: string) => undefined);

    try {
      await workflow.loadDeckRadio("deck-a", null);

      expect(getPlaybackChannel("dj", "deck-a")?.radio).toBeNull();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith(
        "blob:https://radio.example/prior"
      );
    } finally {
      URL.revokeObjectURL = originalRevokeObjectUrl;
    }
  });

  test("loads a local file source through the lifecycle boundary", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    const manager = AudioManager.getInstance();
    manager.createSound = mock(
      (_radio, soundId?: string) => soundId ?? "sound"
    );
    manager.cleanupSound = mock((_soundId: string) => undefined);
    manager.subscribe = mock((_soundId, _callback) => mock(() => undefined));
    manager.subscribeMeter = mock((_soundId, _callback) =>
      mock(() => undefined)
    );
    const dependencies = createDependencies();
    const workflow = createDjDeckLoadWorkflow(dependencies);

    await workflow.loadDeckRadio("deck-a", createLocalFileRadio());

    expect(getPlaybackChannelRuntime("deck-a").soundId).toBe(
      "left_local-file-left-1"
    );
    expect(getPlaybackChannel("dj", "deck-a")?.radio).toEqual(
      expect.objectContaining({
        id: "local-file-left-1",
        name: "Local Track",
        streamUrl: "blob:https://radio.example/prior",
        platformMetadata: expect.objectContaining({
          platform: "local-file",
          fileName: "local.mp3",
          displayName: "Local",
          objectUrl: "blob:https://radio.example/prior",
        }),
      })
    );
  });

  test("keeps a prior deck source when local file activation fails", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    const previousRadio = {
      id: "station-1",
      name: "Station 1",
      streamUrl: "https://radio.example/one.mp3",
    };
    updatePlaybackChannel("dj", "deck-a", (draft) => {
      draft.radio = previousRadio;
    });

    const originalRevokeObjectUrl = URL.revokeObjectURL;
    URL.revokeObjectURL = mock((_url: string) => undefined);

    try {
      const manager = AudioManager.getInstance();
      manager.createSound = mock(() => {
        throw new Error("create failed");
      });
      manager.cleanupSound = mock((_soundId: string) => undefined);
      manager.subscribe = mock((_soundId, _callback) => mock(() => undefined));
      manager.subscribeMeter = mock((_soundId, _callback) =>
        mock(() => undefined)
      );
      const dependencies = createDependencies();
      const workflow = createDjDeckLoadWorkflow(dependencies);

      await workflow.loadDeckRadio("deck-a", createLocalFileRadio());

      expect(getPlaybackChannel("dj", "deck-a")?.radio).toEqual(previousRadio);
      expect(getPlaybackChannelRuntime("deck-a").soundId).toBeNull();
      expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    } finally {
      URL.revokeObjectURL = originalRevokeObjectUrl;
    }
  });

  test("releases a newly extracted local file URL when activation fails", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    const previousRadio = {
      id: "station-1",
      name: "Station 1",
      streamUrl: "https://radio.example/one.mp3",
    };
    updatePlaybackChannel("dj", "deck-a", (draft) => {
      draft.radio = previousRadio;
    });

    const restoreAudio = installMockAudioMetadata();
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    URL.createObjectURL = mock(
      (_file: Blob) => "blob:https://radio.example/new-track"
    ) as typeof URL.createObjectURL;
    URL.revokeObjectURL = mock((_url: string) => undefined);

    try {
      const manager = AudioManager.getInstance();
      manager.createSound = mock(() => {
        throw new Error("create failed");
      });
      manager.cleanupSound = mock((_soundId: string) => undefined);
      manager.subscribe = mock((_soundId, _callback) => mock(() => undefined));
      manager.subscribeMeter = mock((_soundId, _callback) =>
        mock(() => undefined)
      );
      const dependencies = createDependencies();
      const workflow = createDjDeckLoadWorkflow(dependencies);
      const file = new File(["audio"], "new-track.mp3", {
        type: "audio/mpeg",
      });

      await workflow.loadDeckFile("deck-a", file);

      expect(getPlaybackChannel("dj", "deck-a")?.radio).toEqual(previousRadio);
      expect(getPlaybackChannelRuntime("deck-a").soundId).toBeNull();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith(
        "blob:https://radio.example/new-track"
      );
    } finally {
      URL.createObjectURL = originalCreateObjectUrl;
      URL.revokeObjectURL = originalRevokeObjectUrl;
      restoreAudio();
    }
  });

  test("loads static audio URLs through source intent dispatch", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    const manager = AudioManager.getInstance();
    manager.createSound = mock(
      (_radio, soundId?: string) => soundId ?? "sound"
    );
    manager.cleanupSound = mock((_soundId: string) => undefined);
    manager.subscribe = mock((_soundId, _callback) => mock(() => undefined));
    manager.subscribeMeter = mock((_soundId, _callback) =>
      mock(() => undefined)
    );
    const dependencies = createDependencies();
    const workflow = createDjDeckLoadWorkflow(dependencies);

    await workflow.loadDeckSource("deck-a", {
      type: "static-audio-url",
      url: "https://radio.example/set.mp3",
    });

    expect(getPlaybackChannel("dj", "deck-a")?.radio).toEqual(
      expect.objectContaining({
        name: "set",
        streamUrl: "https://radio.example/set.mp3",
        platformMetadata: expect.objectContaining({
          platform: "static-audio",
          streamUrl: "https://radio.example/set.mp3",
        }),
      })
    );
    expect(dependencies.loadPlatformItem).toHaveBeenCalledWith(
      "https://radio.example/set.mp3"
    );
  });

  test.each([
    "m3u",
    "pls",
  ] as const)("resolves DJ remote .%s playlists before loading the deck", async (playlistFormat) => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    const manager = AudioManager.getInstance();
    manager.createSound = mock(
      (_radio, soundId?: string) => soundId ?? "sound"
    );
    manager.cleanupSound = mock((_soundId: string) => undefined);
    manager.subscribe = mock((_soundId, _callback) => mock(() => undefined));
    manager.subscribeMeter = mock((_soundId, _callback) =>
      mock(() => undefined)
    );
    const url = `https://radio.example/set.${playlistFormat}`;
    const firstTrack = "https://cdn.example/first.mp3";
    const resolvedRadio: Radio = {
      name: "Resolved set",
      streamUrl: firstTrack,
      streamFormat: "progressive",
      platformMetadata: {
        platform: "static-audio",
        itemType: "playlist",
        url,
        fileName: `set.${playlistFormat}`,
        displayName: "Resolved set",
        duration: 12,
        fileSize: 0,
        mimeType:
          playlistFormat === "pls" ? "audio/x-scpls" : "audio/x-mpegurl",
        streamUrl: firstTrack,
        isLocal: false,
        playlistFormat,
        tracks: [{ title: "First", streamUrl: firstTrack, duration: 12 }],
      },
    };
    const dependencies = {
      ...createDependencies(),
      loadPlatformItem: mock(() =>
        Promise.resolve({ success: true as const, radio: resolvedRadio })
      ),
    };
    const workflow = createDjDeckLoadWorkflow(dependencies);

    await workflow.loadDeckSource("deck-a", {
      type: "static-audio-url",
      url,
    });

    expect(dependencies.loadPlatformItem).toHaveBeenCalledWith(url);
    expect(getPlaybackChannel("dj", "deck-a")?.radio).toEqual(resolvedRadio);
    expect(
      getPlaybackChannel("dj", "deck-a")?.radio?.platformMetadata
    ).toMatchObject({
      itemType: "playlist",
      playlistFormat,
    });
  });

  test("does not let stale static playlist resolution replace a newer deck source", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    const manager = AudioManager.getInstance();
    manager.createSound = mock(
      (_radio, soundId?: string) => soundId ?? "sound"
    );
    manager.cleanupSound = mock((_soundId: string) => undefined);
    manager.subscribe = mock((_soundId, _callback) => mock(() => undefined));
    manager.subscribeMeter = mock((_soundId, _callback) =>
      mock(() => undefined)
    );
    const pendingStaticResolution = {
      resolve: null as
        | ((result: { radio: Radio; success: true }) => void)
        | null,
    };
    const dependencies = {
      ...createDependencies(),
      loadPlatformItem: mock(
        () =>
          new Promise<{ radio: Radio; success: true }>((resolve) => {
            pendingStaticResolution.resolve = resolve;
          })
      ),
    };
    const workflow = createDjDeckLoadWorkflow(dependencies);
    const staleLoad = workflow.loadDeckSource("deck-a", {
      type: "static-audio-url",
      url: "https://audio.example/stale.m3u",
    });
    await Promise.resolve();

    await workflow.loadDeckSource("deck-a", {
      type: "radio",
      radio: {
        id: "newer-radio",
        name: "Newer radio",
        streamUrl: "https://radio.example/newer.mp3",
      },
    });

    if (!pendingStaticResolution.resolve) {
      throw new Error("Expected static resolver to start");
    }
    pendingStaticResolution.resolve({
      success: true,
      radio: {
        name: "Stale playlist",
        streamUrl: "https://audio.example/stale-first.mp3",
      },
    });
    await staleLoad;

    expect(getPlaybackChannel("dj", "deck-a")?.radio).toMatchObject({
      id: "newer-radio",
      streamUrl: "https://radio.example/newer.mp3",
    });
  });

  test("manual static playlist navigation clears a stale HLS format", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    const manager = AudioManager.getInstance();
    manager.createSound = mock(
      (_radio, soundId?: string) => soundId ?? "sound"
    );
    manager.cleanupSound = mock((_soundId: string) => undefined);
    manager.subscribe = mock((_soundId, _callback) => mock(() => undefined));
    manager.subscribeMeter = mock((_soundId, _callback) =>
      mock(() => undefined)
    );
    const dependencies = createDependencies();
    const workflow = createDjDeckLoadWorkflow(dependencies);
    const playlist: Radio = {
      id: "static-playlist",
      name: "Static playlist",
      streamFormat: "hls",
      streamUrl: "https://audio.example/live.m3u8",
      platformMetadata: {
        displayName: "Static playlist",
        duration: 0,
        fileName: "playlist.m3u",
        fileSize: 0,
        isLocal: false,
        itemType: "playlist",
        mimeType: "audio/x-mpegurl",
        platform: "static-audio",
        playlistFormat: "m3u",
        streamUrl: "https://audio.example/live.m3u8",
        tracks: [
          { streamUrl: "https://audio.example/live.m3u8", title: "Live" },
          { streamUrl: "https://audio.example/archive.mp3", title: "Archive" },
        ],
        url: "https://audio.example/playlist.m3u",
      },
    };

    await workflow.loadDeckSource("deck-a", {
      autoPlay: false,
      radio: playlist,
      streamUrl: "https://audio.example/archive.mp3",
      type: "track-url",
    });

    expect(getPlaybackChannel("dj", "deck-a")?.radio).toMatchObject({
      streamFormat: "progressive",
      streamUrl: "https://audio.example/archive.mp3",
    });
  });

  test.each([
    "bandcamp",
    "soundcloud",
  ] as const)("manual %s navigation honors an extensionless nested-track format", async (platform) => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    const manager = AudioManager.getInstance();
    manager.createSound = mock(
      (_radio, soundId?: string) => soundId ?? "sound"
    );
    manager.cleanupSound = mock((_soundId: string) => undefined);
    manager.subscribe = mock((_soundId, _callback) => mock(() => undefined));
    manager.subscribeMeter = mock((_soundId, _callback) =>
      mock(() => undefined)
    );
    const selectedUrl = "https://media.example/extensionless-live";
    const radio: Radio = {
      id: `${platform}-playlist`,
      name: `${platform} playlist`,
      streamFormat: "progressive",
      streamUrl: "https://media.example/current.mp3",
      platformMetadata:
        platform === "soundcloud"
          ? {
              itemType: "playlist",
              platform,
              tracks: [
                {
                  format: "hls",
                  name: "Live",
                  streamUrl: selectedUrl,
                },
              ],
              url: "https://soundcloud.com/artist/set",
            }
          : {
              itemType: "album",
              platform,
              tracks: [
                {
                  format: "hls",
                  name: "Live",
                  streamUrl: selectedUrl,
                },
              ],
              url: "https://artist.bandcamp.com/album/set",
            },
    };
    const workflow = createDjDeckLoadWorkflow(createDependencies());

    await workflow.loadDeckSource("deck-a", {
      autoPlay: false,
      radio,
      streamUrl: selectedUrl,
      type: "track-url",
    });

    expect(getPlaybackChannel("dj", "deck-a")?.radio).toMatchObject({
      streamFormat: "hls",
      streamUrl: selectedUrl,
    });
  });

  test("clears persisted deck state and runtime state together", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    const manager = AudioManager.getInstance();
    const cleanup = mock(() => undefined);
    manager.createSound = mock(
      (_radio, soundId?: string) => soundId ?? "sound"
    );
    manager.cleanupSound = mock((_soundId: string) => undefined);
    manager.subscribe = mock((_soundId, _callback) => cleanup);
    manager.subscribeMeter = mock((_soundId, _callback) =>
      mock(() => undefined)
    );
    const dependencies = createDependencies();
    const workflow = createDjDeckLoadWorkflow(dependencies);

    await workflow.loadDeckRadio("deck-a", {
      id: "station-1",
      name: "Station 1",
      streamUrl: "https://radio.example/one.mp3",
    });
    updatePlaybackChannel("dj", "deck-a", (draft) => {
      draft.volume = 0.4;
      draft.muted = true;
      draft.pan = -0.25;
      draft.speed = 1.2;
      draft.channelFilter = 0.5;
      draft.effectsDryWet = 0.3;
      draft.repeat = true;
      draft.autoplay = false;
      draft.effects = [
        {
          id: "delay-1",
          type: "delay",
          enabled: true,
          order: 0,
          dryWet: 0.5,
          inputGain: 1,
          outputGain: 1,
          delayTime: 0.2,
          feedback: 0.4,
        },
      ];
      draft.filter = {
        type: "highpass",
        frequency: 400,
        Q: 2,
        gain: 3,
        enabled: true,
      };
    });

    await workflow.loadDeckRadio("deck-a", null);

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(manager.cleanupSound).toHaveBeenCalledWith("left_station-1");
    expect(getPlaybackChannelRuntime("deck-a")).toEqual(
      expect.objectContaining({
        soundId: null,
        isPlaying: false,
        isLoading: false,
        isBuffering: false,
      })
    );
    expect(getPlaybackChannel("dj", "deck-a")).toEqual(
      expect.objectContaining({
        radio: null,
        volume: 1,
        muted: false,
        pan: 0,
        speed: 1,
        channelFilter: 0,
        effects: [],
        effectsDryWet: 1,
        repeat: false,
        autoplay: true,
        filter: expect.objectContaining({
          type: "lowpass",
          frequency: 1000,
          Q: 1,
          gain: 0,
          enabled: false,
        }),
      })
    );
  });

  test("persists the loaded deck radio from the lifecycle activation boundary", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    const dependencies = {
      ...createDependencies(),
      activateChannel: mock((sessionId, channelId, radio, options) => {
        expect(sessionId).toBe("dj");
        expect(channelId).toBe("deck-a");
        expect(options).toEqual(
          expect.objectContaining({ persistRadio: true })
        );
        expect(getPlaybackChannel("dj", "deck-a")?.radio).toBeNull();
        updatePlaybackChannel("dj", "deck-a", (draft) => {
          draft.radio = radio;
        });
        return "left_station-1";
      }),
    };
    const workflow = createDjDeckLoadWorkflow(dependencies);

    await workflow.loadDeckRadio("deck-a", {
      id: "station-1",
      name: "Station 1",
      streamUrl: "https://radio.example/one.mp3",
    });

    expect(getPlaybackChannel("dj", "deck-a")?.radio).toEqual(
      expect.objectContaining({ id: "station-1" })
    );
  });

  test("rolls back a device input deck source when device activation fails", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    const previousRadio = {
      id: "station-1",
      name: "Station 1",
      streamUrl: "https://radio.example/one.mp3",
    };
    updatePlaybackChannel("dj", "deck-a", (draft) => {
      draft.radio = previousRadio;
    });

    const manager = AudioManager.getInstance();
    manager.createSound = mock(
      (_radio, soundId?: string) => soundId ?? "sound"
    );
    manager.cleanupSound = mock((_soundId: string) => undefined);
    manager.subscribe = mock((_soundId, _callback) => mock(() => undefined));
    manager.subscribeMeter = mock((_soundId, _callback) =>
      mock(() => undefined)
    );
    const dependencies = {
      ...createDependencies(),
      playDeviceSound: mock(() =>
        Promise.reject(new Error("device unavailable"))
      ),
    };
    const workflow = createDjDeckLoadWorkflow(dependencies);

    await workflow.loadDeckDeviceInput("deck-a", "device-1", "Device 1");

    expect(getPlaybackChannel("dj", "deck-a")?.radio).toEqual(previousRadio);
    expect(getPlaybackChannelRuntime("deck-a").soundId).toBeNull();
    expect(manager.cleanupSound).toHaveBeenCalledWith("left_device-input-left");
    expect(dependencies.reportDjError).toHaveBeenCalledWith(
      "Failed to load deck-a",
      "DJ_LOAD_DECK_FAILED",
      expect.any(Error),
      expect.objectContaining({
        id: "device-input-left",
        platformMetadata: expect.objectContaining({
          platform: "device-input",
          deviceId: "device-1",
          deviceLabel: "Device 1",
        }),
      }),
      "deck-a"
    );
  });

  test("loads a device input source through the lifecycle boundary", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    const manager = AudioManager.getInstance();
    manager.createSound = mock(
      (_radio, soundId?: string) => soundId ?? "sound"
    );
    manager.cleanupSound = mock((_soundId: string) => undefined);
    manager.subscribe = mock((_soundId, _callback) => mock(() => undefined));
    manager.subscribeMeter = mock((_soundId, _callback) =>
      mock(() => undefined)
    );
    const dependencies = {
      ...createDependencies(),
      getDeviceChannelCount: mock((_soundId: string) => 4),
    };
    const workflow = createDjDeckLoadWorkflow(dependencies);

    await workflow.loadDeckDeviceInput("deck-a", "device-1", "Device 1");

    expect(dependencies.playDeviceSound).toHaveBeenCalledWith(
      "left_device-input-left",
      "device-1"
    );
    expect(getPlaybackChannelRuntime("deck-a").soundId).toBe(
      "left_device-input-left"
    );
    expect(getPlaybackChannel("dj", "deck-a")?.radio).toEqual(
      expect.objectContaining({
        id: "device-input-left",
        name: "Device 1",
        platformMetadata: expect.objectContaining({
          platform: "device-input",
          deviceId: "device-1",
          deviceLabel: "Device 1",
          channelCount: 4,
        }),
      })
    );
    expect(dependencies.applyCrossfade).toHaveBeenCalledTimes(1);
  });

  test("does not play a stale device input after a newer load starts first", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    const manager = AudioManager.getInstance();
    manager.createSound = mock(
      (_radio, soundId?: string) => soundId ?? "sound"
    );
    manager.cleanupSound = mock((_soundId: string) => undefined);
    manager.subscribe = mock((_soundId, _callback) => mock(() => undefined));
    manager.subscribeMeter = mock((_soundId, _callback) =>
      mock(() => undefined)
    );

    const dependencies = createDependencies();
    const activateChannelThroughFacade = dependencies.activateChannel;
    let workflow: ReturnType<typeof createDjDeckLoadWorkflow>;
    let hasStartedNewerLoad = false;
    const newerLoads: Promise<void>[] = [];

    dependencies.activateChannel = mock(
      (sessionId, channelId, radio, optionsOrSoundId) => {
        const soundId = activateChannelThroughFacade(
          sessionId,
          channelId,
          radio,
          optionsOrSoundId
        );
        if (
          channelId === "deck-a" &&
          radio.platformMetadata?.platform === "device-input" &&
          radio.platformMetadata.deviceId === "device-1" &&
          !hasStartedNewerLoad
        ) {
          hasStartedNewerLoad = true;
          newerLoads.push(
            workflow.loadDeckDeviceInput("deck-a", "device-2", "Device 2")
          );
        }
        return soundId;
      }
    );
    workflow = createDjDeckLoadWorkflow(dependencies);

    await workflow.loadDeckDeviceInput("deck-a", "device-1", "Device 1");
    await Promise.all(newerLoads);

    expect(dependencies.playDeviceSound).toHaveBeenCalledTimes(1);
    expect(dependencies.playDeviceSound).toHaveBeenCalledWith(
      "left_device-input-left",
      "device-2"
    );
    expect(getPlaybackChannel("dj", "deck-a")?.radio).toEqual(
      expect.objectContaining({
        name: "Device 2",
        platformMetadata: expect.objectContaining({
          platform: "device-input",
          deviceId: "device-2",
        }),
      })
    );
  });

  test("applies stored device channel selection when loading a device input source", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    const manager = AudioManager.getInstance();
    manager.createSound = mock(
      (_radio, soundId?: string) => soundId ?? "sound"
    );
    manager.cleanupSound = mock((_soundId: string) => undefined);
    manager.subscribe = mock((_soundId, _callback) => mock(() => undefined));
    manager.subscribeMeter = mock((_soundId, _callback) =>
      mock(() => undefined)
    );
    const dependencies = createDependencies();
    const workflow = createDjDeckLoadWorkflow(dependencies);

    await workflow.loadDeckRadio(
      "deck-a",
      createDeviceInputRadio({ left: 2, right: 3 })
    );

    expect(dependencies.setDeviceChannelSelection).toHaveBeenCalledWith(
      "left_device-input-left",
      {
        left: 2,
        right: 3,
      }
    );
  });

  test("does not roll back a newer device input load when an older activation fails", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    const manager = AudioManager.getInstance();
    manager.createSound = mock(
      (_radio, soundId?: string) => soundId ?? "sound"
    );
    manager.cleanupSound = mock((_soundId: string) => undefined);
    manager.subscribe = mock((_soundId, _callback) => mock(() => undefined));
    manager.subscribeMeter = mock((_soundId, _callback) =>
      mock(() => undefined)
    );

    const firstDeviceLoad = {
      fail: null as ((error: Error) => void) | null,
    };
    const dependencies = {
      ...createDependencies(),
      playDeviceSound: mock((_soundId: string, deviceId: string) => {
        if (deviceId === "device-1") {
          return new Promise<void>((_resolve, reject) => {
            firstDeviceLoad.fail = reject;
          });
        }
        return Promise.resolve();
      }),
    };
    const workflow = createDjDeckLoadWorkflow(dependencies);

    const firstLoad = workflow.loadDeckDeviceInput(
      "deck-a",
      "device-1",
      "Device 1"
    );
    await Promise.resolve();
    await workflow.loadDeckDeviceInput("deck-a", "device-2", "Device 2");
    if (!firstDeviceLoad.fail) {
      throw new Error("First device load was not started");
    }
    firstDeviceLoad.fail(new Error("stale activation failed"));
    await firstLoad;

    expect(getPlaybackChannelRuntime("deck-a").soundId).toBe(
      "left_device-input-left"
    );
    expect(getPlaybackChannel("dj", "deck-a")?.radio).toEqual(
      expect.objectContaining({
        name: "Device 2",
        platformMetadata: expect.objectContaining({
          platform: "device-input",
          deviceId: "device-2",
        }),
      })
    );
    expect(dependencies.reportDjError).not.toHaveBeenCalled();
  });

  test("updates device channel selection against the active deck runtime source", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    const manager = AudioManager.getInstance();
    manager.createSound = mock(
      (_radio, soundId?: string) => soundId ?? "sound"
    );
    manager.cleanupSound = mock((_soundId: string) => undefined);
    manager.subscribe = mock((_soundId, _callback) => mock(() => undefined));
    manager.subscribeMeter = mock((_soundId, _callback) =>
      mock(() => undefined)
    );
    const dependencies = createDependencies();
    const workflow = createDjDeckLoadWorkflow(dependencies);

    await workflow.loadDeckDeviceInput("deck-a", "device-1", "Device 1");
    workflow.setDeckDeviceChannelSelection("deck-a", { left: 2, right: 3 });

    expect(dependencies.setDeviceChannelSelection).toHaveBeenCalledWith(
      "left_device-input-left",
      {
        left: 2,
        right: 3,
      }
    );
    expect(getPlaybackChannel("dj", "deck-a")?.radio?.platformMetadata).toEqual(
      expect.objectContaining({
        platform: "device-input",
        channelSelection: { left: 2, right: 3 },
      })
    );
  });

  test("ignores device channel selection when the active deck source is not a device input", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    const manager = AudioManager.getInstance();
    manager.createSound = mock(
      (_radio, soundId?: string) => soundId ?? "sound"
    );
    manager.cleanupSound = mock((_soundId: string) => undefined);
    manager.subscribe = mock((_soundId, _callback) => mock(() => undefined));
    manager.subscribeMeter = mock((_soundId, _callback) =>
      mock(() => undefined)
    );
    const dependencies = createDependencies();
    const workflow = createDjDeckLoadWorkflow(dependencies);

    await workflow.loadDeckRadio("deck-a", {
      id: "station-1",
      name: "Station 1",
      streamUrl: "https://radio.example/one.mp3",
    });
    workflow.setDeckDeviceChannelSelection("deck-a", { left: 2, right: 3 });

    expect(dependencies.setDeviceChannelSelection).not.toHaveBeenCalled();
    expect(getPlaybackChannel("dj", "deck-a")?.radio).toEqual(
      expect.objectContaining({
        id: "station-1",
        streamUrl: "https://radio.example/one.mp3",
      })
    );
  });

  test("replays stored strip, effects, and cue routing when a loaded deck becomes active", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();
    updatePlaybackChannel("dj", "deck-a", (draft) => {
      draft.volume = 0.72;
      draft.muted = true;
      draft.pan = -0.35;
      draft.speed = 1.1;
      draft.channelFilter = 0.25;
      draft.effectsDryWet = 0.6;
      draft.cueEnabled = true;
      draft.effects = [
        {
          id: "delay-1",
          type: "delay",
          enabled: true,
          order: 0,
          dryWet: 0.5,
          inputGain: 1,
          outputGain: 1,
          delayTime: 0.2,
          feedback: 0.4,
        },
      ];
      draft.filter = {
        type: "highpass",
        frequency: 400,
        Q: 1,
        gain: 0,
        enabled: true,
      };
    });

    const manager = AudioManager.getInstance();
    let onAudioState: (audioState: AudioState) => void = () => {
      throw new Error("Audio state subscriber was not registered");
    };
    manager.createSound = mock(
      (_radio, soundId?: string) => soundId ?? "sound"
    );
    manager.cleanupSound = mock((_soundId: string) => undefined);
    manager.getPreFaderNode = mock(
      () => ({ connect: mock() }) as unknown as GainNode
    );
    manager.subscribe = mock((_soundId, callback) => {
      onAudioState = callback;
      return mock(() => undefined);
    });
    manager.subscribeMeter = mock((_soundId, _callback) =>
      mock(() => undefined)
    );
    const dependencies = createDependencies();
    const workflow = createDjDeckLoadWorkflow(dependencies);

    await workflow.loadDeckRadio("deck-a", {
      id: "station-1",
      name: "Station 1",
      streamUrl: "https://radio.example/one.mp3",
    });
    onAudioState({
      isPlaying: true,
      isLoading: false,
      isBuffering: false,
      hasEnded: false,
      volume: 1,
      error: null,
    });

    expect(dependencies.applyStoredEffectsAndFilters).toHaveBeenCalledWith(
      manager,
      "left_station-1",
      expect.arrayContaining([expect.objectContaining({ id: "delay-1" })]),
      expect.objectContaining({ type: "highpass", enabled: true })
    );
    expect(dependencies.applyStoredChannelStrip).toHaveBeenCalledWith(
      manager,
      "left_station-1",
      true,
      -0.35,
      1.1,
      0.25,
      0.6
    );
    expect(dependencies.connectDeckCueBus).toHaveBeenCalledWith(
      "deck-a",
      "left_station-1",
      dependencies.getAudioManager
    );
  });

  test("defers Web Audio routing until playback is active", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();
    updatePlaybackChannel("dj", "deck-a", (draft) => {
      draft.cueEnabled = true;
    });

    const manager = AudioManager.getInstance();
    manager.createSound = mock(
      (_radio, soundId?: string) => soundId ?? "sound"
    );
    manager.cleanupSound = mock((_soundId: string) => undefined);
    manager.getPreFaderNode = mock(
      () => ({ connect: mock() }) as unknown as GainNode
    );
    let onAudioState: (audioState: AudioState) => void = () => {
      throw new Error("Audio state subscriber was not registered");
    };
    manager.subscribe = mock((_soundId, callback) => {
      onAudioState = callback;
      return mock(() => undefined);
    });
    manager.subscribeMeter = mock((_soundId, _callback) =>
      mock(() => undefined)
    );
    const dependencies = createDependencies();
    const workflow = createDjDeckLoadWorkflow(dependencies);

    await workflow.loadDeckRadio("deck-a", {
      id: "station-1",
      name: "Station 1",
      streamUrl: "https://radio.example/one.mp3",
    });

    expect(dependencies.connectDeckCueBus).not.toHaveBeenCalled();
    expect(dependencies.initializeAudioDevices).not.toHaveBeenCalled();

    onAudioState({
      isPlaying: true,
      isLoading: false,
      isBuffering: false,
      hasEnded: false,
      volume: 1,
      error: null,
    });
    await Promise.resolve();

    expect(dependencies.connectDeckCueBus).toHaveBeenCalledWith(
      "deck-a",
      "left_station-1",
      dependencies.getAudioManager
    );
    expect(dependencies.initializeAudioDevices).toHaveBeenCalledWith(
      dependencies.getAudioManager,
      dependencies.reportDjError
    );
  });

  test("reconnects cue routing after playback creates a pre-fader node", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();
    updatePlaybackChannel("dj", "deck-a", (draft) => {
      draft.cueEnabled = true;
    });

    const manager = AudioManager.getInstance();
    let onAudioState: (audioState: AudioState) => void = () => {
      throw new Error("Audio state subscriber was not registered");
    };
    let preFaderNode: GainNode | null = null;
    const cueConnectionHadNode: boolean[] = [];
    manager.createSound = mock(
      (_radio, soundId?: string) => soundId ?? "sound"
    );
    manager.cleanupSound = mock((_soundId: string) => undefined);
    manager.getPreFaderNode = mock((_soundId: string) => preFaderNode);
    manager.subscribe = mock((_soundId, callback) => {
      onAudioState = callback;
      return mock(() => undefined);
    });
    manager.subscribeMeter = mock((_soundId, _callback) =>
      mock(() => undefined)
    );
    const dependencies = {
      ...createDependencies(),
      connectDeckCueBus: mock((_deckId, soundId, getAudioManager) => {
        cueConnectionHadNode.push(
          getAudioManager().getPreFaderNode(soundId) !== null
        );
      }),
    };
    const workflow = createDjDeckLoadWorkflow(dependencies);

    await workflow.loadDeckRadio("deck-a", {
      id: "station-1",
      name: "Station 1",
      streamUrl: "https://radio.example/one.mp3",
    });
    onAudioState({
      isPlaying: true,
      isLoading: false,
      isBuffering: false,
      hasEnded: false,
      volume: 1,
      error: null,
    });
    preFaderNode = {
      connect: mock(() => undefined),
      disconnect: mock(() => undefined),
    } as unknown as GainNode;
    onAudioState({
      isPlaying: true,
      isLoading: false,
      isBuffering: false,
      hasEnded: false,
      volume: 1,
      error: null,
    });

    expect(cueConnectionHadNode).toEqual([true]);
  });

  test("keeps cue routing restored when saved output device initialization fails", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();
    updatePlaybackChannel("dj", "deck-a", (draft) => {
      draft.cueEnabled = true;
    });

    const manager = AudioManager.getInstance();
    manager.createSound = mock(
      (_radio, soundId?: string) => soundId ?? "sound"
    );
    manager.cleanupSound = mock((_soundId: string) => undefined);
    manager.getPreFaderNode = mock(
      () => ({ connect: mock() }) as unknown as GainNode
    );
    let onAudioState: (audioState: AudioState) => void = () => {
      throw new Error("Audio state subscriber was not registered");
    };
    manager.subscribe = mock((_soundId, callback) => {
      onAudioState = callback;
      return mock(() => undefined);
    });
    manager.subscribeMeter = mock((_soundId, _callback) =>
      mock(() => undefined)
    );
    const outputError = new Error("setSinkId failed");
    const dependencies = {
      ...createDependencies(),
      initializeAudioDevices: mock(() => Promise.reject(outputError)),
    };
    const originalWarn = console.warn;
    console.warn = mock(() => undefined);

    try {
      const workflow = createDjDeckLoadWorkflow(dependencies);

      await workflow.loadDeckRadio("deck-a", {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      });
      onAudioState({
        isPlaying: true,
        isLoading: false,
        isBuffering: false,
        hasEnded: false,
        volume: 1,
        error: null,
      });
      await Promise.resolve();

      expect(getPlaybackChannel("dj", "deck-a")?.radio).toEqual(
        expect.objectContaining({ id: "station-1" })
      );
      expect(dependencies.connectDeckCueBus).toHaveBeenCalledWith(
        "deck-a",
        "left_station-1",
        dependencies.getAudioManager
      );
      expect(dependencies.reportDjError).not.toHaveBeenCalledWith(
        "Failed to load deck-a",
        "DJ_LOAD_DECK_FAILED",
        outputError,
        expect.anything()
      );
    } finally {
      console.warn = originalWarn;
    }
  });

  test("plays a loaded deck through the lifecycle boundary with persisted volume", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();
    updatePlaybackChannel("dj", "deck-a", (draft) => {
      draft.radio = {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      };
      draft.volume = 0.42;
    });

    const manager = AudioManager.getInstance();
    manager.createSound = mock(
      (_radio, soundId?: string) => soundId ?? "sound"
    );
    manager.cleanupSound = mock((_soundId: string) => undefined);
    manager.subscribe = mock((_soundId, _callback) => mock(() => undefined));
    manager.subscribeMeter = mock((_soundId, _callback) =>
      mock(() => undefined)
    );
    const dependencies = createDependencies();
    const workflow = createDjDeckLoadWorkflow(dependencies);

    await workflow.loadDeckRadio("deck-a", {
      id: "station-1",
      name: "Station 1",
      streamUrl: "https://radio.example/one.mp3",
    });
    await workflow.playDeck("deck-a");

    expect(dependencies.playDeckSound).toHaveBeenCalledWith(
      "left_station-1",
      0.42
    );
    expect(dependencies.applyCrossfade).toHaveBeenCalledTimes(1);
  });

  test("clears stale DJ errors after a loaded deck starts playing again", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();
    updatePlaybackChannel("dj", "deck-a", (draft) => {
      draft.radio = {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      };
      draft.volume = 0.42;
    });

    const manager = AudioManager.getInstance();
    manager.createSound = mock(
      (_radio, soundId?: string) => soundId ?? "sound"
    );
    manager.cleanupSound = mock((_soundId: string) => undefined);
    manager.subscribe = mock((_soundId, _callback) => mock(() => undefined));
    manager.subscribeMeter = mock((_soundId, _callback) =>
      mock(() => undefined)
    );
    const dependencies = createDependencies();
    const workflow = createDjDeckLoadWorkflow(dependencies);

    await workflow.loadDeckRadio("deck-a", {
      id: "station-1",
      name: "Station 1",
      streamUrl: "https://radio.example/one.mp3",
    });
    (dependencies.clearDjError as ReturnType<typeof mock>).mockClear();

    await workflow.playDeck("deck-a");

    expect(dependencies.playDeckSound).toHaveBeenCalledWith(
      "left_station-1",
      0.42
    );
    expect(dependencies.clearDjError).toHaveBeenCalledTimes(1);
  });

  test("does not clear newer DJ errors from a stale deck play completion", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();
    updatePlaybackChannel("dj", "deck-a", (draft) => {
      draft.radio = {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      };
      draft.volume = 0.42;
    });

    const manager = AudioManager.getInstance();
    manager.createSound = mock(
      (_radio, soundId?: string) => soundId ?? "sound"
    );
    manager.cleanupSound = mock((_soundId: string) => undefined);
    manager.subscribe = mock((_soundId, _callback) => mock(() => undefined));
    manager.subscribeMeter = mock((_soundId, _callback) =>
      mock(() => undefined)
    );
    let resolvePlay: () => void = () => undefined;
    const playFinished = new Promise<void>((resolve) => {
      resolvePlay = resolve;
    });
    const dependencies = {
      ...createDependencies(),
      playDeckSound: mock(() => playFinished),
    };
    const workflow = createDjDeckLoadWorkflow(dependencies);

    await workflow.loadDeckRadio("deck-a", {
      id: "station-1",
      name: "Station 1",
      streamUrl: "https://radio.example/one.mp3",
    });

    const replay = workflow.playDeck("deck-a");
    await Promise.resolve();
    await workflow.loadDeckRadio("deck-a", {
      id: "station-2",
      name: "Station 2",
      streamUrl: "https://radio.example/two.mp3",
    });
    (dependencies.clearDjError as ReturnType<typeof mock>).mockClear();
    (dependencies.applyCrossfade as ReturnType<typeof mock>).mockClear();

    resolvePlay();
    await replay;

    expect(dependencies.playDeckSound).toHaveBeenCalledWith(
      "left_station-1",
      0.42
    );
    expect(dependencies.clearDjError).not.toHaveBeenCalled();
    expect(dependencies.applyCrossfade).not.toHaveBeenCalled();
  });

  test("does not clear newer DJ errors from overlapping play attempts for the same deck", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();
    updatePlaybackChannel("dj", "deck-a", (draft) => {
      draft.radio = {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      };
      draft.volume = 0.42;
    });

    const manager = AudioManager.getInstance();
    manager.createSound = mock(
      (_radio, soundId?: string) => soundId ?? "sound"
    );
    manager.cleanupSound = mock((_soundId: string) => undefined);
    manager.subscribe = mock((_soundId, _callback) => mock(() => undefined));
    manager.subscribeMeter = mock((_soundId, _callback) =>
      mock(() => undefined)
    );
    let resolveFirstPlay: () => void = () => undefined;
    const firstPlayFinished = new Promise<void>((resolve) => {
      resolveFirstPlay = resolve;
    });
    const secondPlayError = new Error("newer play failed");
    let playCalls = 0;
    const dependencies = {
      ...createDependencies(),
      playDeckSound: mock(() => {
        playCalls += 1;
        return playCalls === 1
          ? firstPlayFinished
          : Promise.reject(secondPlayError);
      }),
    };
    const workflow = createDjDeckLoadWorkflow(dependencies);

    await workflow.loadDeckRadio("deck-a", {
      id: "station-1",
      name: "Station 1",
      streamUrl: "https://radio.example/one.mp3",
    });
    (dependencies.clearDjError as ReturnType<typeof mock>).mockClear();
    (dependencies.applyCrossfade as ReturnType<typeof mock>).mockClear();

    const firstReplay = workflow.playDeck("deck-a");
    await Promise.resolve();
    await workflow.playDeck("deck-a");

    expect(dependencies.reportDjError).toHaveBeenCalledWith(
      "Failed to play deck-a",
      "DJ_PLAY_DECK_FAILED",
      secondPlayError,
      expect.objectContaining({ id: "station-1" }),
      "deck-a"
    );

    resolveFirstPlay();
    await firstReplay;

    expect(dependencies.playDeckSound).toHaveBeenCalledTimes(2);
    expect(dependencies.clearDjError).not.toHaveBeenCalled();
    expect(dependencies.applyCrossfade).not.toHaveBeenCalled();
  });

  test("does not clear DJ errors from a play completion after pause", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();
    updatePlaybackChannel("dj", "deck-a", (draft) => {
      draft.radio = {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      };
      draft.volume = 0.42;
    });

    const manager = AudioManager.getInstance();
    manager.createSound = mock(
      (_radio, soundId?: string) => soundId ?? "sound"
    );
    manager.cleanupSound = mock((_soundId: string) => undefined);
    manager.subscribe = mock((_soundId, _callback) => mock(() => undefined));
    manager.subscribeMeter = mock((_soundId, _callback) =>
      mock(() => undefined)
    );
    let resolvePlay: () => void = () => undefined;
    const playFinished = new Promise<void>((resolve) => {
      resolvePlay = resolve;
    });
    const dependencies = {
      ...createDependencies(),
      playDeckSound: mock(() => playFinished),
    };
    const workflow = createDjDeckLoadWorkflow(dependencies);

    await workflow.loadDeckRadio("deck-a", {
      id: "station-1",
      name: "Station 1",
      streamUrl: "https://radio.example/one.mp3",
    });
    (dependencies.clearDjError as ReturnType<typeof mock>).mockClear();
    (dependencies.applyCrossfade as ReturnType<typeof mock>).mockClear();

    const replay = workflow.playDeck("deck-a");
    await Promise.resolve();
    workflow.pauseDeck("deck-a");
    resolvePlay();
    await replay;

    expect(dependencies.pauseDeckSound).toHaveBeenCalledWith("left_station-1");
    expect(dependencies.clearDjError).not.toHaveBeenCalled();
    expect(dependencies.applyCrossfade).not.toHaveBeenCalled();
  });

  test("pauses and seeks a loaded deck through the lifecycle boundary", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    const manager = AudioManager.getInstance();
    manager.createSound = mock(
      (_radio, soundId?: string) => soundId ?? "sound"
    );
    manager.cleanupSound = mock((_soundId: string) => undefined);
    manager.subscribe = mock((_soundId, _callback) => mock(() => undefined));
    manager.subscribeMeter = mock((_soundId, _callback) =>
      mock(() => undefined)
    );
    const dependencies = createDependencies();
    const workflow = createDjDeckLoadWorkflow(dependencies);

    workflow.pauseDeck("deck-a");
    workflow.seekDeck("deck-a", 12);

    await workflow.loadDeckRadio("deck-a", {
      id: "station-1",
      name: "Station 1",
      streamUrl: "https://radio.example/one.mp3",
    });
    workflow.pauseDeck("deck-a");
    workflow.seekDeck("deck-a", 42);

    expect(dependencies.pauseDeckSound).toHaveBeenCalledTimes(1);
    expect(dependencies.pauseDeckSound).toHaveBeenCalledWith("left_station-1");
    expect(dependencies.seekDeckSound).toHaveBeenCalledTimes(1);
    expect(dependencies.seekDeckSound).toHaveBeenCalledWith(
      "left_station-1",
      42
    );
  });

  test("reports deck play failures through the user-safe DJ error path", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();
    const reportedErrors: PlaybackActionError[] = [];
    const rawError = new Error("decoder vendor stack details");

    const manager = AudioManager.getInstance();
    manager.createSound = mock(
      (_radio, soundId?: string) => soundId ?? "sound"
    );
    manager.cleanupSound = mock((_soundId: string) => undefined);
    manager.subscribe = mock((_soundId, _callback) => mock(() => undefined));
    manager.subscribeMeter = mock((_soundId, _callback) =>
      mock(() => undefined)
    );
    const dependencies = {
      ...createDependencies(),
      playDeckSound: mock(() => Promise.reject(rawError)),
      reportPlaybackError: mock((error: PlaybackActionError) => {
        reportedErrors.push(error);
      }),
    };
    const workflow = createDjDeckLoadWorkflow(dependencies);

    await workflow.loadDeckRadio("deck-a", {
      id: "station-1",
      name: "Station 1",
      streamUrl: "https://radio.example/one.mp3",
    });
    await workflow.playDeck("deck-a");

    expect(reportedErrors).toHaveLength(1);
    expect(reportedErrors[0]?.userMessage).toBe("Failed to play deck-a");
    expect(reportedErrors[0]?.rawMessage).toBe(rawError.message);
    expect(dependencies.reportDjError).toHaveBeenCalledWith(
      "Failed to play deck-a",
      "DJ_PLAY_DECK_FAILED",
      rawError,
      expect.objectContaining({ id: "station-1" }),
      "deck-a"
    );
  });

  test("repeats an ended deck through the lifecycle transport boundary", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();
    updatePlaybackChannel("dj", "deck-a", (draft) => {
      draft.volume = 0.64;
      draft.repeat = true;
    });

    const manager = AudioManager.getInstance();
    const { emitAudioState } = captureDeckAudioState(manager);
    manager.playSound = mock(async () => undefined);
    manager.seekSound = mock(() => undefined);
    const dependencies = createDependencies();
    const workflow = createDjDeckLoadWorkflow(dependencies);

    await workflow.loadDeckRadio("deck-a", {
      id: "station-1",
      name: "Station 1",
      streamUrl: "https://radio.example/one.mp3",
    });
    emitAudioState({
      isPlaying: true,
      isLoading: false,
      isBuffering: false,
      hasEnded: false,
      volume: 1,
      error: null,
    });
    emitAudioState({
      isPlaying: false,
      isLoading: false,
      isBuffering: false,
      hasEnded: true,
      volume: 1,
      error: null,
    });
    await flushContinuation();
    emitAudioState({
      isPlaying: true,
      isLoading: false,
      isBuffering: false,
      hasEnded: false,
      volume: 1,
      error: null,
    });

    expect(dependencies.seekDeckSound).toHaveBeenCalledWith(
      "left_station-1",
      0
    );
    expect(dependencies.playDeckSound).toHaveBeenCalledWith(
      "left_station-1",
      0.64
    );
    expect(manager.seekSound).not.toHaveBeenCalled();
    expect(manager.playSound).not.toHaveBeenCalled();
    expect(dependencies.applyCrossfade).toHaveBeenCalledTimes(1);
    expect(dependencies.applyStoredChannelStrip).toHaveBeenCalledTimes(2);
    expect(dependencies.applyStoredEffectsAndFilters).toHaveBeenCalledTimes(2);
  });

  test("autoplays the next playable collection item through the lifecycle boundary", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    const manager = AudioManager.getInstance();
    const { emitAudioState } = captureDeckAudioState(manager);
    const dependencies = createDependencies();
    const workflow = createDjDeckLoadWorkflow(dependencies);

    await workflow.loadDeckRadio("deck-a", createPlaylistRadio());
    emitAudioState({
      isPlaying: false,
      isLoading: false,
      isBuffering: false,
      hasEnded: true,
      volume: 1,
      error: null,
    });
    await flushContinuation();

    expect(dependencies.loadTrack).toHaveBeenCalledWith(
      "left",
      expect.objectContaining({
        id: "playlist-1",
        streamUrl: "https://radio.example/next.mp3",
      }),
      true
    );
  });

  test("resolves lazy YouTube autoplay URLs through the lifecycle platform port", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    const youtubePlaylist: Radio = {
      id: "youtube-playlist-1",
      name: "YouTube Playlist",
      streamUrl: "https://youtube.example/current.mp3",
      platformMetadata: {
        platform: "youtube",
        itemType: "playlist",
        url: "https://youtube.example/playlist?list=abc123",
        playlistId: "abc123",
        tracks: [
          {
            name: "Current",
            streamUrl: "https://youtube.example/current.mp3",
            videoId: "current-video",
          },
          {
            name: "Next",
            streamUrl: "",
            videoId: "next-video",
          },
        ],
      },
    };
    const manager = AudioManager.getInstance();
    const { emitAudioState } = captureDeckAudioState(manager);
    const dependencies = {
      ...createDependencies(),
      resolvePlatformStreamUrl: mock(() =>
        Promise.resolve(
          resolvedStream("https://youtube.example/resolved-next.mp3")
        )
      ),
    };
    const workflow = createDjDeckLoadWorkflow(dependencies);

    await workflow.loadDeckRadio("deck-a", youtubePlaylist);
    emitAudioState({
      isPlaying: false,
      isLoading: false,
      isBuffering: false,
      hasEnded: true,
      volume: 1,
      error: null,
    });
    await flushContinuation();

    expect(dependencies.resolvePlatformStreamUrl).toHaveBeenCalledWith({
      platform: "youtube",
      reason: "playlist-next",
      videoId: "next-video",
      radio: youtubePlaylist,
    });
    expect(dependencies.loadTrack).toHaveBeenCalledWith(
      "left",
      expect.objectContaining({
        streamUrl: "https://youtube.example/resolved-next.mp3",
      }),
      true
    );
  });

  test("resolves initial YouTube source URLs through source intent dispatch", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    const youtubeRadio: Radio = {
      id: "youtube-video-1",
      name: "YouTube Video",
      streamUrl: "yt:video-1",
      platformMetadata: {
        platform: "youtube",
        itemType: "video",
        url: "https://youtube.example/watch?v=video-1",
        videoId: "video-1",
        duration: 120,
      },
    };
    const manager = AudioManager.getInstance();
    manager.createSound = mock(
      (_radio, soundId?: string) => soundId ?? "sound"
    );
    manager.cleanupSound = mock((_soundId: string) => undefined);
    manager.subscribe = mock((_soundId, _callback) => mock(() => undefined));
    manager.subscribeMeter = mock((_soundId, _callback) =>
      mock(() => undefined)
    );
    const dependencies = {
      ...createDependencies(),
      resolvePlatformStreamUrl: mock(() =>
        Promise.resolve(
          resolvedStream("https://youtube.example/resolved-video.mp3")
        )
      ),
    };
    const workflow = createDjDeckLoadWorkflow(dependencies);

    await workflow.loadDeckSource("deck-a", {
      type: "track",
      radio: youtubeRadio,
      autoPlay: false,
    });

    expect(dependencies.resolvePlatformStreamUrl).toHaveBeenCalledWith({
      platform: "youtube",
      reason: "initial-load",
      videoId: "video-1",
      radio: youtubeRadio,
    });
    expect(getPlaybackChannel("dj", "deck-a")?.radio).toEqual(
      expect.objectContaining({
        id: "youtube-video-1",
        streamUrl: "https://youtube.example/resolved-video.mp3",
      })
    );
  });

  test("reports failed initial YouTube source resolution without throwing", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    const rawError = new Error("resolver unavailable");
    const manager = AudioManager.getInstance();
    manager.createSound = mock(
      (_radio, soundId?: string) => soundId ?? "sound"
    );
    manager.cleanupSound = mock((_soundId: string) => undefined);
    manager.subscribe = mock((_soundId, _callback) => mock(() => undefined));
    manager.subscribeMeter = mock((_soundId, _callback) =>
      mock(() => undefined)
    );
    const dependencies = {
      ...createDependencies(),
      resolvePlatformStreamUrl: mock(() => Promise.reject(rawError)),
    };
    const workflow = createDjDeckLoadWorkflow(dependencies);

    await workflow.loadDeckSource("deck-a", {
      type: "track",
      radio: {
        id: "youtube-video-1",
        name: "YouTube Video",
        streamUrl: "yt:video-1",
        platformMetadata: {
          platform: "youtube",
          itemType: "video",
          url: "https://youtube.example/watch?v=video-1",
          videoId: "video-1",
          duration: 120,
        },
      },
      autoPlay: false,
    });

    expect(dependencies.reportDjError).toHaveBeenCalledWith(
      "Failed to resolve YouTube stream",
      "DJ_YOUTUBE_RESOLVE_FAILED",
      rawError,
      expect.objectContaining({ id: "youtube-video-1" }),
      "deck-a"
    );
    expect(getPlaybackChannel("dj", "deck-a")?.radio).toBeNull();
  });

  test("does not let stale initial YouTube resolution overwrite a newer source load", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    const manager = AudioManager.getInstance();
    manager.createSound = mock(
      (_radio, soundId?: string) => soundId ?? "sound"
    );
    manager.cleanupSound = mock((_soundId: string) => undefined);
    manager.subscribe = mock((_soundId, _callback) => mock(() => undefined));
    manager.subscribeMeter = mock((_soundId, _callback) =>
      mock(() => undefined)
    );
    const pendingResolve = {
      resolve: null as ((value: PlatformStreamResolution) => void) | null,
    };
    const dependencies = {
      ...createDependencies(),
      resolvePlatformStreamUrl: mock(
        () =>
          new Promise<PlatformStreamResolution>((resolve) => {
            pendingResolve.resolve = resolve;
          })
      ),
    };
    const workflow = createDjDeckLoadWorkflow(dependencies);

    const staleLoad = workflow.loadDeckSource("deck-a", {
      type: "track",
      radio: {
        id: "youtube-video-1",
        name: "YouTube Video",
        streamUrl: "yt:video-1",
        platformMetadata: {
          platform: "youtube",
          itemType: "video",
          url: "https://youtube.example/watch?v=video-1",
          videoId: "video-1",
          duration: 120,
        },
      },
      autoPlay: false,
    });
    await Promise.resolve();

    await workflow.loadDeckSource("deck-a", {
      type: "radio",
      radio: {
        id: "station-2",
        name: "Station 2",
        streamUrl: "https://radio.example/two.mp3",
      },
    });

    if (!pendingResolve.resolve) {
      throw new Error("Expected YouTube resolver to start");
    }
    pendingResolve.resolve(
      resolvedStream("https://youtube.example/resolved-video.mp3")
    );
    await staleLoad;

    expect(getPlaybackChannel("dj", "deck-a")?.radio).toEqual(
      expect.objectContaining({
        id: "station-2",
        streamUrl: "https://radio.example/two.mp3",
      })
    );
  });

  test("does not let stale track URL resolution overwrite a newer source load", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    const manager = AudioManager.getInstance();
    manager.createSound = mock(
      (_radio, soundId?: string) => soundId ?? "sound"
    );
    manager.cleanupSound = mock((_soundId: string) => undefined);
    manager.subscribe = mock((_soundId, _callback) => mock(() => undefined));
    manager.subscribeMeter = mock((_soundId, _callback) =>
      mock(() => undefined)
    );
    const pendingResolve = {
      resolve: null as ((value: PlatformStreamResolution) => void) | null,
    };
    const dependencies = {
      ...createDependencies(),
      resolvePlatformStreamUrl: mock(
        () =>
          new Promise<PlatformStreamResolution>((resolve) => {
            pendingResolve.resolve = resolve;
          })
      ),
    };
    const workflow = createDjDeckLoadWorkflow(dependencies);
    const youtubePlaylist: Radio = {
      id: "youtube-playlist-1",
      name: "YouTube Playlist",
      streamUrl: "https://youtube.example/current.mp3",
      platformMetadata: {
        platform: "youtube",
        itemType: "playlist",
        url: "https://youtube.example/playlist",
        playlistId: "playlist-1",
        name: "YouTube Playlist",
        tracks: [
          {
            name: "Next Video",
            streamUrl: "yt:next-video",
            videoId: "next-video",
          },
        ],
      },
    };

    const staleLoad = workflow.loadDeckSource("deck-a", {
      type: "track-url",
      radio: youtubePlaylist,
      streamUrl: "yt:next-video",
      autoPlay: true,
    });
    await Promise.resolve();

    await workflow.loadDeckSource("deck-a", {
      type: "radio",
      radio: {
        id: "station-2",
        name: "Station 2",
        streamUrl: "https://radio.example/two.mp3",
      },
    });

    if (!pendingResolve.resolve) {
      throw new Error("Expected YouTube resolver to start");
    }
    pendingResolve.resolve(
      resolvedStream("https://youtube.example/resolved-next.mp3")
    );
    await staleLoad;

    expect(getPlaybackChannel("dj", "deck-a")?.radio).toEqual(
      expect.objectContaining({
        id: "station-2",
        streamUrl: "https://radio.example/two.mp3",
      })
    );
  });

  test("does not report stale initial YouTube resolution failures", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    const rawError = new Error("resolver unavailable");
    const manager = AudioManager.getInstance();
    manager.createSound = mock(
      (_radio, soundId?: string) => soundId ?? "sound"
    );
    manager.cleanupSound = mock((_soundId: string) => undefined);
    manager.subscribe = mock((_soundId, _callback) => mock(() => undefined));
    manager.subscribeMeter = mock((_soundId, _callback) =>
      mock(() => undefined)
    );
    const pendingReject = {
      reject: null as ((error: Error) => void) | null,
    };
    const dependencies = {
      ...createDependencies(),
      resolvePlatformStreamUrl: mock(
        () =>
          new Promise<PlatformStreamResolution>((_resolve, reject) => {
            pendingReject.reject = reject;
          })
      ),
    };
    const workflow = createDjDeckLoadWorkflow(dependencies);

    const staleLoad = workflow.loadDeckSource("deck-a", {
      type: "track",
      radio: {
        id: "youtube-video-1",
        name: "YouTube Video",
        streamUrl: "yt:video-1",
        platformMetadata: {
          platform: "youtube",
          itemType: "video",
          url: "https://youtube.example/watch?v=video-1",
          videoId: "video-1",
          duration: 120,
        },
      },
      autoPlay: false,
    });
    await Promise.resolve();

    await workflow.loadDeckSource("deck-a", {
      type: "radio",
      radio: {
        id: "station-2",
        name: "Station 2",
        streamUrl: "https://radio.example/two.mp3",
      },
    });

    if (!pendingReject.reject) {
      throw new Error("Expected YouTube resolver to start");
    }
    pendingReject.reject(rawError);
    await staleLoad;

    expect(dependencies.reportDjError).not.toHaveBeenCalledWith(
      "Failed to resolve YouTube stream",
      "DJ_YOUTUBE_RESOLVE_FAILED",
      rawError,
      expect.objectContaining({ id: "youtube-video-1" }),
      "deck-a"
    );
    expect(getPlaybackChannel("dj", "deck-a")?.radio).toEqual(
      expect.objectContaining({
        id: "station-2",
        streamUrl: "https://radio.example/two.mp3",
      })
    );
  });

  test("refreshes an interrupted YouTube stream through the lifecycle platform port", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    const youtubeRadio: Radio = {
      id: "youtube-video-1",
      name: "YouTube Video",
      streamUrl: "https://youtube.example/stale.mp3",
      platformMetadata: {
        platform: "youtube",
        itemType: "video",
        url: "https://youtube.example/watch?v=video-1",
        videoId: "video-1",
      },
    };
    const manager = AudioManager.getInstance();
    const { emitAudioState } = captureDeckAudioState(manager);
    manager.refreshStreamUrl = mock(
      async (_soundId: string, _newUrl: string, _position?: number) => undefined
    );
    const dependencies = {
      ...createDependencies(),
      resolvePlatformStreamUrl: mock(() =>
        Promise.resolve(resolvedStream("https://youtube.example/fresh.mp3"))
      ),
    };
    const workflow = createDjDeckLoadWorkflow(dependencies);

    await workflow.loadDeckRadio("deck-a", youtubeRadio);
    emitAudioState({
      isPlaying: false,
      isLoading: false,
      isBuffering: false,
      hasEnded: false,
      volume: 1,
      error: {
        id: "stream-interrupted",
        code: "STREAM_INTERRUPTED",
        message: "provider stream interrupted",
        position: 42,
        timestamp: 1,
      },
    });
    await flushContinuation();

    expect(dependencies.resolvePlatformStreamUrl).toHaveBeenCalledWith({
      platform: "youtube",
      reason: "stream-refresh",
      videoId: "video-1",
      radio: youtubeRadio,
    });
    expect(manager.refreshStreamUrl).toHaveBeenCalledWith(
      "left_youtube-video-1",
      "https://youtube.example/fresh.mp3",
      42,
      "progressive"
    );
    expect(dependencies.clearDjError).toHaveBeenCalledTimes(2);
    expect(dependencies.applyCrossfade).toHaveBeenCalledTimes(1);
    expect(getPlaybackChannelRuntime("deck-a").error).toBeNull();
  });

  test.each([
    [
      "SoundCloud",
      "soundcloud",
      "https://soundcloud.com/artist/canonical-track",
      "https://soundcloud-media.example/expired.mp3",
      "https://soundcloud-media.example/fresh.mp3",
    ],
    [
      "Bandcamp",
      "bandcamp",
      "https://artist.bandcamp.com/track/canonical-track",
      "https://bandcamp-media.example/expired.mp3",
      "https://bandcamp-media.example/fresh.mp3",
    ],
  ] as const)("refreshes an interrupted %s deck through the lifecycle platform port", async (label, platform, canonicalUrl, expiredUrl, freshUrl) => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    const platformMetadata = {
      itemType: "track" as const,
      platform,
      url: canonicalUrl,
    };
    const platformRadio: Radio = {
      id: `${platform}-track-1`,
      name: `${label} track`,
      platformMetadata,
      streamUrl: expiredUrl,
    };
    const manager = AudioManager.getInstance();
    const { emitAudioState } = captureDeckAudioState(manager);
    manager.refreshStreamUrl = mock(
      async (_soundId: string, _newUrl: string, _position?: number) => undefined
    );
    const dependencies = {
      ...createDependencies(),
      resolvePlatformStreamUrl: mock(() =>
        Promise.resolve(resolvedStream(freshUrl))
      ),
    };
    const workflow = createDjDeckLoadWorkflow(dependencies);

    await workflow.loadDeckRadio("deck-a", platformRadio);
    emitAudioState({
      error: {
        code: "STREAM_INTERRUPTED",
        id: "stream-interrupted",
        message: "provider stream interrupted",
        position: 27,
        timestamp: 1,
      },
      hasEnded: false,
      isBuffering: false,
      isLoading: false,
      isPlaying: false,
      volume: 1,
    });
    await flushContinuation();

    expect(dependencies.resolvePlatformStreamUrl).toHaveBeenCalledWith({
      canonicalUrl,
      platform,
      radio: platformRadio,
      reason: "stream-refresh",
    });
    expect(manager.refreshStreamUrl).toHaveBeenCalledWith(
      `left_${platform}-track-1`,
      freshUrl,
      27,
      "progressive"
    );
    expect(getPlaybackChannelRuntime("deck-a").error).toBeNull();
  });

  test("reports a safe error when interrupted YouTube refresh returns no stream", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    const manager = AudioManager.getInstance();
    const { emitAudioState } = captureDeckAudioState(manager);
    manager.refreshStreamUrl = mock(
      async (_soundId: string, _newUrl: string, _position?: number) => undefined
    );
    const dependencies = {
      ...createDependencies(),
      resolvePlatformStreamUrl: mock(() => Promise.resolve(null)),
    };
    const workflow = createDjDeckLoadWorkflow(dependencies);

    await workflow.loadDeckRadio("deck-a", {
      id: "youtube-video-1",
      name: "YouTube Video",
      streamUrl: "https://youtube.example/stale.mp3",
      platformMetadata: {
        platform: "youtube",
        itemType: "video",
        url: "https://youtube.example/watch?v=video-1",
        videoId: "video-1",
      },
    });
    emitAudioState({
      isPlaying: false,
      isLoading: false,
      isBuffering: false,
      hasEnded: false,
      volume: 1,
      error: {
        id: "stream-interrupted",
        code: "STREAM_INTERRUPTED",
        message: "provider stream interrupted",
        position: 42,
        timestamp: 1,
      },
    });
    await flushContinuation();

    expect(manager.refreshStreamUrl).not.toHaveBeenCalled();
    expect(dependencies.reportDjError).toHaveBeenCalledWith(
      "Failed to refresh YouTube stream - please reload",
      "DJ_YOUTUBE_REFRESH_FAILED",
      undefined,
      expect.objectContaining({ id: "youtube-video-1" }),
      "deck-a"
    );
    expect(getPlaybackChannelRuntime("deck-a").error).toEqual(
      expect.objectContaining({ code: "STREAM_INTERRUPTED" })
    );
  });

  test("reports resolver failures without exposing provider details", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    const rawError = new Error("provider token leaked abc123");
    const manager = AudioManager.getInstance();
    const { emitAudioState } = captureDeckAudioState(manager);
    manager.refreshStreamUrl = mock(
      async (_soundId: string, _newUrl: string, _position?: number) => undefined
    );
    const dependencies = {
      ...createDependencies(),
      reportPlaybackError: mock((_error: PlaybackActionError) => undefined),
      resolvePlatformStreamUrl: mock(() => Promise.reject(rawError)),
    };
    const workflow = createDjDeckLoadWorkflow(dependencies);

    await workflow.loadDeckRadio("deck-a", {
      id: "youtube-video-1",
      name: "YouTube Video",
      streamUrl: "https://youtube.example/stale.mp3",
      platformMetadata: {
        platform: "youtube",
        itemType: "video",
        url: "https://youtube.example/watch?v=video-1",
        videoId: "video-1",
      },
    });
    emitAudioState({
      isPlaying: false,
      isLoading: false,
      isBuffering: false,
      hasEnded: false,
      volume: 1,
      error: {
        id: "stream-interrupted",
        code: "STREAM_INTERRUPTED",
        message: "provider stream interrupted",
        position: 42,
        timestamp: 1,
      },
    });
    await flushContinuation();

    expect(manager.refreshStreamUrl).not.toHaveBeenCalled();
    expect(dependencies.reportPlaybackError).toHaveBeenCalledWith(
      expect.objectContaining({
        rawMessage: rawError.message,
        userMessage: "Failed to refresh YouTube stream - please reload",
      })
    );
    expect(dependencies.reportDjError).toHaveBeenCalledWith(
      "Failed to refresh YouTube stream - please reload",
      "DJ_STREAM_REFRESH_FAILED",
      rawError,
      expect.objectContaining({ id: "youtube-video-1" }),
      "deck-a"
    );
  });

  test("ignores non-refreshable stream interruptions", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    const manager = AudioManager.getInstance();
    const { emitAudioState } = captureDeckAudioState(manager);
    manager.refreshStreamUrl = mock(
      async (_soundId: string, _newUrl: string, _position?: number) => undefined
    );
    const dependencies = {
      ...createDependencies(),
      resolvePlatformStreamUrl: mock(() =>
        Promise.resolve(resolvedStream("https://youtube.example/fresh.mp3"))
      ),
    };
    const workflow = createDjDeckLoadWorkflow(dependencies);

    await workflow.loadDeckRadio("deck-a", {
      id: "station-1",
      name: "Station 1",
      streamUrl: "https://radio.example/live.mp3",
    });
    emitAudioState({
      isPlaying: false,
      isLoading: false,
      isBuffering: false,
      hasEnded: false,
      volume: 1,
      error: {
        id: "stream-interrupted",
        code: "STREAM_INTERRUPTED",
        message: "stream interrupted",
        position: 42,
        timestamp: 1,
      },
    });
    await flushContinuation();

    expect(dependencies.resolvePlatformStreamUrl).not.toHaveBeenCalled();
    expect(manager.refreshStreamUrl).not.toHaveBeenCalled();
    expect(dependencies.reportDjError).not.toHaveBeenCalledWith(
      expect.any(String),
      "DJ_STREAM_REFRESH_FAILED",
      expect.anything(),
      expect.anything()
    );
  });

  test("does not continue when autoplay is disabled or no next track exists", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();
    updatePlaybackChannel("dj", "deck-a", (draft) => {
      draft.autoplay = false;
    });

    const manager = AudioManager.getInstance();
    const { emitAudioState } = captureDeckAudioState(manager);
    const dependencies = createDependencies();
    const workflow = createDjDeckLoadWorkflow(dependencies);

    await workflow.loadDeckRadio("deck-a", createPlaylistRadio());
    emitAudioState({
      isPlaying: false,
      isLoading: false,
      isBuffering: false,
      hasEnded: true,
      volume: 1,
      error: null,
    });
    await flushContinuation();

    expect(dependencies.loadTrack).not.toHaveBeenCalled();
    expect(dependencies.resolvePlatformStreamUrl).not.toHaveBeenCalled();
    expect(dependencies.reportDjError).not.toHaveBeenCalled();

    updatePlaybackChannel("dj", "deck-a", (draft) => {
      draft.autoplay = true;
      draft.radio = createPlaylistRadio({
        streamUrl: "https://radio.example/only.mp3",
        platformMetadata: {
          platform: "soundcloud",
          itemType: "playlist",
          url: "https://soundcloud.example/playlist",
          name: "Playlist 1",
          artist: "Artist",
          artwork: "",
          trackCount: 1,
          tracks: [
            {
              name: "Only",
              streamUrl: "https://radio.example/only.mp3",
              duration: 120,
            },
          ],
        },
      });
    });
    emitAudioState({
      isPlaying: false,
      isLoading: false,
      isBuffering: false,
      hasEnded: true,
      volume: 1,
      error: null,
    });
    await flushContinuation();

    expect(dependencies.loadTrack).not.toHaveBeenCalled();
    expect(dependencies.resolvePlatformStreamUrl).not.toHaveBeenCalled();
    expect(dependencies.reportDjError).not.toHaveBeenCalled();
  });

  test("reports continuation failures without corrupting loaded deck state", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    const rawError = new Error("vendor stream token details");
    const manager = AudioManager.getInstance();
    const { emitAudioState } = captureDeckAudioState(manager);
    const dependencies = {
      ...createDependencies(),
      loadTrack: mock(() => Promise.reject(rawError)),
      reportPlaybackError: mock((_error: PlaybackActionError) => undefined),
    };
    const workflow = createDjDeckLoadWorkflow(dependencies);

    await workflow.loadDeckRadio("deck-a", createPlaylistRadio());
    emitAudioState({
      isPlaying: false,
      isLoading: false,
      isBuffering: false,
      hasEnded: true,
      volume: 1,
      error: null,
    });
    await flushContinuation();

    expect(getPlaybackChannel("dj", "deck-a")?.radio).toEqual(
      expect.objectContaining({
        id: "playlist-1",
        streamUrl: "https://radio.example/current.mp3",
      })
    );
    expect(getPlaybackChannelRuntime("deck-a").soundId).toBe("left_playlist-1");
    expect(dependencies.reportPlaybackError).toHaveBeenCalledWith(
      expect.objectContaining({
        rawMessage: rawError.message,
        userMessage:
          "The stream could not be reached. Check the station URL and try again.",
      })
    );
    expect(dependencies.reportDjError).toHaveBeenCalledWith(
      "The stream could not be reached. Check the station URL and try again.",
      "DJ_LOAD_NEXT_TRACK_FAILED",
      rawError,
      expect.objectContaining({ id: "playlist-1" }),
      "deck-a"
    );
  });

  test("applies crossfade after deck volume changes through the lifecycle boundary", () => {
    const dependencies = createDependencies();
    const workflow = createDjDeckLoadWorkflow(dependencies);

    workflow.setDeckVolume("deck-a", 0.33);

    expect(dependencies.setDeckVolume).toHaveBeenCalledWith("deck-a", 0.33);
    expect(dependencies.applyCrossfade).toHaveBeenCalledTimes(1);
  });

  test("persists continuation flags through the lifecycle boundary", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();
    const workflow = createDjDeckLoadWorkflow(createDependencies());

    workflow.setDeckRepeat("deck-a", true);
    workflow.setDeckAutoplay("deck-a", false);

    expect(getPlaybackChannel("dj", "deck-a")).toEqual(
      expect.objectContaining({
        repeat: true,
        autoplay: false,
      })
    );
  });

  test("persists strip fields and reconciles the desired Effects state", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    const manager = AudioManager.getInstance();
    const calls: string[] = [];
    manager.muteSound = mock((_soundId: string) => {
      calls.push("mute");
    });
    manager.setPan = mock((_soundId: string, _pan: number) => {
      calls.push("pan");
    });
    manager.setPlaybackRate = mock((_soundId: string, _speed: number) => {
      calls.push("speed");
    });
    manager.setChannelFilter = mock((_soundId: string, _value: number) => {
      calls.push("channelFilter");
    });
    const effectsSnapshots: EffectConfig[][] = [];
    manager.reconcileEffects = mock((_soundId, desired) => {
      effectsSnapshots.push([...desired.tree]);
      return Promise.resolve({
        backend: "bypass" as const,
        ready: true,
        status: "ready" as const,
      });
    });
    manager.updateFilter = mock((_soundId, _filter) => {
      calls.push("filter");
    });
    const dependencies = createDependencies();
    const workflow = createDjDeckLoadWorkflow(dependencies);

    workflow.setDeckMute("deck-a", true);
    workflow.setDeckPan("deck-a", -0.2);
    workflow.setDeckSpeed("deck-a", 1.15);
    workflow.setDeckChannelFilter("deck-a", 0.35);
    workflow.setDeckEffectsDryWet("deck-a", 0.7);
    workflow.updateDeckFilter("deck-a", {
      type: "highpass",
      frequency: 300,
      Q: 1.5,
      gain: 2,
      enabled: true,
    });
    await flushContinuation();

    expect(calls).toEqual([]);

    await workflow.loadDeckRadio("deck-a", {
      id: "station-1",
      name: "Station 1",
      streamUrl: "https://radio.example/one.mp3",
    });
    workflow.setDeckMute("deck-a", true);
    workflow.setDeckPan("deck-a", -0.4);
    workflow.setDeckSpeed("deck-a", 1.25);
    workflow.setDeckChannelFilter("deck-a", 0.45);
    workflow.setDeckEffectsDryWet("deck-a", 0.5);
    workflow.updateDeckFilter("deck-a", {
      type: "highpass",
      frequency: 500,
      Q: 2,
      gain: 3,
      enabled: true,
    });

    expect(getPlaybackChannel("dj", "deck-a")).toEqual(
      expect.objectContaining({
        muted: true,
        pan: -0.4,
        speed: 1.25,
        channelFilter: 0.45,
        effectsDryWet: 0.5,
        filter: expect.objectContaining({
          type: "highpass",
          frequency: 500,
          Q: 2,
          gain: 3,
          enabled: true,
        }),
      })
    );
    expect(manager.muteSound).toHaveBeenCalledWith("left_station-1");
    expect(manager.setPan).toHaveBeenCalledWith("left_station-1", -0.4);
    expect(manager.setPlaybackRate).toHaveBeenCalledWith(
      "left_station-1",
      1.25
    );
    expect(manager.setChannelFilter).toHaveBeenCalledWith(
      "left_station-1",
      0.45
    );
    expect(manager.reconcileEffects).toHaveBeenLastCalledWith(
      "left_station-1",
      expect.objectContaining({ dryWet: 0.5 })
    );
    expect(effectsSnapshots.at(-1)).toEqual([]);
    expect(manager.updateFilter).toHaveBeenCalledWith(
      "left_station-1",
      expect.objectContaining({ type: "highpass", frequency: 500 })
    );
  });

  test("persists effect lifecycle changes and reconciles the resulting tree", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    const manager = AudioManager.getInstance();
    const effectsSnapshots: EffectConfig[][] = [];
    manager.reconcileEffects = mock((_soundId, desired) => {
      effectsSnapshots.push([...desired.tree]);
      return Promise.resolve({
        backend: "compatibility" as const,
        ready: true,
        status: "ready" as const,
      });
    });
    let nextEffectId = "delay-1";
    const dependencies = {
      ...createDependencies(),
      addDeckEffect: (deckId: DeckId, type: EffectType, effectId: string) =>
        addChannelEffect(
          "dj",
          deckId,
          createDefaultEffectConfig(type, effectId, 99)
        ),
      createEffectId: mock(() => nextEffectId),
    };
    const workflow = createDjDeckLoadWorkflow(dependencies);

    workflow.addDeckEffect("deck-a", "delay");

    expect(getPlaybackChannel("dj", "deck-a")?.effects).toEqual([
      expect.objectContaining({ id: "delay-1", order: 0 }),
    ]);
    expect(manager.reconcileEffects).not.toHaveBeenCalled();

    await workflow.loadDeckRadio("deck-a", {
      id: "station-1",
      name: "Station 1",
      streamUrl: "https://radio.example/one.mp3",
    });
    nextEffectId = "limiter-1";
    workflow.addDeckEffect("deck-a", "limiter");
    workflow.updateDeckEffect("deck-a", "delay-1", { dryWet: 0.4 });
    workflow.reorderDeckEffects("deck-a", ["limiter-1", "delay-1"]);
    workflow.removeDeckEffect("deck-a", "delay-1");
    await flushContinuation();

    expect(manager.reconcileEffects).toHaveBeenLastCalledWith(
      "left_station-1",
      expect.objectContaining({
        tree: [expect.objectContaining({ id: "limiter-1", order: 0 })],
      })
    );
    expect(effectsSnapshots.at(-1)).toEqual([
      expect.objectContaining({ id: "limiter-1", order: 0 }),
    ]);
    expect(getPlaybackChannel("dj", "deck-a")?.effects).toEqual([
      expect.objectContaining({ id: "limiter-1", order: 0 }),
    ]);
  });
});
