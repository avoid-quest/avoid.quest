function stereoBalanceGains(volume: number, pan: number): [number, number] {
  return [(1 - Math.max(0, pan)) * volume, (1 + Math.min(0, pan)) * volume];
}

/**
 * Channel strip for volume and panning with smoothing
 */
export class ChannelStrip {
  volume = 1.0;
  pan = 0.0;
  private targetLeftGain = 1.0;
  private targetRightGain = 1.0;
  private currentLeftGain = 1.0;
  private currentRightGain = 1.0;

  private static readonly GAIN_SMOOTH_COEFF = 0.1;

  constructor() {
    this.updateGains();
  }

  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    this.updateGains();
  }

  setPan(value: number): void {
    this.pan = Math.max(-1, Math.min(1, value));
    this.updateGains();
  }

  private updateGains(): void {
    [this.targetLeftGain, this.targetRightGain] = stereoBalanceGains(
      this.volume,
      this.pan
    );
  }

  private smoothGain(current: number, target: number): number {
    return current + (target - current) * ChannelStrip.GAIN_SMOOTH_COEFF;
  }

  apply(
    inputL: Float32Array,
    inputR: Float32Array,
    outputL: Float32Array,
    outputR: Float32Array,
    fromIndex: number,
    toIndex: number
  ): void {
    for (let i = fromIndex; i < toIndex; i++) {
      this.currentLeftGain = this.smoothGain(
        this.currentLeftGain,
        this.targetLeftGain
      );
      this.currentRightGain = this.smoothGain(
        this.currentRightGain,
        this.targetRightGain
      );

      outputL[i] = (inputL[i] ?? 0) * this.currentLeftGain;
      outputR[i] = (inputR[i] ?? 0) * this.currentRightGain;
    }
  }
}
