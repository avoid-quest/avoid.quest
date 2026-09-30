import { afterEach, describe, expect, mock, test } from "bun:test";
import { startDeviceInput } from "@/lib/device-input-playback";
import { DeviceSource } from "./device-source";
import { requestDisplayAudio } from "./display-audio";

const originalNavigator = globalThis.navigator;
afterEach(() =>
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: originalNavigator,
  })
);

function capture() {
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
      getSettings: () => ({ channelCount: 2 }),
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
        selfBrowserSurface: "exclude",
        systemAudio: "include",
        video: { displaySurface: "browser", frameRate: 1 },
      })
    );
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
