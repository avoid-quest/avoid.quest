export type EffectsBackend = "bypass" | "compatibility" | "muted" | "official";

const BACKEND_SWITCH_SECONDS = 0.03;

function setGainTarget(gain: GainNode, value: number, endTime: number): void {
  const parameter = gain.gain;
  const now = gain.context.currentTime;
  const cancelAndHoldAtTime = parameter.cancelAndHoldAtTime?.bind(parameter);
  if (cancelAndHoldAtTime) {
    cancelAndHoldAtTime(now);
  } else {
    const heldValue = parameter.value;
    parameter.cancelScheduledValues(now);
    parameter.setValueAtTime(heldValue, now);
  }
  parameter.linearRampToValueAtTime(value, endTime);
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
  readonly bypassGain: GainNode;
  readonly compatibilityGain: GainNode;
  readonly officialGain: GainNode;
  readonly source: AudioNode;
  private releaseSignal: ConstantSourceNode | null = null;

  constructor(source: AudioNode, destination: AudioNode, muted: boolean) {
    const context = source.context;
    this.source = source;
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
    const endTime = this.source.context.currentTime + BACKEND_SWITCH_SECONDS;
    setGainTarget(this.bypassGain, backend === "bypass" ? 1 : 0, endTime);
    setGainTarget(
      this.compatibilityGain,
      backend === "compatibility" ? 1 : 0,
      endTime
    );
    setGainTarget(this.officialGain, backend === "official" ? 1 : 0, endTime);

    this.cancelReleaseSignal();
    const releaseSignal = this.source.context.createConstantSource();
    releaseSignal.onended = () => {
      if (this.releaseSignal !== releaseSignal) {
        return;
      }
      this.releaseSignal = null;
      releaseSignal.disconnect();
      onSettled();
    };
    this.releaseSignal = releaseSignal;
    releaseSignal.start();
    releaseSignal.stop(endTime);
  }

  disconnect(): void {
    this.cancelReleaseSignal();
    disconnectNode(this.source, this.bypassGain);
    disconnectNode(this.bypassGain);
    disconnectNode(this.compatibilityGain);
    disconnectNode(this.officialGain);
  }

  private cancelReleaseSignal(): void {
    const releaseSignal = this.releaseSignal;
    if (!releaseSignal) {
      return;
    }
    this.releaseSignal = null;
    releaseSignal.onended = null;
    try {
      releaseSignal.stop();
    } catch {
      // The signal may already have ended between the ownership check and stop.
    }
    releaseSignal.disconnect();
  }
}
