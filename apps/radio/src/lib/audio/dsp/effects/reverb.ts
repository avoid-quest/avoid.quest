/**
 * Dattorro Plate Reverb Effect
 *
 * Based on Jon Dattorro's 1997 AES paper
 * "Effect Design Part 1: Reverberator and Other Filters"
 */

/**
 * Delay line structure: [buffer, writeIndex, readIndex, mask]
 */
type DelayLine = [Float32Array, number, number, number];

export class DattorroReverb {
  private readonly delays: DelayLine[] = [];
  private readonly preDelayLength: number;
  private readonly preDelay: Float32Array;
  private preDelayWrite = 0;
  private lp1 = 0.0;
  private lp2 = 0.0;
  private lp3 = 0.0;
  private excPhase = 0.0;
  private readonly taps: Int16Array;
  private readonly sampleRate: number;

  // Parameters
  private preDelaySamples = 0;
  private bandwidth = 0.9999;
  private inputDiffusion1 = 0.75;
  private inputDiffusion2 = 0.625;
  private decay = 0.5;
  private decayDiffusion1 = 0.7;
  private decayDiffusion2 = 0.5;
  private damping = 0.005;
  private excursionRate = 0.5;
  private excursionDepth = 0.7;
  private wet = 0.3;
  private dry = 0.6;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;

    // Pre-delay is always one-second long, rounded to the nearest 128-chunk
    this.preDelayLength = sampleRate + (128 - (sampleRate % 128));
    this.preDelay = new Float32Array(this.preDelayLength);

    // Initialize delay lines with specified lengths (in seconds)
    const delayLengths = [
      0.004_771_345, 0.003_595_309, 0.012_734_787, 0.009_307_483, 0.022_579_886,
      0.149_625_349, 0.060_481_839, 0.124_995_8, 0.030_509_727, 0.141_695_508,
      0.089_244_313, 0.106_280_031,
    ];
    for (const length of delayLengths) {
      this.makeDelay(length);
    }

