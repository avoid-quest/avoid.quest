import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Readable } from "node:stream";
import type { QueueTrack } from "./queue";

const audioPlayerPlayMock = mock((_resource: unknown) => undefined);
const audioPlayerStopMock = mock((_force?: boolean) => true);
const createAudioResourceMock = mock((input: unknown, options: unknown) => ({
  input,
  options,
  volume: {
    setVolume: mock((_volume: number) => undefined),
  },
}));
const joinVoiceChannelMock = mock((_options: unknown) => ({
  destroy: mock(() => undefined),
  on: mock(
    (_event: string, _listener: (...args: unknown[]) => void) => undefined
  ),
  state: { status: "ready" },
  subscribe: mock((_player: unknown) => undefined),
}));

const AudioPlayerStatus = {
  Buffering: "buffering",
  Idle: "idle",
  Paused: "paused",
  Playing: "playing",
} as const;
const VoiceConnectionStatus = {
  Connecting: "connecting",
  Disconnected: "disconnected",
  Ready: "ready",
  Signalling: "signalling",
} as const;

mock.module("@discordjs/voice", () => ({
  AudioPlayerStatus,
  VoiceConnectionStatus,
  createAudioPlayer: () => {
    const player = {
      on: mock(
        (_event: string, _listener: (...args: unknown[]) => void) => player
      ),
      pause: mock(() => {
        player.state.status = AudioPlayerStatus.Paused;
        return true;
      }),
      play: mock((resource: unknown) => {
        player.state = {
          resource,
          status: AudioPlayerStatus.Playing,
        };
        audioPlayerPlayMock(resource);
      }),
      state: { status: AudioPlayerStatus.Idle } as {
        resource?: unknown;
        status: (typeof AudioPlayerStatus)[keyof typeof AudioPlayerStatus];
      },
      stop: mock((force?: boolean) => {
        player.state = { status: AudioPlayerStatus.Idle };
        audioPlayerStopMock(force);
        return true;
      }),
      unpause: mock(() => {
        player.state.status = AudioPlayerStatus.Playing;
        return true;
      }),
    };
    return player;
  },
  createAudioResource: createAudioResourceMock,
  entersState: mock(async () => undefined),
  joinVoiceChannel: joinVoiceChannelMock,
}));

const fetchDirectAudioStreamMock = mock(
  async (_url: string, _options?: { signal?: AbortSignal }) => {
    await Promise.resolve();
    throw new Error("fetchDirectAudioStream mock not configured");
  }
);

mock.module("./direct-audio.js", () => ({
  fetchDirectAudioStream: fetchDirectAudioStreamMock,
}));

mock.module("./stream-resolver.js", () => ({
  resolveYouTubeStreamUrl: mock(async () => null),
}));

const {
  clearGuildPlayback,
  skipGuildPlayback,
  startGuildPlayback,
  stopGuildPlayback,
} = await import("./guild-player");

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createVoiceChannel(guildId: string) {
  return {
    client: {
      rest: {
        put: mock(async () => undefined),
      },
      user: { id: "bot-user" },
    },
    guild: {
      id: guildId,
      voiceAdapterCreator: {},
    },
    id: `voice-${guildId}`,
    members: new Map([["bot-user", {}]]),
  };
}

function createTrack(
  id: string,
  overrides: Partial<QueueTrack> = {}
): QueueTrack {
  return {
    artist: "",
    isLiveStream: false,
    platform: "static-audio",
    requestedBy: "tester",
    streamUrl: `https://audio.example/${id}.mp3`,
    title: id,
    url: `https://audio.example/${id}.mp3`,
    ...overrides,
  };
}

function createDirectAudioStream(id: string): Readable {
  return Readable.from([Buffer.from(id)]);
}

beforeEach(() => {
  audioPlayerPlayMock.mockClear();
  audioPlayerStopMock.mockClear();
  createAudioResourceMock.mockClear();
  fetchDirectAudioStreamMock.mockClear();
  joinVoiceChannelMock.mockClear();
});

