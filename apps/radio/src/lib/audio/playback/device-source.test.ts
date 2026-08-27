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
  test("requests the lowest capture latency without browser voice processing", async () => {
    let muted = false;
    let readyState: MediaStreamTrackState = "live";
    const settings = {
      autoGainControl: false,
      channelCount: 1,
      deviceId: "pixel-mic",
      echoCancellation: false,
      latency: 0.04,
      noiseSuppression: false,
      sampleRate: 48_000,
    };
    const probeStop = mock(() => undefined);
    const probeTrack = {
      getCapabilities: () => ({ latency: { max: 0.1, min: 0.005 } }),
      getSettings: () => settings,
      label: "Pixel microphone",
      get muted() {
        return muted;
      },
      get readyState() {
        return readyState;
      },
      stop: probeStop,
    };
    const lowLatencySettings = { ...settings, latency: 0.005 };
    const lowLatencyTrack = {
      getCapabilities: () => ({ latency: { max: 0.1, min: 0.005 } }),
      getSettings: () => lowLatencySettings,
      label: "Pixel microphone",
      get muted() {
        return muted;
      },
      get readyState() {
        return readyState;
      },
      stop: mock(() => undefined),
    };
    let requestCount = 0;
    const getUserMedia = mock(() => {
      requestCount += 1;
      const track = requestCount === 1 ? probeTrack : lowLatencyTrack;
      return Promise.resolve({
        getAudioTracks: () => [track],
        getTracks: () => [track],
      });
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        mediaDevices: {
          addEventListener: () => undefined,
          getSupportedConstraints: () => ({ latency: true }),
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

    expect(getUserMedia).toHaveBeenNthCalledWith(1, {
      audio: {
        autoGainControl: false,
        channelCount: { ideal: 2 },
        deviceId: { exact: "pixel-mic" },
        echoCancellation: false,
        latency: { ideal: 0 },
        noiseSuppression: false,
      },
    });
    expect(getUserMedia).toHaveBeenNthCalledWith(2, {
      audio: {
        autoGainControl: false,
        channelCount: { exact: 1 },
        deviceId: { exact: "pixel-mic" },
        echoCancellation: false,
        latency: { exact: 0.005 },
        noiseSuppression: false,
      },
    });
    expect(source.channelCount).toBe(1);
    expect(probeStop).toHaveBeenCalledTimes(1);
    expect(createChannelMerger).not.toHaveBeenCalled();
    expect(source.getDiagnostics()).toEqual({
      actual: lowLatencySettings,
      capabilities: { latency: { max: 0.1, min: 0.005 } },
      label: "Pixel microphone",
      latencyConstraintSupported: true,
      latencyTrial: { result: "applied", target: 0.005 },
      muted: false,
      readyState: "live",
      requested: {
        autoGainControl: false,
        channelCount: { exact: 1 },
        deviceId: { exact: "pixel-mic" },
        echoCancellation: false,
        latency: { exact: 0.005 },
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

  test("reopens with the safe request when exact latency is rejected", async () => {
    const settings = {
      channelCount: 1,
      deviceId: "pixel-mic",
      latency: 0.04,
    };
    const createTrack = () => ({
      getCapabilities: () => ({ latency: { max: 0.04, min: 0.02 } }),
      getSettings: () => settings,
      label: "Pixel microphone",
      muted: false,
      readyState: "live" as const,
      stop: mock(() => undefined),
    });
    const probeTrack = createTrack();
    const fallbackTrack = createTrack();
    let requestCount = 0;
    const getUserMedia = mock(() => {
      requestCount += 1;
      if (requestCount === 2) {
        return Promise.reject(
          new DOMException("Unsupported latency", "OverconstrainedError")
        );
      }
      const track = requestCount === 1 ? probeTrack : fallbackTrack;
      return Promise.resolve({
        getAudioTracks: () => [track],
        getTracks: () => [track],
      });
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        mediaDevices: {
          addEventListener: () => undefined,
          getSupportedConstraints: () => ({ latency: true }),
          getUserMedia,
          removeEventListener: () => undefined,
        },
      },
    });
    const node = {
      connect: () => undefined,
      disconnect: () => undefined,
    };
    const context = {
      createChannelMerger: () => node,
      createChannelSplitter: () => node,
      createGain: () => ({ ...node, gain: { value: 0 } }),
      createMediaStreamSource: () => node,
    } as unknown as AudioContext;
    const source = new DeviceSource(context, "mic");

    await source.start("pixel-mic");

    expect(getUserMedia).toHaveBeenCalledTimes(3);
    expect(source.getDiagnostics()).toMatchObject({
      actual: settings,
      latencyTrial: { result: "rejected", target: 0.02 },
      requested: { latency: { ideal: 0 } },
    });
  });

  test("rejects a low-latency stream that enables voice processing", async () => {
    const rawSettings = {
      autoGainControl: false,
      channelCount: 1,
      echoCancellation: false,
      latency: 0.04,
      noiseSuppression: false,
    };
    const createTrack = (
      settings: MediaTrackSettings & { latency: number }
    ) => ({
      getCapabilities: () => ({ latency: { max: 0.04, min: 0.02 } }),
      getSettings: () => settings,
      label: "Pixel microphone",
      muted: false,
      readyState: "live" as const,
      stop: mock(() => undefined),
    });
    const rawTrack = createTrack(rawSettings);
    const processedTrack = createTrack({
      ...rawSettings,
      echoCancellation: true,
      latency: 0.02,
    });
    let requestCount = 0;
    const getUserMedia = mock(() => {
      requestCount += 1;
      let track = createTrack(rawSettings);
      if (requestCount === 1) {
        track = rawTrack;
      } else if (requestCount === 2) {
        track = processedTrack;
      }
      return Promise.resolve({
        getAudioTracks: () => [track],
        getTracks: () => [track],
      });
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        mediaDevices: {
          addEventListener: () => undefined,
          getSupportedConstraints: () => ({ latency: true }),
          getUserMedia,
          removeEventListener: () => undefined,
        },
      },
    });
    const node = {
      connect: () => undefined,
      disconnect: () => undefined,
    };
    const context = {
      createChannelMerger: () => node,
      createChannelSplitter: () => node,
      createGain: () => ({ ...node, gain: { value: 0 } }),
      createMediaStreamSource: () => node,
    } as unknown as AudioContext;
    const source = new DeviceSource(context, "mic");

    await source.start();

    expect(source.getDiagnostics()).toMatchObject({
      actual: rawSettings,
      latencyTrial: { result: "ignored", target: 0.02 },
      requested: { latency: { ideal: 0 } },
    });
  });
});
