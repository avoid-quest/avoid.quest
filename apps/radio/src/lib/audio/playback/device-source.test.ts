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
    const settings = {
      autoGainControl: false,
      channelCount: 1,
      deviceId: "pixel-mic",
      echoCancellation: false,
      latency: 0.012,
      noiseSuppression: false,
      sampleRate: 48_000,
    };
    const getUserMedia = mock(async () => ({
      getAudioTracks: () => [
        {
          getSettings: () => settings,
          label: "Pixel microphone",
          muted: false,
          readyState: "live",
          stop: () => undefined,
        },
      ],
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
  });
});
