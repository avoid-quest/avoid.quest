/*
Dattorro Reverb AudioWorklet Implementation
Original JavaScript implementation by Khôi Nguyễn (khoin)
https://github.com/khoin/DattorroReverbNode

Based on Jon Dattorro's 1997 AES paper:
"Effect Design Part 1: Reverberator and Other Filters"

In jurisdictions that recognize copyright laws, this software is to
be released into the public domain.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
THE AUTHOR(S) SHALL NOT BE LIABLE FOR ANYTHING, ARISING FROM, OR IN
CONNECTION WITH THE SOFTWARE OR THE DISTRIBUTION OF THE SOFTWARE.
*/

/**
 * Delay line structure: [buffer, writeIndex, readIndex, mask]
 * - buffer: Float32Array for storing samples
 * - writeIndex: Current write position
 * - readIndex: Current read position
 * - mask: Bitmask for wrapping (power of 2 - 1)
 */
type DelayLine = [Float32Array, number, number, number];

/**
 * Dattorro Plate Reverb AudioWorkletProcessor
 *
 * Based on Jon Dattorro's 1997 AES paper "Effect Design Part 1: Reverberator and Other Filters"
 * Implements a high-quality plate reverb algorithm with modulated delay lines.
 *
 * @see https://ccrma.stanford.edu/~dattorro/EffectDesignPart1.pdf
 */
export class DattorroReverbProcessor extends AudioWorkletProcessor {
  private readonly _Delays: DelayLine[] = [];
  private readonly _pDLength: number;
  private readonly _preDelay: Float32Array;
  private _pDWrite = 0;
  private _lp1 = 0.0;
  private _lp2 = 0.0;
  private _lp3 = 0.0;
  private _excPhase = 0.0;
  private readonly _taps: Int16Array;
  private _debugLogged = false;

  static get parameterDescriptors(): AudioParamDescriptor[] {
    return [
      ["preDelay", 0, 0, sampleRate - 1, "k-rate"],
      ["bandwidth", 0.9999, 0, 1, "k-rate"],
      ["inputDiffusion1", 0.75, 0, 1, "k-rate"],
      ["inputDiffusion2", 0.625, 0, 1, "k-rate"],
      ["decay", 0.5, 0, 1, "k-rate"],
      ["decayDiffusion1", 0.7, 0, 0.999_999, "k-rate"],
      ["decayDiffusion2", 0.5, 0, 0.999_999, "k-rate"],
      ["damping", 0.005, 0, 1, "k-rate"],
      ["excursionRate", 0.5, 0, 2, "k-rate"],
      ["excursionDepth", 0.7, 0, 2, "k-rate"],
      ["wet", 0.3, 0, 1, "k-rate"],
      ["dry", 0.6, 0, 1, "k-rate"],
    ].map(([name, defaultValue, minValue, maxValue, automationRate]) => ({
      name: name as string,
      defaultValue: defaultValue as number,
      minValue: minValue as number,
      maxValue: maxValue as number,
      automationRate: automationRate as AutomationRate,
    }));
  }

  constructor(options: AudioWorkletNodeOptions) {
    super(options);

    // Pre-delay is always one-second long, rounded to the nearest 128-chunk
    this._pDLength = sampleRate + (128 - (sampleRate % 128));
    this._preDelay = new Float32Array(this._pDLength);

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
    this._taps = Int16Array.from(
      [
        0.008_937_872, 0.099_929_438, 0.064_278_754, 0.067_067_639,
        0.066_866_033, 0.006_283_391, 0.035_818_689, 0.011_861_161,
        0.121_870_905, 0.041_262_054, 0.089_815_53, 0.070_931_756,
        0.011_256_342, 0.004_065_724,
      ],
      (length) => Math.round(length * sampleRate)
    );
  }

  /**
   * Creates a delay line with the specified length
   * Uses power-of-2 sizing for efficient wrapping with bitwise AND
   */
  private makeDelay(length: number): void {
    const len = Math.round(length * sampleRate);
    const nextPow2 = 2 ** Math.ceil(Math.log2(len));
    this._Delays.push([
      new Float32Array(nextPow2),
      len - 1, // write index
      0, // read index
      nextPow2 - 1, // mask for wrapping
    ]);
  }

  /**
   * Writes a sample to a delay line and returns the written value
   */
  private writeDelay(index: number, data: number): number {
    const delay = this._Delays[index];
    if (!delay) {
      throw new Error(`Delay at index ${index} not found`);
    }
    delay[0][delay[1]] = data;
    return data;
  }

  /**
   * Reads the current sample from a delay line
   */
  private readDelay(index: number): number {
    const delay = this._Delays[index];
    if (!delay || delay[2] === undefined) {
      throw new Error(`Delay at index ${index} not found`);
    }
    const readIndex = delay[2];
    return delay[0][readIndex] ?? 0;
  }

