import { afterEach, describe, expect, mock, test } from "bun:test";
import { DeviceSource } from "./device-source";

const originalNavigator = globalThis.navigator;

afterEach(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: originalNavigator,
  });
});

describe("DeviceSource capture policy", () => {
  test("matches openDAW's production capture constraints", async () => {
    let muted = false;
    let readyState: MediaStreamTrackState = "live";
    const settings = {
      autoGainControl: false,
      channelCount: 1,
      deviceId: "pixel-mic",
      echoCancellation: false,
      latency: 0.012,
      noiseSuppression: false,
      sampleRate: 48_000,
    };
    const track = {
      getSettings: () => settings,
      label: "Pixel microphone",
      get muted() {
        return muted;
      },
      get readyState() {
        return readyState;
      },
      stop: () => undefined,
    };
    const getUserMedia = mock(async () => ({
      getAudioTracks: () => [track],
      getTracks: () => [],
    }));
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        mediaDevices: {
          addEventListener: () => undefined,
          getUserMedia,
          removeEventListener: () => undefined,
        },
      },
    });
    const node = {
      connect: () => undefined,
      disconnect: () => undefined,
    };
    const createChannelMerger = mock(() => node);
    const context = {
      createChannelMerger,
      createChannelSplitter: () => node,
      createGain: () => ({ ...node, gain: { value: 0 } }),
      createMediaStreamSource: () => node,
    } as unknown as AudioContext;
    const source = new DeviceSource(context, "mic");

    await source.start("pixel-mic");

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        autoGainControl: false,
        channelCount: { ideal: 2 },
        deviceId: { exact: "pixel-mic" },
        echoCancellation: false,
        noiseSuppression: false,
      },
    });
    expect(source.channelCount).toBe(1);
    expect(createChannelMerger).not.toHaveBeenCalled();
    expect(source.getDiagnostics()).toEqual({
      actual: settings,
      label: "Pixel microphone",
      muted: false,
      readyState: "live",
      requested: {
        autoGainControl: false,
        channelCount: { ideal: 2 },
        deviceId: { exact: "pixel-mic" },
        echoCancellation: false,
        noiseSuppression: false,
      },
    });

    muted = true;
    readyState = "ended";

    expect(source.getDiagnostics()).toEqual(
      expect.objectContaining({ muted: true, readyState: "ended" })
    );

    source.stop();

    expect(source.getDiagnostics()).toBeNull();
  });

  test("keeps a selected channel from a stereo device mono", async () => {
    const settings = { channelCount: 2, deviceId: "stereo-interface" };
    const track = {
      getSettings: () => settings,
      label: "Stereo interface",
      muted: false,
      readyState: "live" as const,
      stop: () => undefined,
    };
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        mediaDevices: {
          addEventListener: () => undefined,
          getUserMedia: async () => ({
            getAudioTracks: () => [track],
            getTracks: () => [track],
          }),
          removeEventListener: () => undefined,
        },
      },
    });
    const routingOutput = {
      channelCount: 2,
      channelCountMode: "max",
      connect: mock(() => undefined),
      disconnect: mock(() => undefined),
      gain: { value: 0 },
    };
    const splitter = {
      connect: mock(() => undefined),
      disconnect: mock(() => undefined),
    };
    const createChannelMerger = mock(() => ({
      connect: mock(() => undefined),
      disconnect: mock(() => undefined),
    }));
    const context = {
      createChannelMerger,
      createChannelSplitter: () => splitter,
      createGain: () => routingOutput,
      createMediaStreamSource: () => ({
        connect: mock(() => undefined),
        disconnect: mock(() => undefined),
      }),
    } as unknown as AudioContext;
    const source = new DeviceSource(context, "stereo-input");

    source.setChannelSelection({ left: 0, right: 0 });
    await source.start("stereo-interface");

    expect(source.outputChannelCount).toBe(1);
    expect(routingOutput.channelCount).toBe(1);
    expect(createChannelMerger).not.toHaveBeenCalled();
    expect(splitter.connect).toHaveBeenCalledWith(routingOutput, 0, 0);

    source.stop();
  });
});
