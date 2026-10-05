import { mock } from "bun:test";
import { getAudioContextManager } from "../playback/audio-context";
import { FakeAudioContext, FakeAudioParam } from "../routing/fake-audio-nodes";
import type { MainOutputConnect } from "./audio-manager-types";

// Isolate the real manager from mock.module replacements in other suites.
const { AudioManager } = (await import(
  `./audio-manager.ts?${"unmocked"}`
)) as typeof import("./audio-manager");

export function capturedStream(deviceId = "usb-mic") {
  const tracks = [0, 1].map(() => {
    let readyState: MediaStreamTrackState = "live";
    return {
      getSettings: () => ({ channelCount: 2, deviceId }),
      label: deviceId,
      muted: false,
      get readyState() {
        return readyState;
      },
      stop: mock(() => {
        readyState = "ended";
      }),
    };
  });
  const stream = {
    getAudioTracks: () => tracks.slice(0, 1),
    getTracks: () => tracks,
  } as unknown as MediaStream;
  return { stream, tracks };
}

/** Real manager/source/graph with deferred browser capture and fake Web Audio. */
export function createDeviceCaptureHarness() {
  const originalNavigator = globalThis.navigator;
  type CaptureRequest = ReturnType<typeof Promise.withResolvers<MediaStream>>;
  const requests: CaptureRequest[] = [];
  const waiting = new Map<
    number,
    ReturnType<typeof Promise.withResolvers<CaptureRequest>>
  >();
  class Context extends FakeAudioContext {
    readonly state = "running";
    readonly createMediaStreamSource = mock(() => this.createGain());

    close(): Promise<void> {
      return Promise.resolve();
    }

    createStereoPanner(): StereoPannerNode {
      return Object.assign(this.createGain(), {
        pan: new FakeAudioParam(0),
      }) as unknown as StereoPannerNode;
    }

    createBiquadFilter(): BiquadFilterNode {
      return Object.assign(this.createGain(), {
        frequency: new FakeAudioParam(0),
        Q: new FakeAudioParam(0),
      }) as unknown as BiquadFilterNode;
    }
  }
  const context = new Context();
  const contextManager = getAudioContextManager() as unknown as {
    context: AudioContext | null;
  };
  const originalContext = contextManager.context;
  contextManager.context = context as unknown as AudioContext;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        addEventListener: () => undefined,
        getUserMedia: () => {
          const request = Promise.withResolvers<MediaStream>();
          waiting.get(requests.length)?.resolve(request);
          requests.push(request);
          return request.promise;
        },
        removeEventListener: () => undefined,
      },
      userAgent: "test",
    },
  });
  AudioManager.resetInstance();
  const manager = AudioManager.getInstance();
  const internals = manager as unknown as {
    audioSystemInitialized: boolean;
    effects: { connectGraph: () => Promise<boolean> };
    output: { cleanup: () => void; connectMain: MainOutputConnect };
  };
  // Meter/worklet setup is independent of browser capture ownership.
  internals.audioSystemInitialized = true;
  internals.effects.connectGraph = async () => true;
  manager.meters.setSoundSource = async () => undefined;
  const connectMain = mock<MainOutputConnect>(() => () => undefined);
  internals.output = { cleanup: () => undefined, connectMain };

  return {
    connectMain,
    context,
    manager,
    request(index = 0): Promise<CaptureRequest> {
      const request = requests[index];
      if (request) {
        return Promise.resolve(request);
      }
      const notification = Promise.withResolvers<CaptureRequest>();
      waiting.set(index, notification);
      return notification.promise;
    },
    requests,
    restore() {
      AudioManager.resetInstance();
      contextManager.context = originalContext;
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: originalNavigator,
      });
    },
  };
}