  /**
   * Reads a sample at a specific offset from the current read position
   */
  private readDelayAt(index: number, offset: number): number {
    const d = this._Delays[index];
    if (!d || d[2] === undefined || d[3] === undefined) {
      throw new Error(`Delay at index ${index} not found`);
    }
    // biome-ignore lint/suspicious/noBitwiseOperators: Bitwise AND used for efficient modulo with power-of-2 mask
    const readIndex = (d[2] + offset) & d[3];
    return d[0][readIndex] ?? 0;
  }

  /**
   * Reads a sample with cubic interpolation at a fractional offset
   * Uses Olli Niemitalo's optimal cubic interpolation
   * @see https://www.musicdsp.org/en/latest/Other/49-cubic-interpollation.html
   */
  private readDelayCAt(index: number, offset: number): number {
    const d = this._Delays[index];
    if (!d) {
      throw new Error(`Delay at index ${index} not found`);
    }
    // biome-ignore lint/suspicious/noBitwiseOperators: Double bitwise NOT used for fast floor operation
    const frac = offset - ~~offset;
    // biome-ignore lint/suspicious/noBitwiseOperators: Double bitwise NOT used for fast floor operation
    let int = ~~offset + d[2] - 1;
    const mask = d[3];

    // biome-ignore lint/suspicious/noBitwiseOperators: Bitwise AND used for efficient modulo with power-of-2 mask
    // biome-ignore lint/nursery/noIncrementDecrement: Increment needed for array indexing in interpolation
    const x0 = d[0][int++ & mask] ?? 0;
    // biome-ignore lint/suspicious/noBitwiseOperators: Bitwise AND used for efficient modulo with power-of-2 mask
    // biome-ignore lint/nursery/noIncrementDecrement: Increment needed for array indexing in interpolation
    const x1 = d[0][int++ & mask] ?? 0;
    // biome-ignore lint/suspicious/noBitwiseOperators: Bitwise AND used for efficient modulo with power-of-2 mask
    // biome-ignore lint/nursery/noIncrementDecrement: Increment needed for array indexing in interpolation
    const x2 = d[0][int++ & mask] ?? 0;
    // biome-ignore lint/suspicious/noBitwiseOperators: Bitwise AND used for efficient modulo with power-of-2 mask
    const x3 = d[0][int & mask] ?? 0;

    const a = (3 * (x1 - x2) - x0 + x3) / 2;
    const b = 2 * x2 + x0 - (5 * x1 + x3) / 2;
    const c = (x2 - x0) / 2;

    return ((a * frac + b) * frac + c) * frac + x1;
  }

