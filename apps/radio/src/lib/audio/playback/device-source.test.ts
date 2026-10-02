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
  test.each(["stop", "cleanup"] as const)(
    "%s stops every track acquired after cancellation without activating",
    async (cancel) => {
      const pending = Promise.withResolvers<MediaStream>();
      const tracks = [
        { stop: mock(() => undefined) },
        { stop: mock(() => undefined) },
      ];
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: {
          mediaDevices: {
            addEventListener: () => undefined,
            getUserMedia: () => pending.promise,
            removeEventListener: () => undefined,
          },
        },
      });
      const createMediaStreamSource = mock(() => {
        throw new Error("cancelled capture must not create audio nodes");
      });
      const onActive = mock(() => undefined);
      const onError = mock(() => undefined);
      const onPermissionChange = mock(() => undefined);
      const source = new DeviceSource(
        { createMediaStreamSource } as unknown as AudioContext,
        "mic",
        { onActive, onError, onPermissionChange }
      );

      const start = source.start("usb-mic");
      source[cancel]();
      pending.resolve({
        getAudioTracks: () => [],
        getTracks: () => tracks,
      } as unknown as MediaStream);
      await start;

      for (const track of tracks) {
        expect(track.stop).toHaveBeenCalledTimes(1);
      }
      expect(source.isActive).toBe(false);
      expect(source.output).toBeNull();
      expect(source.currentDeviceId).toBeNull();
      expect(createMediaStreamSource).not.toHaveBeenCalled();
      expect(onActive).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
      expect(onPermissionChange).not.toHaveBeenCalled();
    }
  );

  test.each(["resolve", "reject"] as const)(
    "a new acquisition ignores the previous request's late %s",
    async (settle) => {
      const previous = Promise.withResolvers<MediaStream>();
      const current = Promise.withResolvers<MediaStream>();
      const getUserMedia = mock(() => current.promise).mockImplementationOnce(
        () => previous.promise
      );
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
        gain: { value: 1 },
      };
      const context = {
        createGain: () => node,
        createMediaStreamSource: mock(() => node),
      } as unknown as AudioContext;
      const onActive = mock(() => undefined);
      const onError = mock(() => undefined);
      const onPermissionChange = mock(() => undefined);
      const source = new DeviceSource(context, "mic", {
        onActive,
        onError,
        onPermissionChange,
      });
      const oldTrack = { stop: mock(() => undefined) };
      const currentTrack = {
        getSettings: () => ({ channelCount: 2, deviceId: "new-mic" }),
        stop: mock(() => undefined),
      };

      const oldStart = source.start("old-mic");
      const currentStart = source.start("new-mic");
      current.resolve({
        getAudioTracks: () => [currentTrack],
        getTracks: () => [currentTrack],
      } as unknown as MediaStream);
      await currentStart;
      if (settle === "resolve") {
        previous.resolve({
          getAudioTracks: () => [oldTrack],
          getTracks: () => [oldTrack],
        } as unknown as MediaStream);
      } else {
        previous.reject(new DOMException("denied", "NotAllowedError"));
      }
      await oldStart;

      expect(source.isActive).toBe(true);
      expect(source.currentDeviceId).toBe("new-mic");
      expect(source.permissionState).toBe("granted");
      expect(currentTrack.stop).not.toHaveBeenCalled();
      expect(oldTrack.stop).toHaveBeenCalledTimes(settle === "resolve" ? 1 : 0);
      expect(context.createMediaStreamSource).toHaveBeenCalledTimes(1);
      expect(onActive).toHaveBeenCalledTimes(1);
      expect(onError).not.toHaveBeenCalled();
      expect(onPermissionChange).toHaveBeenCalledTimes(1);
      source.cleanup();
    }
  );

  test("requests capture once without browser voice processing", async () => {
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
    const track = {
      getCapabilities: () => ({ latency: { max: 0.1, min: 0.005 } }),
      getSettings: () => settings,
      label: "Pixel microphone",
      get muted() {
        return muted;
      },
      get readyState() {
        return readyState;
      },
      stop: mock(() => undefined),
    };
    const getUserMedia = mock(() =>
      Promise.resolve({
        getAudioTracks: () => [track],
        getTracks: () => [track],
      })
    );
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
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(source.channelCount).toBe(1);
    expect(createChannelMerger).not.toHaveBeenCalled();
    expect(source.getDiagnostics()).toEqual({
      actual: settings,
      capabilities: { latency: { max: 0.1, min: 0.005 } },
      label: "Pixel microphone",
      latencyConstraintSupported: true,
      muted: false,
      readyState: "live",
      requested: {
        autoGainControl: false,
        channelCount: { ideal: 2 },
        deviceId: { exact: "pixel-mic" },
        echoCancellation: false,
        latency: { ideal: 0 },
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

  test("a capture whose track ends, unplugged or revoked, stops", async () => {
    const listeners = new Set<() => void>();
    const track = {
      addEventListener: (_type: string, listener: () => void) => {
        listeners.add(listener);
      },
      getSettings: () => ({ channelCount: 2, deviceId: "usb-mic" }),
      removeEventListener: (_type: string, listener: () => void) => {
        listeners.delete(listener);
      },
      stop: mock(() => undefined),
    };
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        mediaDevices: {
          addEventListener: () => undefined,
          getUserMedia: () =>
            Promise.resolve({
              getAudioTracks: () => [track],
              getTracks: () => [track],
            }),
          removeEventListener: () => undefined,
        },
      },
    });
    const node = {
      connect: () => undefined,
      disconnect: () => undefined,
      gain: { value: 1 },
    };
    const context = {
      createGain: () => node,
      createMediaStreamSource: () => node,
    } as unknown as AudioContext;
    const onInactive = mock(() => undefined);
    const source = new DeviceSource(context, "mic", { onInactive });

    await source.start("usb-mic");
    expect(source.isActive).toBe(true);

    for (const listener of [...listeners]) {
      listener();
    }

    expect(source.isActive).toBe(false);
    expect(source.output).toBeNull();
    expect(onInactive).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });
});
