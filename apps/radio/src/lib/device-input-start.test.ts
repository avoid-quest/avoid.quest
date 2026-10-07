import { afterEach, describe, expect, mock, test } from "bun:test";
import type { SoundInstance } from "./audio/manager/audio-manager-types";
import type { SoundRegistry } from "./audio/manager/sound-registry";
import { AudioContextManager } from "./audio/playback/audio-context";
import {
  FakeAudioContext,
  FakeAudioParam,
  FakeGainNode,
} from "./audio/routing/fake-audio-nodes";
import { createNodeLaneOutputs } from "./audio/routing/node-lane-outputs";
import { startDeviceInput } from "./device-input-playback";

// Other test files mock this module globally. Keep this composed regression real.
const { AudioManager } = (await import(
  `./audio/manager/audio-manager.ts?${"device-input-start"}`
)) as typeof import("./audio/manager/audio-manager");

class CaptureContext extends FakeAudioContext {
  readonly channelRoutes: { destination: unknown; channel: number }[] = [];
  readonly state = "running";

  close() {
    return Promise.resolve();
  }

  createMediaStreamSource(): MediaStreamAudioSourceNode {
    return new FakeGainNode(this) as unknown as MediaStreamAudioSourceNode;
  }

  createChannelSplitter(): ChannelSplitterNode {
    const node = new FakeGainNode(this);
    node.connect = (destination, channel = 0) => {
      this.channelRoutes.push({ channel, destination });
      node.connections.add(destination);
      return destination;
    };
    return node as unknown as ChannelSplitterNode;
  }

  createStereoPanner(): StereoPannerNode {
    const node = new FakeGainNode(this);
    return Object.assign(node, {
      pan: new FakeAudioParam(0),
    }) as unknown as StereoPannerNode;
  }

  createBiquadFilter(): BiquadFilterNode {
    const node = new FakeGainNode(this);
    return Object.assign(node, {
      frequency: new FakeAudioParam(0),
      Q: new FakeAudioParam(1),
      type: "highpass",
    }) as unknown as BiquadFilterNode;
  }
}

const originalNavigator = globalThis.navigator;

afterEach(() => {
  AudioManager.resetInstance();
  AudioContextManager.resetForTesting();
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: originalNavigator,
  });
});

describe("device input first connection", () => {
  test.each([0, 0.2])(
    "connects with fader %s and the selected mono channel before a delayed meter settles",
    async (volume) => {
      const track = {
        getSettings: () => ({ channelCount: 2, deviceId: "interface" }),
        label: "Interface",
        muted: false,
        readyState: "live",
        stop: mock(() => undefined),
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
      const context = new CaptureContext();
      (
        AudioContextManager.getInstance() as unknown as {
          context: AudioContext;
        }
      ).context = context as unknown as AudioContext;
      const audio = AudioManager.getInstance();
      const internals = audio as unknown as {
        audioSystemInitialized: boolean;
        effects: {
          connectGraph: (
            id: string,
            source: AudioNode,
            destination: AudioNode,
            channels: 1 | 2
          ) => Promise<boolean>;
        };
        output: {
          cleanup: () => void;
          connectMain: (source: AudioNode) => () => void;
        };
        soundRegistry: SoundRegistry;
      };
      internals.audioSystemInitialized = true;
      const firstConnections: unknown[] = [];
      const connectMain = mock((_source: AudioNode) => {
        firstConnections.push({
          channels: audio.getDeviceSource(soundId)?.currentChannelSelection,
          volume: internals.soundRegistry.get(soundId)?.nodes?.gain.gain.value,
        });
        return () => undefined;
      });
      internals.output = { cleanup: () => undefined, connectMain };
      const connectEffects = mock(
        (
          _id: string,
          source: AudioNode,
          destination: AudioNode,
          _channels: 1 | 2
        ) => {
          source.connect(destination);
          return Promise.resolve(true);
        }
      );
      internals.effects.connectGraph = connectEffects;
      const meterEntered = Promise.withResolvers<void>();
      const meterReady = Promise.withResolvers<void>();
      audio.meters.setSoundSource = async () => {
        meterEntered.resolve();
        await meterReady.promise;
      };
      const soundId = audio.createSound(
        { id: "input", name: "Input", streamUrl: "device://interface" },
        "node:n:input"
      );
      audio.setVolume(soundId, volume);
      const outputs = createNodeLaneOutputs({
        getHost: () => audio,
        getSends: () =>
          new Map([
            [
              "a>speakers",
              { delay: 0, level: 1, reenters: false, to: "sink:speakers" },
            ],
          ]),
        // As the engine routes Speakers: onto the main bus.
        route: (_to, laneSend) => connectMain(laneSend),
      });
      outputs.attach("input", soundId);
      let settled = false;
      const start = startDeviceInput(
        {
          getDeviceChannelCount: (id) =>
            audio.getDeviceSource(id)?.channelCount ?? null,
          startDevice: (...args) => audio.playDeviceSound(...args),
        },
        soundId,
        { channelSelection: { left: 1, right: 1 }, deviceId: "interface" }
      ).then((count) => {
        settled = true;
        return count;
      });

      await meterEntered.promise;

      const instance = internals.soundRegistry.get(soundId) as SoundInstance;
      expect(settled).toBe(false);
      expect(firstConnections).toEqual([
        { channels: { left: 1, right: 1 }, volume },
      ]);
      expect(instance.deviceSource?.isActive).toBe(true);
      expect(instance.nodes?.gain.gain.value).toBe(volume);
      expect(instance.deviceSource?.currentChannelSelection).toEqual({
        left: 1,
        right: 1,
      });
      expect(context.channelRoutes).toEqual([
        { channel: 1, destination: instance.deviceSource?.output },
      ]);
      expect(connectEffects).toHaveBeenCalledWith(
        soundId,
        instance.nodes?.filter,
        instance.nodes?.pan,
        1
      );
      // The lane reaches Speakers at unity; another silent gain cannot mask a bad fader.
      expect(connectMain).toHaveBeenCalledTimes(1);
      const [send] = connectMain.mock.calls[0] ?? [];
      expect(
        (send as unknown as FakeGainNode).gain.events.at(-1)
      ).toMatchObject({ type: "target", value: 1 });

      meterReady.resolve();
      expect(await start).toBe(2);
      outputs.dispose();
    }
  );
});
