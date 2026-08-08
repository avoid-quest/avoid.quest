export type EffectsBackend = "bypass" | "compatibility" | "muted" | "official";

const BACKEND_SWITCH_SECONDS = 0.03;
const BACKEND_RELEASE_DELAY_MS = 40;

function setGainTarget(gain: GainNode, value: number, endTime: number): void {
  const parameter = gain.gain;
  const now = gain.context.currentTime;
  try {
    parameter.cancelScheduledValues(now);
    parameter.setValueAtTime(parameter.value, now);
    parameter.linearRampToValueAtTime(value, endTime);
  } catch {
    parameter.value = value;
  }
}

function disconnectNode(source: AudioNode, destination?: AudioNode): void {
  try {
    if (destination) {
      source.disconnect(destination);
    } else {
      source.disconnect();
    }
  } catch {
    // The edge may already have been removed by an idempotent teardown.
  }
}

/** Stable gain-ramped shell shared by dry, official, and compatibility paths. */
export class EffectsBackendRouter {
  backend: EffectsBackend;
  readonly bypassGain: GainNode;
  readonly compatibilityGain: GainNode;
  readonly destination: AudioNode;
  readonly officialGain: GainNode;
  readonly source: AudioNode;
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(source: AudioNode, destination: AudioNode, muted: boolean) {
    const context = source.context as AudioContext;
    this.source = source;
    this.destination = destination;
    this.backend = muted ? "muted" : "bypass";
    this.bypassGain = context.createGain();
    this.compatibilityGain = context.createGain();
    this.officialGain = context.createGain();
    this.bypassGain.gain.value = muted ? 0 : 1;
    this.compatibilityGain.gain.value = 0;
    this.officialGain.gain.value = 0;

    source.connect(this.bypassGain);
    this.bypassGain.connect(destination);
    this.compatibilityGain.connect(destination);
    this.officialGain.connect(destination);
  }

  connectCompatibility(input: AudioNode, output: AudioNode): void {
    disconnectNode(this.source, input);
    disconnectNode(output, this.compatibilityGain);
    this.source.connect(input);
    output.connect(this.compatibilityGain);
  }

  disconnectCompatibility(input: AudioNode, output: AudioNode): void {
    disconnectNode(this.source, input);
    disconnectNode(output, this.compatibilityGain);
  }

  switchTo(backend: EffectsBackend, onSettled: () => void): void {
    this.backend = backend;
    const endTime = this.source.context.currentTime + BACKEND_SWITCH_SECONDS;
    setGainTarget(this.bypassGain, backend === "bypass" ? 1 : 0, endTime);
    setGainTarget(
      this.compatibilityGain,
      backend === "compatibility" ? 1 : 0,
      endTime
    );
    setGainTarget(this.officialGain, backend === "official" ? 1 : 0, endTime);

    if (this.releaseTimer !== null) {
      clearTimeout(this.releaseTimer);
    }
    const releaseTimer = globalThis.setTimeout(() => {
      if (this.releaseTimer !== releaseTimer) {
        return;
      }
      this.releaseTimer = null;
      onSettled();
    }, BACKEND_RELEASE_DELAY_MS);
    this.releaseTimer = releaseTimer;
  }

  disconnect(): void {
    if (this.releaseTimer !== null) {
      clearTimeout(this.releaseTimer);
      this.releaseTimer = null;
    }
    disconnectNode(this.source, this.bypassGain);
    disconnectNode(this.bypassGain);
    disconnectNode(this.compatibilityGain);
    disconnectNode(this.officialGain);
  }
}
