import type { Unsubscribe } from "../playback/index.js";
import { ensureOpenDawAudioWorklets } from "./opendaw-audio-worklets.js";

type MeterLevel = { left: number; right: number };
type MeterListener = (level: MeterLevel) => void;
type MeterSubscription = { terminate(): void };
type OpenDawMeterNode = AudioWorkletNode & {
  subscribe(
    observer: (values: { peak: Float32Array }) => void
  ): MeterSubscription;
  terminate(): void;
};
type MeterNodeFactory = (
  context: BaseAudioContext
) => Promise<OpenDawMeterNode>;
type FallbackMeter = {
  input: AudioNode;
  terminate(): void;
};
type FallbackMeterFactory = (
  context: BaseAudioContext,
  observer: (level: MeterLevel) => void
) => FallbackMeter;
type MeterSlot = {
  fallback: FallbackMeter | null;
  generation: number;
  initialization: Promise<void> | null;
  listeners: Set<MeterListener>;
  node: OpenDawMeterNode | null;
  source: AudioNode | null;
  subscription: MeterSubscription | null;
};

const createMeterSlot = (): MeterSlot => ({
  fallback: null,
  generation: 0,
  initialization: null,
  listeners: new Set(),
  node: null,
  source: null,
  subscription: null,
});

const createOpenDawMeterNode: MeterNodeFactory = async (context) => {
  const { AudioWorklets } = await import("@opendaw/studio-core");
  const worklets = await ensureOpenDawAudioWorklets(context, AudioWorklets);
  return worklets.createMeter(2);
};

const peak = (samples: Float32Array): number => {
  let value = 0;
  for (const sample of samples) {
    value = Math.max(value, Math.abs(sample));
  }
  return value;
};

const createNativeFallbackMeter: FallbackMeterFactory = (context, observer) => {
  const splitter = context.createChannelSplitter(2);
  const left = context.createAnalyser();
  const right = context.createAnalyser();
  left.fftSize = 256;
  right.fftSize = 256;
  splitter.connect(left, 0);
  splitter.connect(right, 1);
  const leftSamples = new Float32Array(left.fftSize);
  const rightSamples = new Float32Array(right.fftSize);
  const interval = globalThis.setInterval(() => {
    left.getFloatTimeDomainData(leftSamples);
    right.getFloatTimeDomainData(rightSamples);
    observer({ left: peak(leftSamples), right: peak(rightSamples) });
  }, 50);
  return {
    input: splitter,
    terminate: () => {
      globalThis.clearInterval(interval);
      splitter.disconnect();
      left.disconnect();
      right.disconnect();
    },
  };
};

class MeterService {
  private readonly master = createMeterSlot();
  private readonly sounds = new Map<string, MeterSlot>();
  private readonly createMeterNode: MeterNodeFactory;
  private readonly createFallbackMeter: FallbackMeterFactory;

  constructor(
    createMeterNode: MeterNodeFactory = createOpenDawMeterNode,
    createFallbackMeter: FallbackMeterFactory = createNativeFallbackMeter
  ) {
    this.createMeterNode = createMeterNode;
    this.createFallbackMeter = createFallbackMeter;
  }

  setMasterSource(source: AudioNode | null): Promise<void> {
    return this.setSource(this.master, source, "master");
  }

  subscribeMasterMeter(callback: MeterListener): Unsubscribe {
    return this.subscribe(this.master, callback, "master");
  }

  subscribeMeter(soundId: string, callback: MeterListener): Unsubscribe {
    const slot = this.sounds.get(soundId) ?? createMeterSlot();
    this.sounds.set(soundId, slot);
    return this.subscribe(slot, callback, soundId);
  }

  setSoundSource(soundId: string, source: AudioNode): Promise<void> {
    const slot = this.sounds.get(soundId) ?? createMeterSlot();
    this.sounds.set(soundId, slot);
    return this.setSource(slot, source, soundId);
  }

  clearSoundSource(soundId: string): void {
    const slot = this.sounds.get(soundId);
    if (!slot) {
      return;
    }

    this.deactivate(slot);
    slot.source = null;
    this.notify(slot, { left: 0, right: 0 });
  }

  clear(): void {
    this.deactivate(this.master);
    this.master.source = null;
    this.master.listeners.clear();
    for (const slot of this.sounds.values()) {
      this.deactivate(slot);
      slot.listeners.clear();
    }
    this.sounds.clear();
  }

  private activate(slot: MeterSlot, label: string): Promise<void> {
    if (
      !(slot.source && slot.listeners.size > 0) ||
      slot.node ||
      slot.initialization
    ) {
      return slot.initialization ?? Promise.resolve();
    }

    const generation = slot.generation;
    const source = slot.source;
    const initialization = this.createMeterNode(source.context)
      .then((node) => {
        if (
          slot.generation !== generation ||
          slot.source !== source ||
          slot.listeners.size === 0
        ) {
          node.terminate();
          return;
        }

        slot.node = node;
        slot.subscription = node.subscribe(({ peak }) => {
          this.notify(slot, {
            left: peak[0] ?? 0,
            right: peak[1] ?? peak[0] ?? 0,
          });
        });
        source.connect(node);
      })
      .catch((error) => {
        console.warn(
          `[MeterService] openDAW meter unavailable for ${label}`,
          error
        );
        if (
          slot.generation === generation &&
          slot.source === source &&
          slot.listeners.size > 0
        ) {
          slot.fallback = this.createFallbackMeter(source.context, (level) =>
            this.notify(slot, level)
          );
          source.connect(slot.fallback.input);
        }
      })
      .finally(() => {
        if (slot.initialization === initialization) {
          slot.initialization = null;
        }
      });
    slot.initialization = initialization;
    return initialization;
  }

  private deactivate(slot: MeterSlot): void {
    slot.generation++;
    slot.subscription?.terminate();
    slot.subscription = null;
    if (slot.fallback) {
      try {
        slot.source?.disconnect(slot.fallback.input);
      } catch {
        // The graph may already have been disconnected during a source swap.
      }
      slot.fallback.terminate();
      slot.fallback = null;
    }
    if (slot.node) {
      try {
        slot.source?.disconnect(slot.node);
      } catch {
        // The graph may already have been disconnected during a source swap.
      }
      slot.node.disconnect();
      slot.node.terminate();
      slot.node = null;
    }
  }

  private notify(slot: MeterSlot, level: MeterLevel): void {
    for (const listener of slot.listeners) {
      listener(level);
    }
  }

  private setSource(
    slot: MeterSlot,
    source: AudioNode | null,
    label: string
  ): Promise<void> {
    this.deactivate(slot);
    slot.source = source;
    return this.activate(slot, label);
  }

  private subscribe(
    slot: MeterSlot,
    callback: MeterListener,
    label: string
  ): Unsubscribe {
    slot.listeners.add(callback);
    this.activate(slot, label);

    return () => {
      slot.listeners.delete(callback);
      if (slot.listeners.size === 0) {
        this.deactivate(slot);
      }
    };
  }
}

export type {
  FallbackMeter,
  FallbackMeterFactory,
  MeterLevel,
  MeterListener,
  MeterNodeFactory,
  OpenDawMeterNode,
};
export { MeterService };