    // Initialize tap positions (in seconds) for stereo output
    this.taps = Int16Array.from(
      [
        0.008_937_872, 0.099_929_438, 0.064_278_754, 0.067_067_639,
        0.066_866_033, 0.006_283_391, 0.035_818_689, 0.011_861_161,
        0.121_870_905, 0.041_262_054, 0.089_815_53, 0.070_931_756,
        0.011_256_342, 0.004_065_724,
      ],
      (length) => Math.round(length * sampleRate)
    );
  }

  private makeDelay(length: number): void {
    const len = Math.round(length * this.sampleRate);
    const nextPow2 = 2 ** Math.ceil(Math.log2(len));
    this.delays.push([new Float32Array(nextPow2), len - 1, 0, nextPow2 - 1]);
  }

  private writeDelay(index: number, data: number): number {
    const delay = this.delays[index];
    if (!delay) {
      // Return safe default instead of throwing to prevent worklet crash
      return 0;
    }
    delay[0][delay[1]] = data;
    return data;
  }

  private readDelay(index: number): number {
    const delay = this.delays[index];
    if (!delay || delay[2] === undefined) {
      // Return safe default instead of throwing to prevent worklet crash
      return 0;
    }
    return delay[0][delay[2]] ?? 0;
  }

  private readDelayAt(index: number, offset: number): number {
    const d = this.delays[index];
    if (!d || d[2] === undefined || d[3] === undefined) {
      // Return safe default instead of throwing to prevent worklet crash
      return 0;
    }
    const readIndex = (d[2] + offset) & d[3];
    return d[0][readIndex] ?? 0;
  }

  private readDelayCAt(index: number, offset: number): number {
    const d = this.delays[index];
    if (!d) {
      // Return safe default instead of throwing to prevent worklet crash
      return 0;
    }
    const frac = offset - ~~offset;
    let int = ~~offset + d[2] - 1;
    const mask = d[3];

    const x0 = d[0][int++ & mask] ?? 0;
    const x1 = d[0][int++ & mask] ?? 0;
    const x2 = d[0][int++ & mask] ?? 0;
    const x3 = d[0][int & mask] ?? 0;

    const a = (3 * (x1 - x2) - x0 + x3) / 2;
    const b = 2 * x2 + x0 - (5 * x1 + x3) / 2;
    const c = (x2 - x0) / 2;

    return ((a * frac + b) * frac + c) * frac + x1;
  }

  setPreDelay(value: number): void {
    this.preDelaySamples = Math.max(
      0,
      Math.min(this.preDelayLength - 1, Math.round(value * this.sampleRate))
    );
  }

  setBandwidth(value: number): void {
    this.bandwidth = Math.max(0, Math.min(1, value));
  }

  setInputDiffusion1(value: number): void {
    this.inputDiffusion1 = Math.max(0, Math.min(1, value));
  }

  setInputDiffusion2(value: number): void {
    this.inputDiffusion2 = Math.max(0, Math.min(1, value));
  }

  setDecay(value: number): void {
    this.decay = Math.max(0, Math.min(1, value));
  }

  setDecayDiffusion1(value: number): void {
    this.decayDiffusion1 = Math.max(0, Math.min(0.999_999, value));
  }

  setDecayDiffusion2(value: number): void {
    this.decayDiffusion2 = Math.max(0, Math.min(0.999_999, value));
  }

  setDamping(value: number): void {
    this.damping = Math.max(0, Math.min(1, value));
  }

  setExcursionRate(value: number): void {
    this.excursionRate = Math.max(0, Math.min(2, value));
  }

  setExcursionDepth(value: number): void {
    this.excursionDepth = Math.max(0, Math.min(2, value));
  }

  setWet(value: number): void {
    this.wet = Math.max(0, Math.min(1, value));
  }

  setDry(value: number): void {
    this.dry = Math.max(0, Math.min(1, value));
  }

  reset(): void {
    this.preDelay.fill(0);
    this.preDelayWrite = 0;
    this.lp1 = 0.0;
    this.lp2 = 0.0;
    this.lp3 = 0.0;
    this.excPhase = 0.0;
    for (const delay of this.delays) {
      delay[0].fill(0);
      delay[1] = delay[0].length - 1;
      delay[2] = 0;
    }
  }

  process(
    input: [Float32Array, Float32Array],
    output: [Float32Array, Float32Array],
    fromIndex: number,
    toIndex: number
  ): void {
    const [inputL, inputR] = input;
    const [outputL, outputR] = output;
    const pd = this.preDelaySamples;
    const bw = this.bandwidth;
    const fi = this.inputDiffusion1;
    const si = this.inputDiffusion2;
    const dc = this.decay;
    const ft = this.decayDiffusion1;
    const st = this.decayDiffusion2;
    const dp = 1 - this.damping;
    const ex = this.excursionRate / this.sampleRate;
    const ed = (this.excursionDepth * this.sampleRate) / 1000;
    const we = this.wet * 0.6;
    const dr = this.dry;

    // Write to predelay and dry output
    for (let i = fromIndex; i < toIndex; i++) {
      const monoInput = ((inputL[i] ?? 0) + (inputR[i] ?? 0)) * 0.5;
      const preDelayIndex =
        (this.preDelayLength + this.preDelayWrite - pd + (i - fromIndex)) %
        this.preDelayLength;
      this.preDelay[preDelayIndex] = monoInput;

      // Dry output
      outputL[i] = (inputL[i] ?? 0) * dr;
      outputR[i] = (inputR[i] ?? 0) * dr;
    }

    // Process reverb
    for (let i = fromIndex; i < toIndex; i++) {
      let lo = 0.0;
      let ro = 0.0;

      const sampleOffset = i - fromIndex;

      // Input low-pass filter (bandwidth)
      const preDelayIndex =
        (this.preDelayLength + this.preDelayWrite - pd + sampleOffset) %
        this.preDelayLength;
      const preDelayValue = this.preDelay[preDelayIndex] ?? 0;
      this.lp1 += bw * (preDelayValue - this.lp1);

      // Pre-tank diffusion (4 all-pass filters)
      let pre = this.writeDelay(0, this.lp1 - fi * this.readDelay(0));
      pre = this.writeDelay(
        1,
        fi * (pre - this.readDelay(1)) + this.readDelay(0)
      );
      pre = this.writeDelay(
        2,
        fi * pre + this.readDelay(1) - si * this.readDelay(2)
      );
      pre = this.writeDelay(
        3,
        si * (pre - this.readDelay(3)) + this.readDelay(2)
      );

      const split = si * pre + this.readDelay(3);

      // Modulated excursions for chorus effect
      const exc = ed * (1 + Math.cos(this.excPhase * 6.28));
      const exc2 = ed * (1 + Math.sin(this.excPhase * 6.2847));

      // Left loop
      let temp = this.writeDelay(
        4,
        split + dc * this.readDelay(11) + ft * this.readDelayCAt(4, exc)
      );
      this.writeDelay(5, this.readDelayCAt(4, exc) - ft * temp);
      this.lp2 += dp * (this.readDelay(5) - this.lp2);
      temp = this.writeDelay(6, dc * this.lp2 - st * this.readDelay(6));
      this.writeDelay(7, this.readDelay(6) + st * temp);

      // Right loop
      temp = this.writeDelay(
        8,
        split + dc * this.readDelay(7) + ft * this.readDelayCAt(8, exc2)
      );
      this.writeDelay(9, this.readDelayCAt(8, exc2) - ft * temp);
      this.lp3 += dp * (this.readDelay(9) - this.lp3);
      temp = this.writeDelay(10, dc * this.lp3 - st * this.readDelay(10));
      this.writeDelay(11, this.readDelay(10) + st * temp);

      // Left output: sum of taps
      lo =
        this.readDelayAt(9, this.taps[0] ?? 0) +
        this.readDelayAt(9, this.taps[1] ?? 0) -
        this.readDelayAt(10, this.taps[2] ?? 0) +
        this.readDelayAt(11, this.taps[3] ?? 0) -
        this.readDelayAt(5, this.taps[4] ?? 0) -
        this.readDelayAt(6, this.taps[5] ?? 0) -
        this.readDelayAt(7, this.taps[6] ?? 0);

      // Right output: sum of taps
      ro =
        this.readDelayAt(5, this.taps[7] ?? 0) +
        this.readDelayAt(5, this.taps[8] ?? 0) -
        this.readDelayAt(6, this.taps[9] ?? 0) +
        this.readDelayAt(7, this.taps[10] ?? 0) -
        this.readDelayAt(9, this.taps[11] ?? 0) -
        this.readDelayAt(10, this.taps[12] ?? 0) -
        this.readDelayAt(11, this.taps[13] ?? 0);

      // Mix wet signal
      outputL[i] = (outputL[i] ?? 0) + lo * we;
      outputR[i] = (outputR[i] ?? 0) + ro * we;

      this.excPhase += ex;

      // Advance all delay line indices
      for (const d of this.delays) {
        if (
          d &&
          d[1] !== undefined &&
          d[2] !== undefined &&
          d[3] !== undefined
        ) {
          d[1] = (d[1] + 1) & d[3];
          d[2] = (d[2] + 1) & d[3];
        }
      }
    }

    // Update preDelay index
    this.preDelayWrite =
      (this.preDelayWrite + (toIndex - fromIndex)) % this.preDelayLength;
  }
}
