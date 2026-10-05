import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AudioEngineFacade, AudioManager, Radio } from "@/lib/audio";
import {
  createDefaultChannel,
  DECK_A_CHANNEL_ID,
  DECK_B_CHANNEL_ID,
  getPlaybackChannel,
  playbackSessionsCollection,
  updatePlaybackChannel,
} from "@/lib/collections/playback-sessions";
import {
  getDjError,
  resetAllDjRuntime,
  setDjError,
} from "@/lib/stores/dj-runtime-store";
import {
  getPlaybackChannelRuntime,
  setPlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";
import type { DeckId, DjDeckLoadIntent, DjDeckModule } from "./dj-deck";
import { createDjModeLifecycleWorkflow } from "./dj-mode-lifecycle-workflow";
import type { OutputRouting } from "./output-routing";
import type { PlaybackActionContext } from "./playback-action-context";

type ChannelActivationSoundIdOption = string | { soundId?: string };

async function resetPlaybackSessions() {
  await playbackSessionsCollection.stateWhenReady();

  for (const sessionId of Array.from(playbackSessionsCollection.state.keys())) {
    playbackSessionsCollection.delete(sessionId);
  }
}

function getActivatedSoundId(
  channelId: string,
  optionsOrSoundId?: ChannelActivationSoundIdOption
): string {
  if (typeof optionsOrSoundId === "string") {
    return optionsOrSoundId;
  }
  return optionsOrSoundId?.soundId ?? `sound:${channelId}`;
}

function createTestContext(): PlaybackActionContext {
  const audioEngine = {
    playback: {
      pause: mock((_soundId: string) => undefined),
      play: mock(async (_soundId: string, _volume?: number) => undefined),
      refreshStreamUrl: mock(
        async (_soundId: string, _newUrl: string, _seekPosition?: number) =>
          undefined
      ),
      seek: mock((_soundId: string, _position: number) => undefined),
    },
    volume: {
      setChannelVolume: mock((_soundId: string, _volume: number) => undefined),
      setMasterVolume: mock((_volume: number) => undefined),
    },
  } satisfies AudioEngineFacade;

  return {
    audio: {
      cleanupSound: mock((_soundId: string) => undefined),
      hasSound: mock((_soundId: string) => false),
      pauseSound: mock((_soundId: string) => undefined),
      playSound: mock(async (_soundId: string, _volume: number) => undefined),
      setGlobalVolume: mock((_volume: number) => undefined),
      setMainDelay: mock((_delayMs: number) => undefined),
      setVolume: mock((_soundId: string, _volume: number) => undefined),
    } as unknown as AudioManager,
    audioEngine,
    channels: {
      activate: mock(
        (
          _sessionId,
          channelId,
          _radio,
          optionsOrSoundId?: ChannelActivationSoundIdOption
        ) => {
          const soundId = getActivatedSoundId(channelId, optionsOrSoundId);
          setPlaybackChannelRuntime(channelId, () => ({ soundId }));
          return soundId;
        }
      ),
      deactivate: mock((_channelId: string) => undefined),
      deactivateAll: mock(() => undefined),
      setMuted: mock((_sessionId, _channelId, _muted) => undefined),
      setPan: mock((_sessionId, _channelId, _pan) => undefined),
      setSpeed: mock((_sessionId, _channelId, _speed) => undefined),
      setVolume: mock((_sessionId, _channelId, _volume) => undefined),
      subscribeRuntime: mock((_sessionId, _channelId, _soundId) => undefined),
    },
    getMainOutputRouter: () => null,
    lifecycle: { mainOutputSettingsApplied: true },
    reportError: mock(() => undefined),
    resetAudioManager: mock(() => undefined),
    resumeAudioContext: mock(async () => undefined),
  } satisfies PlaybackActionContext;
}

function createTestDecks(onLoad: () => void = () => undefined): DjDeckModule & {
  load: ReturnType<typeof mock>;
} {
  const load = mock((_intent: DjDeckLoadIntent) => {
    onLoad();
    return Promise.resolve({ type: "loaded" as const });
  });
  return {
    deactivate: mock(() => undefined),
    deck: mock((deckId: DeckId) => ({
      change: mock(() => undefined),
      load: (intent: DjDeckLoadIntent) => {
        if (intent.type === "radio" && intent.radio === null) {
          updatePlaybackChannel("dj", deckId, (draft) => {
            draft.radio = null;
          });
        }
        return load(intent);
      },
      transport: mock(async () => undefined),
    })),
    load,
    pendingSource: {
      cancel: mock(() => undefined),
      getSnapshot: mock(() => ({ "deck-a": null, "deck-b": null })),
      subscribe: mock(() => () => undefined),
    },
  };
}

beforeEach(async () => {
  await resetPlaybackSessions();
  resetAllDjRuntime();
});

afterEach(async () => {
  await resetPlaybackSessions();
  resetAllDjRuntime();
});

describe("createDjModeLifecycleWorkflow", () => {
  test("restores only restorable decks and reapplies mixer state on activation", async () => {
    await playbackSessionsCollection.stateWhenReady();
    const streamRadio = {
      id: "station-1",
      name: "Station 1",
      streamUrl: "https://radio.example/station.mp3",
    } satisfies Radio;
    const localFileRadio = {
      id: "local-1",
      name: "Local File",
      platformMetadata: {
        displayName: "Local File",
        duration: 10,
        fileName: "local.mp3",
        fileSize: 100,
        itemType: "track",
        mimeType: "audio/mpeg",
        objectUrl: "blob:https://radio.example/local",
        platform: "local-file",
        url: "",
      },
      streamUrl: "blob:https://radio.example/local",
    } satisfies Radio;
    playbackSessionsCollection.insert({
      activeChannelId: null,
      channels: [
        {
          ...createDefaultChannel(DECK_A_CHANNEL_ID, "deck-a", 0),
          radio: streamRadio,
          volume: 0.42,
        },
        {
          ...createDefaultChannel(DECK_B_CHANNEL_ID, "deck-b", 1),
          radio: localFileRadio,
          volume: 0.37,
        },
      ],
      crossfadePosition: 0.25,
      headphoneVolume: 0.65,
      id: "dj",
      masterVolume: 0.7,
    });
    const context = createTestContext();
    const activationOrder: string[] = [];
    const setHeadphoneVolume = mock((_volume: number) => {
      activationOrder.push("headphone");
    });
    context.getMainOutputRouter = () =>
      ({ setHeadphoneVolume }) as unknown as OutputRouting;
    const decks = createTestDecks(() => activationOrder.push("deck"));
    const workflow = createDjModeLifecycleWorkflow({ ctx: context, decks });

    await workflow.activate();

    expect(decks.load).toHaveBeenCalledWith({
      radio: streamRadio,
      type: "radio",
    });
    expect(decks.load).toHaveBeenCalledWith({ radio: null, type: "radio" });
    expect(getPlaybackChannel("dj", DECK_B_CHANNEL_ID)?.radio).toBeNull();
    expect(context.audio.setGlobalVolume).toHaveBeenCalledWith(0.7);
    expect(context.audioEngine.volume.setMasterVolume).toHaveBeenCalledWith(
      0.7
    );
    expect(setHeadphoneVolume).toHaveBeenCalledWith(0.65);
    expect(activationOrder.slice(0, 2)).toEqual(["headphone", "deck"]);
  });

  test("clears a local folder's deck instead of restoring its revoked URLs", async () => {
    await playbackSessionsCollection.stateWhenReady();
    const localPlaylist = {
      id: "local-playlist-1",
      name: "Folder",
      platformMetadata: {
        displayName: "Folder",
        duration: 10,
        fileName: "Folder",
        fileSize: 100,
        isLocal: true,
        itemType: "playlist",
        mimeType: "audio/mpeg",
        platform: "static-audio",
        streamUrl: "blob:https://radio.example/one",
        tracks: [{ streamUrl: "blob:https://radio.example/one", title: "One" }],
        url: "",
      },
      streamUrl: "blob:https://radio.example/one",
    } satisfies Radio;
    playbackSessionsCollection.insert({
      activeChannelId: null,
      channels: [
        {
          ...createDefaultChannel(DECK_A_CHANNEL_ID, "deck-a", 0),
          radio: localPlaylist,
        },
      ],
      crossfadePosition: 0.5,
      headphoneVolume: 0.5,
      id: "dj",
      masterVolume: 0.7,
    });
    const context = createTestContext();
    context.getMainOutputRouter = () =>
      ({ setHeadphoneVolume: () => undefined }) as unknown as OutputRouting;
    const decks = createTestDecks();
    const workflow = createDjModeLifecycleWorkflow({ ctx: context, decks });

    await workflow.activate();

    expect(decks.load).toHaveBeenCalledTimes(1);
    expect(decks.load).toHaveBeenCalledWith({ radio: null, type: "radio" });
    expect(getPlaybackChannel("dj", DECK_A_CHANNEL_ID)?.radio).toBeNull();
  });

  test("clears stale surfaced errors during activation even when no decks restore", async () => {
    await playbackSessionsCollection.stateWhenReady();
    playbackSessionsCollection.insert({
      activeChannelId: null,
      channels: [],
      crossfadePosition: 0.25,
      headphoneVolume: 0.35,
      id: "dj",
      masterVolume: 0.7,
    });
    setDjError("stale deck load failed");
    const context = createTestContext();
    const setHeadphoneVolume = mock((_volume: number) => undefined);
    context.getMainOutputRouter = () =>
      ({ setHeadphoneVolume }) as unknown as OutputRouting;
    const decks = createTestDecks();
    const workflow = createDjModeLifecycleWorkflow({ ctx: context, decks });

    await workflow.activate();

    expect(getDjError()).toBeNull();
    expect(decks.load).not.toHaveBeenCalled();
    expect(setHeadphoneVolume).toHaveBeenCalledWith(0.35);
  });

  test("deactivation fades deck sounds, clears runtime state, and clears surfaced errors", async () => {
    await playbackSessionsCollection.stateWhenReady();
    playbackSessionsCollection.insert({
      activeChannelId: null,
      channels: [
        createDefaultChannel(DECK_A_CHANNEL_ID, "deck-a", 0),
        createDefaultChannel(DECK_B_CHANNEL_ID, "deck-b", 1),
      ],
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      id: "dj",
      masterVolume: 0.5,
    });
    setPlaybackChannelRuntime(DECK_A_CHANNEL_ID, () => ({
      isPlaying: true,
      soundId: "left_station-1",
    }));
    setPlaybackChannelRuntime(DECK_B_CHANNEL_ID, () => ({
      isPlaying: true,
      soundId: "right_station-2",
    }));
    setDjError("stale error");
    const fadeOut = mock((_soundId: string, _duration: number) =>
      Promise.resolve()
    );
    const context = createTestContext();
    const decks = createTestDecks();
    const workflow = createDjModeLifecycleWorkflow({
      ctx: context,
      decks,
      fadeOutDurationMs: 120,
      fadeOutSound: fadeOut,
    });

    await workflow.deactivate();

    expect(fadeOut).toHaveBeenCalledWith("left_station-1", 120, true);
    expect(fadeOut).toHaveBeenCalledWith("right_station-2", 120, true);
    expect(decks.deactivate).toHaveBeenCalledTimes(1);
    expect(getPlaybackChannelRuntime(DECK_A_CHANNEL_ID).soundId).toBeNull();
    expect(getPlaybackChannelRuntime(DECK_B_CHANNEL_ID).soundId).toBeNull();
    expect(getDjError()).toBeNull();
  });

  test("deactivation fades deck runtime sounds even when persisted deck channels are missing", async () => {
    await playbackSessionsCollection.stateWhenReady();
    playbackSessionsCollection.insert({
      activeChannelId: null,
      channels: [],
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      id: "dj",
      masterVolume: 0.5,
    });
    setPlaybackChannelRuntime(DECK_A_CHANNEL_ID, () => ({
      isPlaying: true,
      soundId: "left_station-1",
    }));
    setPlaybackChannelRuntime(DECK_B_CHANNEL_ID, () => ({
      isPlaying: true,
      soundId: "right_station-2",
    }));
    const fadeOut = mock((_soundId: string, _duration: number) =>
      Promise.resolve()
    );
    const context = createTestContext();
    const decks = createTestDecks();
    const workflow = createDjModeLifecycleWorkflow({
      ctx: context,
      decks,
      fadeOutDurationMs: 120,
      fadeOutSound: fadeOut,
    });

    await workflow.deactivate();

    expect(fadeOut).toHaveBeenCalledWith("left_station-1", 120, true);
    expect(fadeOut).toHaveBeenCalledWith("right_station-2", 120, true);
    expect(getPlaybackChannelRuntime(DECK_A_CHANNEL_ID).soundId).toBeNull();
    expect(getPlaybackChannelRuntime(DECK_B_CHANNEL_ID).soundId).toBeNull();
  });

  test("deactivation cleans orphaned deck sounds after runtime cleanup", async () => {
    await playbackSessionsCollection.stateWhenReady();
    playbackSessionsCollection.insert({
      activeChannelId: null,
      channels: [
        createDefaultChannel(DECK_A_CHANNEL_ID, "deck-a", 0),
        createDefaultChannel(DECK_B_CHANNEL_ID, "deck-b", 1),
      ],
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      id: "dj",
      masterVolume: 0.5,
    });
    setPlaybackChannelRuntime(DECK_A_CHANNEL_ID, () => ({
      error: {
        code: "STREAM_ABORTED",
        id: "deck-error",
        message: "stale",
        timestamp: 1,
      },
      isBuffering: true,
      isLoading: true,
      isPlaying: true,
      soundId: "left_orphan",
    }));
    const fadeOut = mock((_soundId: string, _duration: number) =>
      Promise.resolve()
    );
    const context = createTestContext();
    const liveSoundIds = new Set(["left_orphan"]);
    context.audio.hasSound = mock((soundId: string) =>
      liveSoundIds.has(soundId)
    );
    context.audio.cleanupSound = mock((soundId: string) => {
      liveSoundIds.delete(soundId);
    });
    const decks = createTestDecks();
    const workflow = createDjModeLifecycleWorkflow({
      ctx: context,
      decks,
      fadeOutDurationMs: 120,
      fadeOutSound: fadeOut,
    });

    await workflow.deactivate();

    expect(context.audio.cleanupSound).toHaveBeenCalledWith("left_orphan");
    expect(getPlaybackChannelRuntime(DECK_A_CHANNEL_ID)).toMatchObject({
      error: null,
      isBuffering: false,
      isLoading: false,
      isPlaying: false,
      soundId: null,
    });
  });
});
