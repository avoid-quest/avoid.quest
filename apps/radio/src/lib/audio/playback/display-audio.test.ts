import { afterEach, describe, expect, mock, test } from "bun:test";
import { startDeviceInput } from "@/lib/device-input-playback";
import { DeviceSource } from "./device-source";
import {
  DisplayAudioError,
  isDisplayAudioCancel,
  requestDisplayAudio,
} from "./display-audio";

const originalNavigator = globalThis.navigator;
afterEach(() =>
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: originalNavigator,
  })
);

function capture(displaySurface: string | null = "browser") {
  const tracks = ["audio", "video"].map((kind) => {
    const listeners = new Set<() => void>();
    return {
      addEventListener: (_event: string, listener: () => void) =>
        listeners.add(listener),
      end: () => {
        for (const listener of listeners) {
          listener();
        }
      },
      getSettings: () =>
        kind === "video"
          ? { displaySurface: displaySurface ?? undefined }
          : { channelCount: 2 },
      kind,
      label: kind,
      readyState: "live",
      removeEventListener: (_event: string, listener: () => void) =>
        listeners.delete(listener),
      stop: mock(() => undefined),
    };
  });
  const stream = {
    getAudioTracks: () => tracks.slice(0, 1),
    getTracks: () => tracks,
    getVideoTracks: () => tracks.slice(1),
  } as unknown as MediaStream;
  return { stream, tracks };
}

function browser(getDisplayMedia: () => Promise<MediaStream>) {
  const getUserMedia = mock(() =>
    Promise.reject(new Error("Must not request a microphone"))
  );
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        addEventListener: () => undefined,
        getDisplayMedia,
        getUserMedia,
        removeEventListener: () => undefined,
      },
    },
  });
  return getUserMedia;
}

