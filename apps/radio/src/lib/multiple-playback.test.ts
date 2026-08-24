import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AudioEngineFacade, AudioManager, Radio } from "@/lib/audio";
import {
  createDefaultChannel,
  getMultipleChannelId,
  getPlaybackSession,
  playbackSessionsCollection,
  updatePlaybackChannel,
  updatePlaybackSession,
} from "@/lib/collections/playback-sessions";
import { settingsCollection } from "@/lib/collections/settings";
import {
  getPlaybackChannelRuntime,
  resetAllPlaybackRuntime,
  resetPlaybackChannelRuntime,
  setPlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";
import { getMultiplePlayback } from "./multiple-playback";
import type { OutputRouting } from "./output-routing";
import type { PlaybackActionContext } from "./playback-action-context";

function station(id: string): Radio {
  return {
    id,
    name: `Station ${id}`,
    streamUrl: `https://radio.example/${id}.mp3`,
  };
}

async function resetCollections(): Promise<void> {
  await Promise.all([
    playbackSessionsCollection.stateWhenReady(),
    settingsCollection.stateWhenReady(),
  ]);
  for (const sessionId of Array.from(playbackSessionsCollection.state.keys())) {
    playbackSessionsCollection.delete(sessionId);
  }
  for (const settingsId of Array.from(settingsCollection.state.keys())) {
    settingsCollection.delete(settingsId);
  }
}

function insertSettings(): void {
  settingsCollection.insert({
    id: "app-settings",
    player: { mode: "multiple", restoreStateOnLoad: true },
    audio: {
      mainOutputId: "default",
      cueOutputId: null,
      delay: { mainDelayMs: 0, cueDelayMs: 0 },
    },
  });
}

function insertMultipleSession(radios: Radio[] = []): void {
  playbackSessionsCollection.insert({
    id: "multiple",
    channels: radios.map((radio, order) => ({
      ...createDefaultChannel(getMultipleChannelId(radio), "multiple", order),
      radio,
    })),
    masterVolume: 0.8,
    crossfadePosition: 0.5,
    headphoneVolume: 1,
    activeChannelId: null,
  });
}

function createTestContext(): PlaybackActionContext {
  return {
    audio: {
      hasSound: mock((_soundId: string) => false),
      cleanupSound: mock((_soundId: string) => undefined),
      pauseSound: mock((_soundId: string) => undefined),
      playSound: mock(async (_soundId: string, _volume: number) => undefined),
      setGlobalVolume: mock((_volume: number) => undefined),
      setMainDelay: mock((_delayMs: number) => undefined),
    } as unknown as AudioManager,
    audioEngine: {
      playback: {
        pause: mock((_soundId: string) => undefined),
        play: mock(async (_soundId: string, _volume?: number) => undefined),
        refreshStreamUrl: mock(
          async (_soundId: string, _newUrl: string, _seek?: number) => undefined
        ),
        seek: mock((_soundId: string, _position: number) => undefined),
      },
      volume: {
        setChannelVolume: mock(
          (_soundId: string, _volume: number) => undefined
        ),
        setMasterVolume: mock((_volume: number) => undefined),
      },
    } satisfies AudioEngineFacade,
    channels: {
      activate: mock(
        (
          _sessionId,
          channelId,
          _radio,
          optionsOrSoundId?: string | { soundId?: string }
        ) => {
          const soundId =
            typeof optionsOrSoundId === "string"
              ? optionsOrSoundId
              : (optionsOrSoundId?.soundId ?? `multiple:${channelId}`);
          setPlaybackChannelRuntime(channelId, () => ({ soundId }));
          return soundId;
        }
      ),
      deactivate: mock((channelId: string) => {
        resetPlaybackChannelRuntime(channelId);
      }),
      deactivateAll: mock(() => undefined),
      getOutputMode: mock((_channelId: string) => "audio-graph" as const),
      setMuted: mock((sessionId, channelId, muted) => {
        updatePlaybackChannel(sessionId, channelId, (draft) => {
          draft.muted = muted;
        });
      }),
      setPan: mock((_sessionId, _channelId, _pan) => undefined),
      setSpeed: mock((_sessionId, _channelId, _speed) => undefined),
      setVolume: mock((sessionId, channelId, volume) => {
        updatePlaybackChannel(sessionId, channelId, (draft) => {
          draft.volume = volume;
        });
      }),
      subscribeRuntime: mock((_sessionId, _channelId, _soundId) => undefined),
    },
    getMainOutputRouter: () => null,
    lifecycle: { mainOutputSettingsApplied: true },
    reportError: mock(() => undefined),
    resumeAudioContext: mock(async () => undefined),
    resetAudioManager: mock(() => undefined),
  };
}

beforeEach(async () => {
  await resetCollections();
  resetAllPlaybackRuntime();
  insertSettings();
});

afterEach(async () => {
  await resetCollections();
  resetAllPlaybackRuntime();
});

describe("Multiple Playback", () => {
  test("owns Saved and Session Station membership through one context interface", () => {
    const saved = station("saved");
    const session = station("session");
    insertMultipleSession([saved]);
    updatePlaybackChannel("multiple", getMultipleChannelId(saved), (draft) => {
      draft.volume = 0.35;
    });
    const context = createTestContext();
    const playback = getMultiplePlayback({ ctx: context });

    expect(getMultiplePlayback({ ctx: context })).toBe(playback);
    playback.synchronizeStations(
      [saved],
      [{ ...saved, name: "Duplicate" }, session]
    );

    expect(
      getPlaybackSession("multiple")?.channels.map((channel) => channel.radio)
    ).toEqual([saved, session]);
    expect(getPlaybackSession("multiple")?.channels[0]?.volume).toBe(0.35);
    expect(
      getPlaybackChannelRuntime(getMultipleChannelId(saved)).error
    ).toBeNull();
  });

  test("preserves Channel and master volume across mute toggles", () => {
    const radio = station("saved");
    const channelId = getMultipleChannelId(radio);
    insertMultipleSession([radio]);
    updatePlaybackChannel("multiple", channelId, (draft) => {
      draft.volume = 0.35;
    });
    const playback = getMultiplePlayback({ ctx: createTestContext() });

    playback.toggleMute(channelId);
    expect(getPlaybackSession("multiple")?.channels[0]).toMatchObject({
      muted: true,
      volume: 0.35,
    });
    playback.toggleMute(channelId);
    expect(getPlaybackSession("multiple")?.channels[0]).toMatchObject({
      muted: false,
      volume: 0.35,
    });

    playback.toggleMasterMute();
    expect(getPlaybackSession("multiple")?.masterVolume).toBe(0);
    playback.toggleMasterMute();
    expect(getPlaybackSession("multiple")?.masterVolume).toBe(0.8);
  });

  test("restores a positive Channel volume when persisted state starts muted", async () => {
    const radio = station("muted");
    const channelId = getMultipleChannelId(radio);
    insertMultipleSession([radio]);
    updatePlaybackChannel("multiple", channelId, (draft) => {
      draft.volume = 0;
    });
    const playback = getMultiplePlayback({ ctx: createTestContext() });

    await playback.activate();
    playback.toggleMute(channelId);

    expect(getPlaybackSession("multiple")?.channels[0]?.volume).toBe(1);
  });

  test("unmuting a persisted muted zero-volume Channel restores volume", () => {
    const radio = station("muted-zero");
    const channelId = getMultipleChannelId(radio);
    insertMultipleSession([radio]);
    updatePlaybackChannel("multiple", channelId, (draft) => {
      draft.muted = true;
      draft.volume = 0;
    });

    getMultiplePlayback({ ctx: createTestContext() }).toggleMute(channelId);

    expect(getPlaybackSession("multiple")?.channels[0]).toMatchObject({
      muted: false,
      volume: 1,
    });
  });

  test("toggles persisted Channel mute without discarding its volume", () => {
    const radio = station("persisted-muted");
    const channelId = getMultipleChannelId(radio);
    insertMultipleSession([radio]);
    updatePlaybackChannel("multiple", channelId, (draft) => {
      draft.muted = true;
      draft.volume = 0.35;
    });
    const context = createTestContext();

    getMultiplePlayback({ ctx: context }).toggleMute(channelId);

    expect(getPlaybackSession("multiple")?.channels[0]).toMatchObject({
      muted: false,
      volume: 0.35,
    });
    expect(context.channels.setMuted).toHaveBeenCalledWith(
      "multiple",
      channelId,
      false
    );
  });

  test("raising a Channel volume clears persisted mute", () => {
    const radio = station("raise-muted");
    const channelId = getMultipleChannelId(radio);
    insertMultipleSession([radio]);
    updatePlaybackChannel("multiple", channelId, (draft) => {
      draft.muted = true;
      draft.volume = 0.35;
    });
    const context = createTestContext();

    getMultiplePlayback({ ctx: context }).setVolume(channelId, 0.7);

    expect(getPlaybackSession("multiple")?.channels[0]).toMatchObject({
      muted: false,
      volume: 0.7,
    });
    expect(context.channels.setMuted).toHaveBeenCalledWith(
      "multiple",
      channelId,
      false
    );
  });

  test("restores a positive master volume when persisted state starts muted", async () => {
    insertMultipleSession();
    updatePlaybackSession("multiple", (draft) => {
      draft.masterVolume = 0;
    });
    const playback = getMultiplePlayback({ ctx: createTestContext() });

    await playback.activate();
    playback.toggleMasterMute();

    expect(getPlaybackSession("multiple")?.masterVolume).toBe(1);
  });

  test("pauses an existing Channel even when its persisted Station is invalid", async () => {
    const invalid = {
      ...station("invalid"),
      platformMetadata: {
        platform: "youtube",
        itemType: "video",
        url: "https://youtube.example/watch?v=invalid",
      },
    } as Radio;
    const channelId = getMultipleChannelId(invalid);
    insertMultipleSession([invalid]);
    setPlaybackChannelRuntime(channelId, () => ({
      soundId: `multiple:${channelId}`,
      isPlaying: true,
    }));
    const context = createTestContext();

    await getMultiplePlayback({ ctx: context }).setPlaying(channelId, false);

    expect(context.audio.pauseSound).toHaveBeenCalledWith(
      `multiple:${channelId}`
    );
    expect(context.reportError).not.toHaveBeenCalled();
  });

  test("bounds play-all network pressure to three Channels", async () => {
    const radios = Array.from({ length: 5 }, (_, index) =>
      station(String(index + 1))
    );
    insertMultipleSession(radios);
    const releases: Array<() => void> = [];
    let active = 0;
    let maximumActive = 0;
    const context = createTestContext();
    context.audio.playSound = mock(
      () =>
        new Promise<void>((resolve) => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          releases.push(() => {
            active -= 1;
            resolve();
          });
        })
    );
    const playback = getMultiplePlayback({ ctx: context });

    const playing = playback.playAll();
    await Promise.resolve();
    await Promise.resolve();

    expect(releases).toHaveLength(3);
    for (const release of releases.splice(0, 3)) {
      release();
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(releases).toHaveLength(2);
    for (const release of releases.splice(0)) {
      release();
    }
    await playing;

    expect(maximumActive).toBe(3);
  });

  test("pause-all cancels queued starts and re-pauses late completions", async () => {
    const radios = Array.from({ length: 5 }, (_, index) =>
      station(String(index + 1))
    );
    insertMultipleSession(radios);
    const releases: Array<() => void> = [];
    const startedSoundIds: string[] = [];
    const context = createTestContext();
    context.audio.playSound = mock(
      (soundId: string) =>
        new Promise<void>((resolve) => {
          startedSoundIds.push(soundId);
          releases.push(() => {
            setPlaybackChannelRuntime(
              soundId.slice("multiple:".length),
              () => ({ isPlaying: true })
            );
            resolve();
          });
        })
    );
    context.audio.pauseSound = mock((soundId: string) => {
      setPlaybackChannelRuntime(soundId.slice("multiple:".length), () => ({
        isPlaying: false,
      }));
    });
    const playback = getMultiplePlayback({ ctx: context });

    const playing = playback.playAll();
    await Promise.resolve();
    await Promise.resolve();
    const initialReleases = releases.splice(0);
    playback.pauseAll();
    for (const release of initialReleases) {
      release();
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    for (const release of releases.splice(0)) {
      release();
    }
    await playing;

    expect(startedSoundIds).toHaveLength(3);
    for (const radio of radios) {
      expect(
        getPlaybackChannelRuntime(getMultipleChannelId(radio)).isPlaying
      ).toBe(false);
    }
  });

  test("pause-all suppresses a rejected in-flight Channel start", async () => {
    const radio = station("rejected-after-pause");
    const channelId = getMultipleChannelId(radio);
    insertMultipleSession([radio]);
    let rejectStart: (reason?: unknown) => void = () => undefined;
    const context = createTestContext();
    context.audio.playSound = mock(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectStart = reject;
        })
    );
    const playback = getMultiplePlayback({ ctx: context });

    const playing = playback.playAll();
    await Promise.resolve();
    await Promise.resolve();
    playback.pauseAll();
    rejectStart(new Error("failure after pause"));
    await playing;

    expect(getPlaybackChannelRuntime(channelId).error).toBeNull();
    expect(context.reportError).not.toHaveBeenCalled();
  });

  test("deactivation cancels queued starts and cleans late completions", async () => {
    const radios = Array.from({ length: 5 }, (_, index) =>
      station(String(index + 1))
    );
    insertMultipleSession(radios);
    const releases: Array<() => void> = [];
    const startedSoundIds: string[] = [];
    const context = createTestContext();
    context.audio.playSound = mock(
      (soundId: string) =>
        new Promise<void>((resolve) => {
          startedSoundIds.push(soundId);
          releases.push(() => {
            setPlaybackChannelRuntime(
              soundId.slice("multiple:".length),
              () => ({ isPlaying: true })
            );
            resolve();
          });
        })
    );
    const playback = getMultiplePlayback({
      ctx: context,
      fadeOutSound: mock(async () => undefined),
    });

    const playing = playback.playAll();
    await Promise.resolve();
    await Promise.resolve();
    const initialReleases = releases.splice(0);
    await playback.deactivate();
    for (const release of initialReleases) {
      release();
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    for (const release of releases.splice(0)) {
      release();
    }
    await playing;

    expect(startedSoundIds).toHaveLength(3);
    for (const radio of radios) {
      expect(
        getPlaybackChannelRuntime(getMultipleChannelId(radio))
      ).toMatchObject({
        isPlaying: false,
        soundId: null,
      });
    }
  });

  test("deactivation suppresses a rejected in-flight Channel start", async () => {
    const radio = station("rejected-after-deactivation");
    const channelId = getMultipleChannelId(radio);
    insertMultipleSession([radio]);
    let rejectStart: (reason?: unknown) => void = () => undefined;
    const context = createTestContext();
    context.audio.playSound = mock(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectStart = reject;
        })
    );
    const playback = getMultiplePlayback({
      ctx: context,
      fadeOutSound: mock(async () => undefined),
    });

    const playing = playback.playAll();
    await Promise.resolve();
    await Promise.resolve();
    await playback.deactivate();
    rejectStart(new Error("failure after deactivation"));
    await playing;

    expect(getPlaybackChannelRuntime(channelId)).toMatchObject({
      error: null,
      isPlaying: false,
      soundId: null,
    });
    expect(context.reportError).not.toHaveBeenCalled();
  });

  test("deactivation cleans a Channel added while another Channel fades", async () => {
    const initial = station("initial");
    const late = station("late");
    const initialChannelId = getMultipleChannelId(initial);
    const lateChannelId = getMultipleChannelId(late);
    insertMultipleSession([initial]);
    setPlaybackChannelRuntime(initialChannelId, () => ({
      soundId: `multiple:${initialChannelId}`,
      isPlaying: true,
    }));
    const fade = Promise.withResolvers<void>();
    const context = createTestContext();
    const fadeOutSound = mock(() => fade.promise);
    const playback = getMultiplePlayback({ ctx: context, fadeOutSound });

    const deactivation = playback.deactivate();
    await Promise.resolve();
    expect(fadeOutSound).toHaveBeenCalled();
    await playback.addStation(late, true);
    fade.resolve();
    await deactivation;

    expect(getPlaybackChannelRuntime(lateChannelId)).toMatchObject({
      isPlaying: false,
      soundId: null,
    });
  });

  test("keeps a newer play-all start after a deactivated worker settles", async () => {
    const radio = station("restart");
    const channelId = getMultipleChannelId(radio);
    insertMultipleSession([radio]);
    let releaseOldStart: () => void = () => undefined;
    let startCount = 0;
    const context = createTestContext();
    context.audio.playSound = mock(
      (soundId: string) =>
        new Promise<void>((resolve) => {
          startCount += 1;
          if (startCount === 1) {
            releaseOldStart = () => {
              setPlaybackChannelRuntime(channelId, () => ({
                isPlaying: true,
              }));
              resolve();
            };
            return;
          }
          setPlaybackChannelRuntime(channelId, () => ({
            isPlaying: true,
            soundId,
          }));
          resolve();
        })
    );
    const playback = getMultiplePlayback({
      ctx: context,
      fadeOutSound: mock(async () => undefined),
    });

    const oldPlayAll = playback.playAll();
    await Promise.resolve();
    await Promise.resolve();
    await playback.deactivate();
    await playback.playAll();
    releaseOldStart();
    await oldPlayAll;

    expect(getPlaybackChannelRuntime(channelId)).toMatchObject({
      isPlaying: true,
      soundId: `multiple:${channelId}`,
    });
  });

  test("keeps a manual resume after a paused play-all worker settles", async () => {
    const radio = station("resume");
    const channelId = getMultipleChannelId(radio);
    insertMultipleSession([radio]);
    let releaseOldStart: () => void = () => undefined;
    let startCount = 0;
    const context = createTestContext();
    context.audio.playSound = mock(
      (soundId: string) =>
        new Promise<void>((resolve) => {
          startCount += 1;
          if (startCount === 1) {
            releaseOldStart = resolve;
            return;
          }
          setPlaybackChannelRuntime(channelId, () => ({
            isPlaying: true,
            soundId,
          }));
          resolve();
        })
    );
    context.audio.pauseSound = mock(() => {
      setPlaybackChannelRuntime(channelId, () => ({ isPlaying: false }));
    });
    const playback = getMultiplePlayback({ ctx: context });

    const oldPlayAll = playback.playAll();
    await Promise.resolve();
    await Promise.resolve();
    playback.pauseAll();
    await playback.setPlaying(channelId, true);
    releaseOldStart();
    await oldPlayAll;

    expect(getPlaybackChannelRuntime(channelId)).toMatchObject({
      isPlaying: true,
      soundId: `multiple:${channelId}`,
    });
  });

  test("a newer pause reclaims an older paused start from a manual resume", async () => {
    const radio = station("repaused-resume");
    const channelId = getMultipleChannelId(radio);
    insertMultipleSession([radio]);
    let releaseOldStart: () => void = () => undefined;
    let startCount = 0;
    const context = createTestContext();
    context.audio.playSound = mock(
      (soundId: string) =>
        new Promise<void>((resolve) => {
          startCount += 1;
          if (startCount === 1) {
            releaseOldStart = () => {
              setPlaybackChannelRuntime(channelId, () => ({
                isPlaying: true,
                soundId,
              }));
              resolve();
            };
            return;
          }
          setPlaybackChannelRuntime(channelId, () => ({
            isPlaying: true,
            soundId,
          }));
          resolve();
        })
    );
    context.audio.pauseSound = mock(() => {
      setPlaybackChannelRuntime(channelId, () => ({ isPlaying: false }));
    });
    const playback = getMultiplePlayback({ ctx: context });

    const oldPlayAll = playback.playAll();
    await Promise.resolve();
    await Promise.resolve();
    playback.pauseAll();
    await playback.setPlaying(channelId, true);
    playback.pauseAll();
    releaseOldStart();
    await oldPlayAll;

    expect(getPlaybackChannelRuntime(channelId).isPlaying).toBe(false);
  });

  test("ignores a rejected Channel start after a newer start wins", async () => {
    const radio = station("superseded-rejection");
    const channelId = getMultipleChannelId(radio);
    insertMultipleSession([radio]);
    let rejectStaleStart: (reason?: unknown) => void = () => undefined;
    let attempt = 0;
    const context = createTestContext();
    context.audio.playSound = mock(
      (soundId: string) =>
        new Promise<void>((resolve, reject) => {
          attempt += 1;
          if (attempt === 1) {
            rejectStaleStart = reject;
            return;
          }
          setPlaybackChannelRuntime(channelId, () => ({
            isPlaying: true,
            soundId,
          }));
          resolve();
        })
    );
    const playback = getMultiplePlayback({ ctx: context });

    const staleStart = playback.playAll();
    await Promise.resolve();
    await Promise.resolve();
    await playback.setPlaying(channelId, true);
    rejectStaleStart(new Error("superseded start failure"));
    await staleStart;

    expect(getPlaybackChannelRuntime(channelId)).toMatchObject({
      error: null,
      isPlaying: true,
      soundId: `multiple:${channelId}`,
    });
    expect(context.reportError).not.toHaveBeenCalled();
  });

  test("removing a Channel suppresses its deferred start rejection", async () => {
    const radio = station("removed-rejection");
    const channelId = getMultipleChannelId(radio);
    insertMultipleSession([radio]);
    let rejectStart: (reason?: unknown) => void = () => undefined;
    const context = createTestContext();
    context.audio.playSound = mock(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectStart = reject;
        })
    );
    const playback = getMultiplePlayback({ ctx: context });

    const playing = playback.playAll();
    await Promise.resolve();
    await Promise.resolve();
    playback.removeChannel(channelId);
    rejectStart(new Error("failure after removal"));
    await playing;

    expect(getPlaybackSession("multiple")?.channels).toEqual([]);
    expect(getPlaybackChannelRuntime(channelId)).toMatchObject({
      error: null,
      isPlaying: false,
      soundId: null,
    });
    expect(context.reportError).not.toHaveBeenCalled();
  });

  test("removing a Channel cleans its deferred start completion", async () => {
    const radio = station("removed-completion");
    const channelId = getMultipleChannelId(radio);
    insertMultipleSession([radio]);
    let resolveStart: () => void = () => undefined;
    const context = createTestContext();
    context.audio.playSound = mock(
      (soundId: string) =>
        new Promise<void>((resolve) => {
          resolveStart = () => {
            setPlaybackChannelRuntime(channelId, () => ({
              isPlaying: true,
              soundId,
            }));
            resolve();
          };
        })
    );
    const playback = getMultiplePlayback({ ctx: context });

    const playing = playback.playAll();
    await Promise.resolve();
    await Promise.resolve();
    playback.removeChannel(channelId);
    resolveStart();
    await playing;

    expect(getPlaybackSession("multiple")?.channels).toEqual([]);
    expect(getPlaybackChannelRuntime(channelId)).toMatchObject({
      error: null,
      isPlaying: false,
      soundId: null,
    });
    expect(context.reportError).not.toHaveBeenCalled();
  });

  test("removing a Channel cleans an older superseded start completion", async () => {
    const radio = station("removed-superseded-completion");
    const channelId = getMultipleChannelId(radio);
    insertMultipleSession([radio]);
    let resolveStaleStart: () => void = () => undefined;
    let attempt = 0;
    const context = createTestContext();
    context.audio.playSound = mock(
      (soundId: string) =>
        new Promise<void>((resolve) => {
          attempt += 1;
          if (attempt === 1) {
            resolveStaleStart = () => {
              setPlaybackChannelRuntime(channelId, () => ({
                isPlaying: true,
                soundId,
              }));
              resolve();
            };
            return;
          }
          setPlaybackChannelRuntime(channelId, () => ({
            isPlaying: true,
            soundId,
          }));
          resolve();
        })
    );
    const playback = getMultiplePlayback({ ctx: context });

    const staleStart = playback.playAll();
    await Promise.resolve();
    await Promise.resolve();
    await playback.setPlaying(channelId, true);
    playback.removeChannel(channelId);
    resolveStaleStart();
    await staleStart;

    expect(getPlaybackSession("multiple")?.channels).toEqual([]);
    expect(getPlaybackChannelRuntime(channelId)).toMatchObject({
      error: null,
      isPlaying: false,
      soundId: null,
    });
    expect(context.reportError).not.toHaveBeenCalled();
  });

  test("Station synchronization suppresses a removed Channel rejection", async () => {
    const radio = station("synchronized-rejection");
    const channelId = getMultipleChannelId(radio);
    insertMultipleSession([radio]);
    let rejectStart: (reason?: unknown) => void = () => undefined;
    const context = createTestContext();
    context.audio.playSound = mock(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectStart = reject;
        })
    );
    const playback = getMultiplePlayback({ ctx: context });

    const playing = playback.playAll();
    await Promise.resolve();
    await Promise.resolve();
    playback.synchronizeStations([], []);
    rejectStart(new Error("failure after synchronization"));
    await playing;

    expect(getPlaybackSession("multiple")?.channels).toEqual([]);
    expect(getPlaybackChannelRuntime(channelId)).toMatchObject({
      error: null,
      isPlaying: false,
      soundId: null,
    });
    expect(context.reportError).not.toHaveBeenCalled();
  });

  test("Station synchronization cleans a removed Channel completion", async () => {
    const radio = station("synchronized-completion");
    const channelId = getMultipleChannelId(radio);
    insertMultipleSession([radio]);
    let resolveStart: () => void = () => undefined;
    const context = createTestContext();
    context.audio.playSound = mock(
      (soundId: string) =>
        new Promise<void>((resolve) => {
          resolveStart = () => {
            setPlaybackChannelRuntime(channelId, () => ({
              isPlaying: true,
              soundId,
            }));
            resolve();
          };
        })
    );
    const playback = getMultiplePlayback({ ctx: context });

    const playing = playback.playAll();
    await Promise.resolve();
    await Promise.resolve();
    playback.synchronizeStations([], []);
    resolveStart();
    await playing;

    expect(getPlaybackSession("multiple")?.channels).toEqual([]);
    expect(getPlaybackChannelRuntime(channelId)).toMatchObject({
      error: null,
      isPlaying: false,
      soundId: null,
    });
    expect(context.reportError).not.toHaveBeenCalled();
  });

  test("keeps play-all failures local to their Channel", async () => {
    const good = station("good");
    const bad = station("bad");
    insertMultipleSession([good, bad]);
    const context = createTestContext();
    context.audio.playSound = mock((soundId: string) =>
      soundId.includes("bad")
        ? Promise.reject(new Error("raw failed stream detail"))
        : Promise.resolve()
    );

    await getMultiplePlayback({ ctx: context }).playAll();

    expect(
      getPlaybackChannelRuntime(getMultipleChannelId(good)).error
    ).toBeNull();
    expect(
      getPlaybackChannelRuntime(getMultipleChannelId(bad)).error
    ).toMatchObject({
      code: "PLAY_ERROR",
      message:
        "The stream could not be reached. Check the station URL and try again.",
    });
    expect(context.reportError).toHaveBeenCalledTimes(1);
  });

  test("reconciles main output settings when playback activates a Channel", async () => {
    const radio = station("routed");
    const channelId = getMultipleChannelId(radio);
    insertMultipleSession([radio]);
    const patches: unknown[] = [];
    const context = createTestContext();
    context.lifecycle.mainOutputSettingsApplied = false;
    context.getMainOutputRouter = () =>
      ({
        applyMainSettings: (patch: unknown) => {
          patches.push(patch);
          return Promise.resolve({});
        },
        applySettings: () => {
          throw new Error("full output transaction should not run");
        },
      }) as unknown as OutputRouting;

    await getMultiplePlayback({ ctx: context }).setPlaying(channelId, true);

    expect(patches).toEqual([
      {
        mainDelayMs: expect.any(Number),
        mainOutputId: expect.any(String),
      },
    ]);
    expect(context.lifecycle.mainOutputSettingsApplied).toBe(true);
  });

  test("deactivation owns orphan cleanup and runtime reset", async () => {
    insertMultipleSession();
    const channelId = "multi:orphan";
    setPlaybackChannelRuntime(channelId, () => ({
      soundId: "multiple:orphan",
      isPlaying: true,
      error: {
        id: "stale",
        code: "STREAM_ABORTED",
        message: "stale",
        timestamp: 1,
      },
    }));
    const liveSounds = new Set(["multiple:orphan"]);
    const context = createTestContext();
    context.audio.hasSound = mock((soundId: string) => liveSounds.has(soundId));
    context.audio.cleanupSound = mock((soundId: string) => {
      liveSounds.delete(soundId);
    });
    const playback = getMultiplePlayback({ ctx: context });

    await playback.deactivate();

    expect(liveSounds.size).toBe(0);
    expect(getPlaybackChannelRuntime(channelId)).toMatchObject({
      soundId: null,
      isPlaying: false,
      error: null,
    });
  });

  test("re-adding a Station preserves its persisted Channel controls", async () => {
    const radio = station("saved");
    const channelId = getMultipleChannelId(radio);
    insertMultipleSession([radio]);
    updatePlaybackChannel("multiple", channelId, (draft) => {
      draft.volume = 0.37;
      draft.muted = true;
      draft.filter = {
        type: "highpass",
        frequency: 2200,
        Q: 0.8,
        gain: 0,
        enabled: true,
      };
    });

    await getMultiplePlayback({ ctx: createTestContext() }).addStation(radio);

    expect(getPlaybackSession("multiple")?.channels).toEqual([
      expect.objectContaining({
        id: channelId,
        volume: 0.37,
        muted: true,
        filter: {
          type: "highpass",
          frequency: 2200,
          Q: 0.8,
          gain: 0,
          enabled: true,
        },
      }),
    ]);
  });

  test("activation restores valid Stations and resets local files", async () => {
    const valid = station("valid");
    const local = {
      ...station("local"),
      streamUrl: "blob:https://radio.example/local",
      platformMetadata: {
        platform: "local-file",
        itemType: "track",
        url: "",
        fileName: "local.mp3",
        displayName: "Local",
        duration: 10,
        fileSize: 100,
        mimeType: "audio/mpeg",
        objectUrl: "blob:https://radio.example/local",
      },
    } as Radio;
    insertMultipleSession([valid, local]);
    const localChannelId = getMultipleChannelId(local);
    setPlaybackChannelRuntime(localChannelId, () => ({
      soundId: "multiple:local",
      isPlaying: true,
    }));

    await getMultiplePlayback({ ctx: createTestContext() }).activate();

    expect(getPlaybackChannelRuntime(getMultipleChannelId(valid)).soundId).toBe(
      `multiple:${getMultipleChannelId(valid)}`
    );
    expect(getPlaybackChannelRuntime(localChannelId)).toMatchObject({
      soundId: null,
      isPlaying: false,
      error: null,
    });
  });

  test("activation reapplies persisted Channel mute", async () => {
    const radio = station("restored-muted");
    const channelId = getMultipleChannelId(radio);
    insertMultipleSession([radio]);
    updatePlaybackChannel("multiple", channelId, (draft) => {
      draft.muted = true;
    });
    const context = createTestContext();

    await getMultiplePlayback({ ctx: context }).activate();

    expect(context.channels.setMuted).toHaveBeenCalledWith(
      "multiple",
      channelId,
      true
    );
  });
});
