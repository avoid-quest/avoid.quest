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
} from "@/lib/collections/playback-sessions";
import { reportDjErrorSurface } from "@/lib/dj/dj-error-surface";
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
import { PLATFORM_ITEMS } from "./dj-library-sources";
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
    id: "dj",
    channels: [
      createDefaultChannel("deck-a", "deck-a", 0),
      createDefaultChannel("deck-b", "deck-b", 1),
    ],
    masterVolume: 1,
    crossfadePosition: 0.5,
    headphoneVolume: 1,
    activeChannelId: null,
    tempo: 120,
  });
}

function createAudioAdapter(): DjDeckAudioAdapter & {
  activeSounds: Set<string>;
  cleanedSounds: string[];
  emit(soundId: string, state: AudioState): void;
} {
  const activeSounds = new Set<string>();
  const cleanedSounds: string[] = [];
  const listeners = new Map<string, (state: AudioState) => void>();
  return {
    activeSounds,
    cleanedSounds,
    activate({ onState, soundId }) {
      activeSounds.add(soundId);
      listeners.set(soundId, onState);
      return () => {
        cleanedSounds.push(soundId);
        activeSounds.delete(soundId);
        listeners.delete(soundId);
      };
    },
    applyStrip: mock(() => undefined),
    change: mock(() => undefined),
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
          tree: [],
          dryWet: 1,
          tempo: 120,
          sidechainSoundId: null,
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
          tree: [],
          dryWet: 1,
          tempo: 120,
          sidechainSoundId: null,
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
      enabled: false,
      cleanup: mock(() => undefined),
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
    resumeAudioContext: mock(() => Promise.resolve()),
    resetAudioManager: mock(() => undefined),
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

    await deck.load({ type: "radio", radio: current });
    const pendingItem = PLATFORM_ITEMS[0];
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
      type: "library",
      radio: pendingItem,
    });
    audio.emit("left_station-1:1", {
      isPlaying: true,
      isLoading: false,
      isBuffering: false,
      volume: 1,
      error: null,
      hasEnded: false,
    });

    expect(result).toEqual({ type: "pending-platform", platform: "external" });
    expect(getDjError()).toBe("Reload the active source");
    expect(getPlaybackChannel("dj", "deck-a")?.radio).toEqual(current);
    expect(getPlaybackChannelRuntime("deck-a")).toMatchObject({
      soundId: "left_station-1:1",
      isPlaying: true,
    });

    await deck.load({
      type: "radio",
      radio: {
        id: "station-2",
        name: "Station 2",
        streamUrl: "https://radio.example/two.mp3",
      },
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
    const pendingItem = PLATFORM_ITEMS[0];
    if (!pendingItem) {
      throw new Error("Expected a platform picker library item");
    }
    const listener = mock(() => undefined);
    const unsubscribe = module.pendingSource.subscribe(listener);

    await module.deck("deck-a").load({
      type: "library",
      radio: pendingItem,
    });

    expect(module.pendingSource.getSnapshot()).toEqual({
      deckId: "deck-a",
      platform: "external",
    });
    expect(listener).toHaveBeenCalledTimes(1);

    module.pendingSource.cancel();

    expect(module.pendingSource.getSnapshot()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    await module.deck("deck-b").load({
      type: "library",
      radio: pendingItem,
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
      type: "radio",
      radio: {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      },
    });
    audio.emit("left_station-1:1", {
      isPlaying: true,
      isLoading: false,
      isBuffering: false,
      volume: 1,
      error: null,
      hasEnded: false,
    });

    await deck.load({
      type: "track-url",
      radio: {
        id: "unsafe",
        name: "Unsafe",
        streamUrl: "https://radio.example/safe.mp3",
      },
      streamUrl: "javascript:alert(1)",
    });
    audio.emit("left_station-1:1", {
      isPlaying: false,
      isLoading: false,
      isBuffering: false,
      volume: 1,
      error: null,
      hasEnded: false,
    });

    expect(getPlaybackChannelRuntime("deck-a")).toMatchObject({
      soundId: "left_station-1:1",
      isPlaying: false,
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

    await deck.load({ type: "radio", radio: first });
    await deck.load({ type: "radio", radio: second });

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
      type: "radio",
      radio: {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      },
    });
    audio.emit("left_station-1:1", {
      isPlaying: false,
      isLoading: true,
      isBuffering: false,
      volume: 1,
      error: null,
      hasEnded: false,
    });

    await deck.load({
      type: "track-url",
      radio: {
        id: "station-2",
        name: "Station 2",
        streamUrl: "https://radio.example/two.mp3",
      },
      streamUrl: "https://radio.example/two.mp3",
    });

    expect(getPlaybackChannel("dj", "deck-a")?.radio?.id).toBe("station-2");
    expect(getPlaybackChannelRuntime("deck-a").soundId).toBe(
      "left_station-2:2"
    );
  });

  test("keeps the previous source when replacement activation fails", async () => {
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
      streamUrl: "blob:https://radio.example/local",
      platformMetadata: {
        platform: "local-file",
        itemType: "track",
        url: "",
        fileName: "local.mp3",
        displayName: "Local",
        duration: 120,
        fileSize: 1024,
        mimeType: "audio/mpeg",
        objectUrl: "blob:https://radio.example/local",
      },
    };

    await deck.load({ type: "radio", radio: previous });
    audio.activate = mock(() => {
      throw new Error("decoder unavailable");
    });
    await deck.load({
      type: "radio",
      radio: {
        id: "station-2",
        name: "Station 2",
        streamUrl: "https://radio.example/two.mp3",
      },
    });

    expect(getPlaybackChannel("dj", "deck-a")?.radio).toEqual(previous);
    expect(getPlaybackChannelRuntime("deck-a").soundId).toBeNull();
    expect(audio.activeSounds).toEqual(new Set());
    expect(audio.releaseFileUrl).not.toHaveBeenCalled();
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
      type: "device-input",
      deviceId: "interface-1",
      deviceLabel: "Audio Interface",
    });

    expect(getPlaybackChannel("dj", "deck-a")?.radio).toMatchObject({
      id: "device-input-left",
      name: "Audio Interface",
      platformMetadata: {
        platform: "device-input",
        deviceId: "interface-1",
        channelCount: 4,
        channelSelection: { left: 0, right: 1 },
      },
    });
    expect(audio.startDevice).toHaveBeenCalledWith(
      "left_device-input-left:1",
      "interface-1"
    );
    expect(audio.setDeviceChannelSelection).toHaveBeenCalledWith(
      "left_device-input-left:1",
      { left: 0, right: 1 }
    );
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
      type: "device-input",
      deviceId: "interface-1",
      deviceLabel: "Old Interface",
    });
    await Promise.resolve();
    await deck.load({
      type: "device-input",
      deviceId: "interface-2",
      deviceLabel: "New Interface",
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
      type: "device-input" as const,
      deviceId: "interface-1",
      deviceLabel: "Audio Interface",
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

  test("keeps a file URL until a replacement source commits", async () => {
    const audio = createAudioAdapter();
    audio.loadFile = mock(() =>
      Promise.resolve({
        fileName: "local.mp3",
        displayName: "Local",
        duration: 120,
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
      type: "file",
      file: new File(["audio"], "local.mp3", { type: "audio/mpeg" }),
    });
    expect(audio.releaseFileUrl).not.toHaveBeenCalled();

    await deck.load({
      type: "radio",
      radio: {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      },
    });

    expect(audio.releaseFileUrl).toHaveBeenCalledTimes(1);
    expect(audio.releaseFileUrl).toHaveBeenCalledWith(
      "blob:https://radio.example/local"
    );
  });

  test("keeps a resolved remote URL paused when replacing a playing source", async () => {
    const audio = createAudioAdapter();
    const platform = createPlatform();
    platform.loadItem = mock(() =>
      Promise.resolve({
        success: true as const,
        radio: {
          id: "remote-1",
          name: "Remote file",
          streamUrl: "https://radio.example/remote.mp3",
        },
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
      type: "radio",
      radio: {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      },
    });
    audio.emit("left_station-1:1", {
      isPlaying: true,
      isLoading: false,
      isBuffering: false,
      volume: 1,
      error: null,
      hasEnded: false,
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
      type: "track-url",
      radio: {
        id: "unsafe",
        name: "Unsafe",
        streamUrl: "https://radio.example/safe.mp3",
      },
      streamUrl: "javascript:alert(1)",
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
      type: "radio",
      radio: {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      },
    });

    audio.emit("left_station-1:1", {
      isPlaying: true,
      isLoading: false,
      isBuffering: false,
      volume: 1,
      error: null,
      hasEnded: false,
    });
    await Promise.resolve();

    expect(effects.bind).toHaveBeenCalledWith(
      { sessionId: "dj", channelId: "deck-a" },
      "left_station-1:1"
    );
    expect(audio.applyStrip).toHaveBeenCalledWith(
      "left_station-1:1",
      expect.objectContaining({ muted: true, cueEnabled: true })
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
      type: "radio",
      radio: {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      },
    });

    audio.emit("left_station-1:1", {
      isPlaying: true,
      isLoading: false,
      isBuffering: false,
      volume: 1,
      error: null,
      hasEnded: false,
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
      type: "radio",
      radio: {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      },
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
      type: "radio",
      radio: {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      },
    });

    deck.change({ type: "pan", pan: 0.25 });
    deck.change({ type: "effects-dry-wet", value: 0.4 });
    await Promise.resolve();

    expect(getPlaybackChannel("dj", "deck-a")?.pan).toBe(0.25);
    expect(audio.change).toHaveBeenCalledWith("left_station-1:1", {
      type: "pan",
      pan: 0.25,
    });
    expect(effects.change).toHaveBeenCalledWith(
      { sessionId: "dj", channelId: "deck-a" },
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
    await deck.load({ type: "radio", radio });
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
      radio,
      volume: 1,
      muted: false,
      pan: 0,
      speed: 1,
      channelFilter: 0,
      effects: [],
      effectsDryWet: 1,
    });
    expect(change).toHaveBeenCalledWith(
      { sessionId: "dj", channelId: "deck-a" },
      { type: "replace", tree: [] }
    );
    expect(change).toHaveBeenCalledWith(
      { sessionId: "dj", channelId: "deck-a" },
      { type: "set-dry-wet", value: 1 }
    );
    expect(getPlaybackChannelRuntime("deck-a").soundId).toBe(
      "left_station-1:2"
    );
    expect(audio.activeSounds).toEqual(new Set(["left_station-1:2"]));
  });

  test("persists both Effects resets before yielding to a newer change", async () => {
    const effects = createEffects();
    const change = effects.change;
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
      type: "radio",
      radio: {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      },
    });

    const reset = deck.transport({ type: "reset" });
    deck.change({ type: "effects-dry-wet", value: 0.4 });
    try {
      expect(changes).toEqual([
        { type: "replace", tree: [] },
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
    const change = effects.change;
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
      type: "radio",
      radio: {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      },
    });

    const reset = deck.transport({ type: "reset" });
    await Promise.resolve();
    await deck.load({
      type: "radio",
      radio: {
        id: "station-2",
        name: "Station 2",
        streamUrl: "https://radio.example/two.mp3",
      },
    });
    (releaseReset as (() => void) | null)?.();
    await reset;

    expect(getPlaybackChannel("dj", "deck-a")?.radio?.id).toBe("station-2");
    expect(getPlaybackChannelRuntime("deck-a").soundId).toBe(
      "left_station-2:2"
    );
  });

  test("clears a Deck source and Effects through the same interface", async () => {
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
      type: "radio",
      radio: {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      },
    });
    updatePlaybackChannel("dj", "deck-a", (draft) => {
      draft.effects = [createDefaultEffectConfig("delay", "delay-1", 0)];
      draft.effectsDryWet = 0.3;
    });

    await deck.load({ type: "radio", radio: null });

    expect(getPlaybackChannel("dj", "deck-a")).toMatchObject({
      radio: null,
      effects: [],
      effectsDryWet: 1,
    });
    expect(change).toHaveBeenCalledWith(
      { sessionId: "dj", channelId: "deck-a" },
      { type: "replace", tree: [] }
    );
    expect(change).toHaveBeenCalledWith(
      { sessionId: "dj", channelId: "deck-a" },
      { type: "set-dry-wet", value: 1 }
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
      type: "radio",
      radio: {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      },
    });

    const stalePlay = deck.transport({ type: "play" });
    await Promise.resolve();
    await deck.load({
      type: "radio",
      radio: {
        id: "station-2",
        name: "Station 2",
        streamUrl: "https://radio.example/two.mp3",
      },
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
      type: "radio",
      radio: {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      },
    });
    deck.change({ type: "repeat", enabled: true });

    audio.emit("left_station-1:1", {
      isPlaying: false,
      isLoading: false,
      isBuffering: false,
      volume: 1,
      error: null,
      hasEnded: true,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(audio.transport).toHaveBeenCalledWith("left_station-1:1", {
      type: "seek",
      position: 0,
    });
    expect(audio.transport).toHaveBeenCalledWith("left_station-1:1", {
      type: "play",
      volume: 1,
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
      type: "radio",
      radio: {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      },
    });
    deck.change({ type: "repeat", enabled: true });
    audio.emit("left_station-1:1", {
      isPlaying: false,
      isLoading: false,
      isBuffering: false,
      volume: 1,
      error: null,
      hasEnded: true,
    });
    await Promise.resolve();

    await deck.load({
      type: "radio",
      radio: {
        id: "station-2",
        name: "Station 2",
        streamUrl: "https://radio.example/two.mp3",
      },
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
      type: "radio",
      radio: {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      },
    });
    deck.change({ type: "repeat", enabled: true });
    audio.emit("left_station-1:1", {
      isPlaying: false,
      isLoading: false,
      isBuffering: false,
      volume: 1,
      error: null,
      hasEnded: true,
    });
    await Promise.resolve();

    await deck.load({
      type: "radio",
      radio: {
        id: "station-2",
        name: "Station 2",
        streamUrl: "https://radio.example/two.mp3",
      },
    });
    (rejectPlay as ((error: Error) => void) | null)?.(
      new Error("stale play failed")
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(context.reportError).not.toHaveBeenCalled();
    expect(getPlaybackChannelRuntime("deck-a")).toMatchObject({
      soundId: "left_station-2:2",
      error: null,
    });
  });

  test("continues a YouTube playlist without restarting after lazy resolution", async () => {
    const audio = createAudioAdapter();
    const platform = createPlatform();
    platform.resolveStream = mock(() =>
      Promise.resolve({
        streamUrl: "https://radio.example/second.mp3",
        streamFormat: "progressive" as const,
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
      streamUrl: "https://radio.example/first.mp3",
      platformMetadata: {
        platform: "youtube",
        itemType: "playlist",
        url: "https://youtube.com/playlist?list=playlist-1",
        tracks: [
          {
            name: "First",
            streamUrl: "https://radio.example/first.mp3",
            videoId: "first",
          },
          { name: "Second", streamUrl: "", videoId: "second" },
        ],
      },
    };
    await module.deck("deck-a").load({ type: "radio", radio });

    audio.emit("left_playlist-1:1", {
      isPlaying: false,
      isLoading: false,
      isBuffering: false,
      volume: 1,
      error: null,
      hasEnded: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const continuedSound = getPlaybackChannelRuntime("deck-a").soundId;
    audio.emit(continuedSound ?? "", {
      isPlaying: false,
      isLoading: false,
      isBuffering: false,
      volume: 1,
      error: null,
      hasEnded: true,
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
        streamUrl: "https://radio.example/refreshed.mp3",
        streamFormat: "progressive" as const,
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
      type: "radio",
      radio: {
        id: "yt-1",
        name: "YouTube",
        streamUrl: "https://radio.example/old.mp3",
        platformMetadata: {
          platform: "youtube",
          itemType: "video",
          url: "https://youtube.com/watch?v=abc",
          videoId: "abc",
        },
      },
    });

    audio.emit("left_yt-1:1", {
      isPlaying: false,
      isLoading: false,
      isBuffering: false,
      volume: 1,
      error: {
        id: "error-1",
        code: "STREAM_INTERRUPTED",
        message: "expired",
        position: 42,
        timestamp: Date.now(),
      },
      hasEnded: false,
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
      type: "radio",
      radio: {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      },
    });

    audio.emit("left_station-1:1", {
      isPlaying: false,
      isLoading: false,
      isBuffering: false,
      volume: 1,
      error: {
        id: "error-1",
        code: "STREAM_DECODE_FAILED",
        message: "decoder failed",
        timestamp: Date.now(),
      },
      hasEnded: false,
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
      type: "radio",
      radio: {
        id: "yt-1",
        name: "YouTube",
        streamUrl: "https://radio.example/old.mp3",
        platformMetadata: {
          platform: "youtube",
          itemType: "video",
          url: "https://youtube.com/watch?v=abc",
          videoId: "abc",
        },
      },
    });

    audio.emit("left_yt-1:1", {
      isPlaying: false,
      isLoading: false,
      isBuffering: false,
      volume: 1,
      error: {
        id: "error-1",
        code: "STREAM_INTERRUPTED",
        message: "expired",
        position: 42,
        timestamp: Date.now(),
      },
      hasEnded: false,
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
        fileName: "local.mp3",
        displayName: "Local",
        duration: 120,
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
      type: "file",
      file: new File(["audio"], "local.mp3", { type: "audio/mpeg" }),
    });

    module.deactivate();

    expect(audio.activeSounds).toEqual(new Set());
    expect(effects.unbind).toHaveBeenCalledWith({
      sessionId: "dj",
      channelId: "deck-a",
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
      enabled: true,
      cleanup: mock(() => undefined),
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
      type: "radio",
      radio: {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      },
    });
    audio.emit("left_station-1:1", {
      isPlaying: true,
      isLoading: false,
      isBuffering: false,
      volume: 1,
      error: null,
      hasEnded: false,
    });
    await deck.load({
      type: "radio",
      radio: {
        id: "station-2",
        name: "Station 2",
        streamUrl: "https://radio.example/two.mp3",
      },
    });
    audio.emit("left_station-2:2", {
      isPlaying: true,
      isLoading: false,
      isBuffering: false,
      volume: 1,
      error: null,
      hasEnded: false,
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
      type: "radio",
      radio: {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      },
    });

    await deck.transport({ type: "play" });

    expect(context.reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "dj",
        channelId: "deck-a",
        userMessage: "Failed to play deck-a",
        rawMessage: "decoder internals 73",
      })
    );
  });
});