describe("browser audio capture", () => {
  test("opens the picker before engine setup and hands the selected stream to the mixer", async () => {
    const { stream } = capture();
    const order: string[] = [];
    const getDisplayMedia = mock(() => {
      order.push("picker");
      return Promise.resolve(stream);
    });
    const getUserMedia = browser(getDisplayMedia);
    const startDevice = mock(() => {
      order.push("engine");
      return Promise.resolve();
    });
    await startDeviceInput(
      { getDeviceChannelCount: () => 2, startDevice },
      "deck",
      {
        capture: "display",
        channelSelection: { left: 0, right: 1 },
        deviceId: "display",
      }
    );
    expect(order).toEqual(["picker", "engine"]);
    expect(startDevice).toHaveBeenCalledWith(
      "deck",
      "display",
      { stream },
      { left: 0, right: 1 }
    );
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(getDisplayMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        audio: expect.objectContaining({
          restrictOwnAudio: true,
          suppressLocalAudioPlayback: true,
        }),
        monitorTypeSurfaces: "exclude",
        selfBrowserSurface: "exclude",
        systemAudio: "exclude",
        video: { displaySurface: "browser", frameRate: 1 },
        windowAudio: "exclude",
      })
    );
  });

  test.each(["monitor", "window", null])(
    "a %s share is refused and released so the mixer cannot capture its own output",
    async (surface) => {
      const { stream, tracks } = capture(surface);
      browser(() => Promise.resolve(stream));
      await expect(requestDisplayAudio()).rejects.toThrow(
        "Share a browser tab"
      );
      for (const track of tracks) {
        expect(track.stop).toHaveBeenCalledTimes(1);
      }
    }
  );

  test("closing the picker is a quiet cancel; a call outside a click says to click", async () => {
    browser(() =>
      Promise.reject(new DOMException("Permission denied", "NotAllowedError"))
    );
    const cancelled = await requestDisplayAudio().catch((error) => error);
    expect(isDisplayAudioCancel(cancelled)).toBe(true);
    browser(() =>
      Promise.reject(new DOMException("No activation", "InvalidStateError"))
    );
    const blocked = await requestDisplayAudio().catch((error) => error);
    expect(isDisplayAudioCancel(blocked)).toBe(false);
    expect(blocked).toBeInstanceOf(DisplayAudioError);
    expect((blocked as Error).message).toBe(
      "Tab audio sharing must start from a click. Try again."
    );
  });

  test("reports the share picker as pending until the start settles", async () => {
    const { stream } = capture();
    const states: boolean[] = [];
    const seen: string[] = [];
    browser(() => {
      seen.push(`picker ${states.join()}`);
      return Promise.resolve(stream);
    });
    const startDevice = mock(() => {
      seen.push(`engine ${states.join()}`);
      return Promise.resolve();
    });
    const audio = { getDeviceChannelCount: () => 2, startDevice };
    const target = {
      channelSelection: { left: 0, right: 1 },
      deviceId: "display",
    };
    const onPending = (state: boolean) => states.push(state);
    await startDeviceInput(
      audio,
      "node",
      { ...target, capture: "display" },
      () => true,
      onPending
    );
    expect(seen).toEqual(["picker true", "engine true"]);
    expect(states).toEqual([true, false]);
    // A stream acquired by the caller, or a mic, opens no picker here.
    await startDeviceInput(
      audio,
      "node",
      { ...target, capture: "display", stream },
      () => true,
      onPending
    );
    await startDeviceInput(audio, "node", target, () => true, onPending);
    expect(states).toEqual([true, false]);
  });

  test("a video-only selection is released and produces an actionable error", async () => {
    const { stream, tracks } = capture();
    stream.getAudioTracks = () => [];
    browser(() => Promise.resolve(stream));
    await expect(requestDisplayAudio()).rejects.toThrow("No audio was shared");
    for (const track of tracks) {
      expect(track.stop).toHaveBeenCalledTimes(1);
    }
  });

  test("a cancelled pending source releases audio and video without starting the engine", async () => {
    const { stream, tracks } = capture();
    const pending = Promise.withResolvers<MediaStream>();
    browser(() => pending.promise);
    const startDevice = mock(() => Promise.resolve());
    let current = true;
    const start = startDeviceInput(
      { getDeviceChannelCount: () => 2, startDevice },
      "node",
      {
        capture: "display",
        channelSelection: { left: 0, right: 1 },
        deviceId: "display",
      },
      () => current
    );
    current = false;
    pending.resolve(stream);
    expect(await start).toBeNull();
    expect(startDevice).not.toHaveBeenCalled();
    for (const track of tracks) {
      expect(track.stop).toHaveBeenCalledTimes(1);
    }
  });

  test("engine failures release a selected capture", async () => {
    const { stream, tracks } = capture();
    browser(() => Promise.resolve(stream));
    await expect(
      startDeviceInput(
        {
          getDeviceChannelCount: () => null,
          startDevice: () => Promise.reject(new Error("Engine failed")),
        },
        "deck",
        {
          capture: "display",
          channelSelection: { left: 0, right: 1 },
          deviceId: "display",
        }
      )
    ).rejects.toThrow("Engine failed");
    for (const track of tracks) {
      expect(track.stop).toHaveBeenCalled();
    }
  });

  test("a share that ended during engine setup is rejected and released", async () => {
    const { stream, tracks } = capture();
    browser(() => Promise.resolve(stream));
    const [audioTrack] = tracks;
    if (!audioTrack) {
      throw new Error("Expected an audio track");
    }
    audioTrack.readyState = "ended";
    const node = {
      connect: () => undefined,
      disconnect: () => undefined,
      gain: { value: 1 },
    };
    const createMediaStreamSource = mock(() => node);
    const source = new DeviceSource(
      {
        createGain: () => node,
        createMediaStreamSource,
      } as unknown as AudioContext,
      "capture"
    );
    await expect(source.start("display", { stream })).rejects.toThrow(
      "Audio sharing ended"
    );
    expect(source.isActive).toBe(false);
    expect(createMediaStreamSource).not.toHaveBeenCalled();
    for (const track of tracks) {
      expect(track.stop).toHaveBeenCalled();
    }
  });

  test("Stop sharing on either track releases the full capture and marks the input inactive", async () => {
    const { stream, tracks } = capture();
    const getUserMedia = browser(() => Promise.resolve(stream));
    const node = {
      connect: () => undefined,
      disconnect: () => undefined,
      gain: { value: 1 },
    };
    const createMediaStreamSource = mock(() => node);
    const inactive = mock(() => undefined);
    const source = new DeviceSource(
      {
        createGain: () => node,
        createMediaStreamSource,
      } as unknown as AudioContext,
      "capture",
      { onInactive: inactive }
    );
    await source.start("display", { stream });
    expect(source.isActive).toBe(true);
    expect(createMediaStreamSource).toHaveBeenCalledWith(stream);
    tracks[1]?.end();
    expect(source.isActive).toBe(false);
    expect(inactive).toHaveBeenCalledTimes(1);
    expect(getUserMedia).not.toHaveBeenCalled();
    for (const track of tracks) {
      expect(track.stop).toHaveBeenCalledTimes(1);
    }
  });
});
