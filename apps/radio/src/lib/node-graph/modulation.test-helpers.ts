import { afterEach } from "bun:test";
import { AudioContextManager } from "../audio/playback/audio-context";
import {
  FakeAudioContext,
  FakeGainNode,
} from "../audio/routing/fake-audio-nodes";
import type { createModulationRuntime } from "./modulation-runtime";

class Context extends FakeAudioContext {
  readonly state = "running";
  readonly destination = new FakeGainNode(this);
  readonly audioWorklet = { addModule: async () => undefined };
  addEventListener() {
    /* This context stays running. */
  }
  removeEventListener() {
    /* No context state events are dispatched. */
  }
  close() {
    return Promise.resolve();
  }
}
export class TestModulationWorklet extends FakeGainNode {
  static current: TestModulationWorklet;
  readonly port = {
    close: () => undefined,
    onmessage: null as ((event: MessageEvent) => void) | null,
    postMessage: () => undefined,
  };
  constructor(context: Context) {
    super(context);
    TestModulationWorklet.current = this;
  }
  emit(values: Record<string, number>) {
    this.port.onmessage?.({ data: { type: "values", values } } as MessageEvent);
  }
}
const originalWorklet = globalThis.AudioWorkletNode;
const runtimes: ReturnType<typeof createModulationRuntime>[] = [];
export function installModulationAudio() {
  const context = new Context();
  (
    AudioContextManager.getInstance() as unknown as { context: AudioContext }
  ).context = context as unknown as AudioContext;
  globalThis.AudioWorkletNode =
    TestModulationWorklet as unknown as typeof AudioWorkletNode;
}
export function ownModulation(
  runtime: ReturnType<typeof createModulationRuntime>
) {
  runtimes.push(runtime);
}
afterEach(() => {
  for (const runtime of runtimes.splice(0)) {
    runtime.dispose();
  }
  AudioContextManager.resetForTesting();
  globalThis.AudioWorkletNode = originalWorklet;
});