describe("GuildPlayer direct audio invalidation", () => {
  test("clear aborts a pending direct-audio fetch before it can play", async () => {
    const guildId = "guild-clear-pending";
    const pendingFetch = createDeferred<{
      resolvedUrl: string;
      stream: Readable;
    }>();
    let fetchSignal: AbortSignal | undefined;
    fetchDirectAudioStreamMock.mockImplementation((_url, options) => {
      fetchSignal = options?.signal;
      return pendingFetch.promise;
    });

    const startPromise = startGuildPlayback({
      guildId,
      tracks: [createTrack("first")],
      voiceChannel: createVoiceChannel(guildId) as never,
    });
    await flushPromises();

    expect(fetchDirectAudioStreamMock).toHaveBeenCalledTimes(1);
    expect(fetchSignal?.aborted).toBe(false);
    expect(clearGuildPlayback(guildId)).toEqual({ status: "cleared" });
    expect(fetchSignal?.aborted).toBe(true);

    pendingFetch.resolve({
      resolvedUrl: "https://cdn.example/first.mp3",
      stream: createDirectAudioStream("first"),
    });
    await startPromise;
    await flushPromises();

    expect(audioPlayerPlayMock).not.toHaveBeenCalled();
  });

  test("new playback aborts stale direct-audio fetches and only plays the replacement", async () => {
    const guildId = "guild-replace-pending";
    const fetches: Array<{
      deferred: Deferred<{ resolvedUrl: string; stream: Readable }>;
      signal?: AbortSignal;
    }> = [];
    fetchDirectAudioStreamMock.mockImplementation((_url, options) => {
      const deferred = createDeferred<{
        resolvedUrl: string;
        stream: Readable;
      }>();
      fetches.push({ deferred, signal: options?.signal });
      return deferred.promise;
    });

    const firstStart = startGuildPlayback({
      guildId,
      tracks: [createTrack("first")],
      voiceChannel: createVoiceChannel(guildId) as never,
    });
    await flushPromises();

    const secondStart = startGuildPlayback({
      guildId,
      tracks: [createTrack("second")],
      voiceChannel: createVoiceChannel(guildId) as never,
    });
    await flushPromises();

    expect(fetches).toHaveLength(2);
    expect(fetches[0]?.signal?.aborted).toBe(true);
    expect(fetches[1]?.signal?.aborted).toBe(false);

    fetches[0]?.deferred.resolve({
      resolvedUrl: "https://cdn.example/first.mp3",
      stream: createDirectAudioStream("first"),
    });
    await firstStart;
    await flushPromises();
    expect(audioPlayerPlayMock).not.toHaveBeenCalled();

    const replacementStream = createDirectAudioStream("second");
    fetches[1]?.deferred.resolve({
      resolvedUrl: "https://cdn.example/second.mp3",
      stream: replacementStream,
    });
    await secondStart;
    await flushPromises();

    expect(audioPlayerPlayMock).toHaveBeenCalledTimes(1);
    expect(createAudioResourceMock).toHaveBeenCalledWith(
      replacementStream,
      expect.objectContaining({ inlineVolume: true })
    );
  });

  test("skip aborts a pending direct-audio fetch and starts the next track", async () => {
    const guildId = "guild-skip-pending";
    const fetches: Array<{
      deferred: Deferred<{ resolvedUrl: string; stream: Readable }>;
      signal?: AbortSignal;
    }> = [];
    fetchDirectAudioStreamMock.mockImplementation((_url, options) => {
      const deferred = createDeferred<{
        resolvedUrl: string;
        stream: Readable;
      }>();
      fetches.push({ deferred, signal: options?.signal });
      return deferred.promise;
    });

    const startPromise = startGuildPlayback({
      guildId,
      tracks: [createTrack("first"), createTrack("second")],
      voiceChannel: createVoiceChannel(guildId) as never,
    });
    await flushPromises();

    expect(skipGuildPlayback(guildId)).toMatchObject({
      status: "playing-next",
      track: expect.objectContaining({ title: "second" }),
    });
    await flushPromises();

    expect(fetches).toHaveLength(2);
    expect(fetches[0]?.signal?.aborted).toBe(true);
    expect(fetches[1]?.signal?.aborted).toBe(false);

    fetches[0]?.deferred.resolve({
      resolvedUrl: "https://cdn.example/first.mp3",
      stream: createDirectAudioStream("first"),
    });
    await startPromise;
    await flushPromises();
    expect(audioPlayerPlayMock).not.toHaveBeenCalled();

    const nextStream = createDirectAudioStream("second");
    fetches[1]?.deferred.resolve({
      resolvedUrl: "https://cdn.example/second.mp3",
      stream: nextStream,
    });
    await flushPromises();

    expect(audioPlayerPlayMock).toHaveBeenCalledTimes(1);
    expect(createAudioResourceMock).toHaveBeenLastCalledWith(
      nextStream,
      expect.objectContaining({ inlineVolume: true })
    );
  });

  test("stop destroys the player and invalidates pending direct-audio playback", async () => {
    const guildId = "guild-stop-pending";
    const pendingFetch = createDeferred<{
      resolvedUrl: string;
      stream: Readable;
    }>();
    let fetchSignal: AbortSignal | undefined;
    fetchDirectAudioStreamMock.mockImplementation((_url, options) => {
      fetchSignal = options?.signal;
      return pendingFetch.promise;
    });

    const startPromise = startGuildPlayback({
      guildId,
      tracks: [createTrack("first")],
      voiceChannel: createVoiceChannel(guildId) as never,
    });
    await flushPromises();

    expect(stopGuildPlayback(guildId)).toEqual({ status: "stopped" });
    expect(fetchSignal?.aborted).toBe(true);

    pendingFetch.resolve({
      resolvedUrl: "https://cdn.example/first.mp3",
      stream: createDirectAudioStream("first"),
    });
    await startPromise;
    await flushPromises();

    expect(audioPlayerPlayMock).not.toHaveBeenCalled();
  });
});