  /**
   * Process audio samples
   * First input will be downmixed to mono if number of channels is not 2
   * Outputs stereo
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Complex audio processing algorithm with multiple delay lines and modulation
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: AudioParamMap
  ): boolean {
    // Helper function to get parameter value
    // In AudioWorkletProcessor, k-rate parameters are provided as Float32Arrays
    // The current value is at index 0 of the array
    const getParamValue = (name: string, defaultValue: number): number => {
      try {
        // Access parameter as object property (parameters is a plain object)
        const param = (parameters as unknown as Record<string, Float32Array | AudioParam>)[name];
        
        if (!param) {
          return defaultValue;
        }
        
        // Check if it's a Float32Array (k-rate parameter in worklet)
        if (param instanceof Float32Array) {
          return param[0] ?? defaultValue;
        }
        
        // Fallback: if it's an AudioParam, use .value
        if (typeof (param as AudioParam).value === "number") {
          return (param as AudioParam).value;
        }
        
        return defaultValue;
      } catch (error) {
        console.error(`[Worklet] Error getting parameter "${name}":`, error);
        return defaultValue;
      }
    };

    // Get parameter values - k-rate parameters are Float32Arrays with value at index 0
    // biome-ignore lint/suspicious/noBitwiseOperators: Double bitwise NOT used for fast floor operation
    const pd = ~~getParamValue("preDelay", 0);
    const bw = getParamValue("bandwidth", 0.9999);
    const fi = getParamValue("inputDiffusion1", 0.75);
    const si = getParamValue("inputDiffusion2", 0.625);
    const dc = getParamValue("decay", 0.5);
    const ft = getParamValue("decayDiffusion1", 0.7);
    const st = getParamValue("decayDiffusion2", 0.5);
    const dp = 1 - getParamValue("damping", 0.005);
    const ex = getParamValue("excursionRate", 0.5) / sampleRate;
    const ed = (getParamValue("excursionDepth", 0.7) * sampleRate) / 1000;
    const we = getParamValue("wet", 0.3) * 0.6; // lo & ro both mult. by 0.6 anyways
    const dr = getParamValue("dry", 0.6);

    // Write to predelay and dry output
    if (inputs[0]?.length === 2) {
      const input0 = inputs[0][0];
      const input1 = inputs[0][1];
      if (input0 && input1) {
        for (let i = 127; i >= 0; i--) {
          this._preDelay[this._pDWrite + i] =
            ((input0[i] ?? 0) + (input1[i] ?? 0)) * 0.5;

          const output0 = outputs[0]?.[0];
          const output1 = outputs[0]?.[1];
          if (output0 && output1) {
            output0[i] = (input0[i] ?? 0) * dr;
            output1[i] = (input1[i] ?? 0) * dr;
          }
        }
      }
    } else if (inputs[0]?.length && inputs[0].length > 0) {
      const input0 = inputs[0][0];
      if (input0) {
        this._preDelay.set(input0, this._pDWrite);
        const output0 = outputs[0]?.[0];
        const output1 = outputs[0]?.[1];
        if (output0 && output1) {
          for (let i = 127; i >= 0; i--) {
            const value = (input0[i] ?? 0) * dr;
            output0[i] = value;
            output1[i] = value;
          }
        }
      }
    } else {
      this._preDelay.set(new Float32Array(128), this._pDWrite);
    }

    let i = 0;
    while (i < 128) {
      let lo = 0.0;
      let ro = 0.0;

      // Input low-pass filter (bandwidth)
      const preDelayIndex =
        (this._pDLength + this._pDWrite - pd + i) % this._pDLength;
      const preDelayValue = this._preDelay[preDelayIndex] ?? 0;
      this._lp1 += bw * (preDelayValue - this._lp1);

      // Pre-tank diffusion (4 all-pass filters)
      let pre = this.writeDelay(0, this._lp1 - fi * this.readDelay(0));
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
      const exc = ed * (1 + Math.cos(this._excPhase * 6.28));
      const exc2 = ed * (1 + Math.sin(this._excPhase * 6.2847));

      // Left loop (tank diffuse 1 -> long delay 1 -> damp 1 -> tank diffuse 2 -> long delay 2)
      let temp = this.writeDelay(
        4,
        split + dc * this.readDelay(11) + ft * this.readDelayCAt(4, exc)
      );
      this.writeDelay(5, this.readDelayCAt(4, exc) - ft * temp);
      this._lp2 += dp * (this.readDelay(5) - this._lp2);
      temp = this.writeDelay(6, dc * this._lp2 - st * this.readDelay(6));
      this.writeDelay(7, this.readDelay(6) + st * temp);

      // Right loop (tank diffuse 3 -> long delay 3 -> damp 2 -> tank diffuse 4 -> long delay 4)
      temp = this.writeDelay(
        8,
        split + dc * this.readDelay(7) + ft * this.readDelayCAt(8, exc2)
      );
      this.writeDelay(9, this.readDelayCAt(8, exc2) - ft * temp);
      this._lp3 += dp * (this.readDelay(9) - this._lp3);
      temp = this.writeDelay(10, dc * this._lp3 - st * this.readDelay(10));
      this.writeDelay(11, this.readDelay(10) + st * temp);

      // Left output: sum of taps from both loops
      lo =
        this.readDelayAt(9, this._taps[0] ?? 0) +
        this.readDelayAt(9, this._taps[1] ?? 0) -
        this.readDelayAt(10, this._taps[2] ?? 0) +
        this.readDelayAt(11, this._taps[3] ?? 0) -
        this.readDelayAt(5, this._taps[4] ?? 0) -
        this.readDelayAt(6, this._taps[5] ?? 0) -
        this.readDelayAt(7, this._taps[6] ?? 0);

      // Right output: sum of taps from both loops
      ro =
        this.readDelayAt(5, this._taps[7] ?? 0) +
        this.readDelayAt(5, this._taps[8] ?? 0) -
        this.readDelayAt(6, this._taps[9] ?? 0) +
        this.readDelayAt(7, this._taps[10] ?? 0) -
        this.readDelayAt(9, this._taps[11] ?? 0) -
        this.readDelayAt(10, this._taps[12] ?? 0) -
        this.readDelayAt(11, this._taps[13] ?? 0);

      const output0 = outputs[0]?.[0];
      const output1 = outputs[0]?.[1];
      if (
        output0 &&
        output1 &&
        output0[i] !== undefined &&
        output1[i] !== undefined
      ) {
        output0[i] = (output0[i] ?? 0) + lo * we;
        output1[i] = (output1[i] ?? 0) + ro * we;
      }

      this._excPhase += ex;

      i += 1;

      // Advance all delay line indices
      for (const d of this._Delays) {
        if (
          d &&
          d[1] !== undefined &&
          d[2] !== undefined &&
          d[3] !== undefined
        ) {
          // biome-ignore lint/suspicious/noBitwiseOperators: Bitwise AND used for efficient modulo with power-of-2 mask
          d[1] = (d[1] + 1) & d[3];
          // biome-ignore lint/suspicious/noBitwiseOperators: Bitwise AND used for efficient modulo with power-of-2 mask
          d[2] = (d[2] + 1) & d[3];
        }
      }
    }

    // Update preDelay index
    this._pDWrite = (this._pDWrite + 128) % this._pDLength;

    return true;
  }
}

// @ts-expect-error
registerProcessor("dattorro-reverb", DattorroReverbProcessor);
console.log("DattorroReverbProcessor registered");
