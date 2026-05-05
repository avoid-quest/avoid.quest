import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { AudioManager, type AudioState, type Radio } from "@/lib/audio";
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
  deactivateAllChannels,
  deactivateChannel,
} from "./channel-state-manager";
import { createDjDeckLoadWorkflow } from "./dj-actions-deck-load";
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

function createDependencies() {
  return {
    activateChannel,
    applyCrossfade: mock(() => undefined),
    applyStoredChannelStrip: mock(() => undefined),
    applyStoredEffectsAndFilters: mock(async () => undefined),
    clearDjError: mock(() => undefined),
    connectDeckCueBus: mock(() => undefined),
    deactivateChannel,
    getAudioManager: () => AudioManager.getInstance(),
    getSoundId: (radio: { id?: string | number }, side: string) =>
      `${side}_${radio.id}`,
    initializeAudioDevices: mock(async () => undefined),
    loadTrack: mock(async () => undefined),
    pauseDeckSound: mock((_soundId: string) => undefined),
    playDeckSound: mock(async (_soundId: string, _volume: number) => undefined),
    reportDjError: mock(() => undefined),
    resolvePlatformStreamUrl: mock(async () => null),
    seekDeckSound: mock((_soundId: string, _position: number) => undefined),
    setDeckVolume: mock((_deckId: string, _volume: number) => undefined),
  };
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
      expect.objectContaining({ id: "station-1" })
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
      expect.objectContaining({ id: "station-1" })
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
      expect.objectContaining({ id: "station-1" })
    );
  });

  test("applies crossfade after deck volume changes through the lifecycle boundary", () => {
    const dependencies = createDependencies();
    const workflow = createDjDeckLoadWorkflow(dependencies);

    workflow.setDeckVolume("deck-a", 0.33);

    expect(dependencies.setDeckVolume).toHaveBeenCalledWith("deck-a", 0.33);
    expect(dependencies.applyCrossfade).toHaveBeenCalledTimes(1);
  });
});
