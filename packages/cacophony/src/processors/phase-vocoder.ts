import FFT from "fft.js";
import OLAProcessor from "./ola.js";

const BUFFERED_BLOCK_SIZE = 2048;

function genHannWindow(length: number): Float32Array {
  const win = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / length));
  }
  return win;
}

interface PhaseVocoderNodeOptions extends AudioWorkletNodeOptions {
  processorOptions: {
    blockSize: number;
  };
}

export class PhaseVocoderProcessor extends OLAProcessor {
  fftSize: number;
  timeCursor: number;
  hannWindow: Float32Array;
  fft: FFT;
  freqComplexBuffer: Float32Array;
  freqComplexBufferShifted: Float32Array;
  timeComplexBuffer: Float32Array;
  magnitudes: Float32Array;
  peakIndexes: Int32Array;
  nbPeaks: number;

  static get parameterDescriptors() {
    return [
      {
        name: "pitchFactor",
        defaultValue: 1.0,
      },
    ];
  }

  constructor(options: PhaseVocoderNodeOptions) {
    options.processorOptions = {
      blockSize: BUFFERED_BLOCK_SIZE,
    };
    super(options);

    this.fftSize = this.blockSize;
    this.timeCursor = 0;

    this.hannWindow = genHannWindow(this.blockSize);

    // prepare FFT and pre-allocate buffers
    this.fft = new FFT(this.fftSize);
    this.freqComplexBuffer =
      this.fft.createComplexArray() as unknown as Float32Array;
    this.freqComplexBufferShifted =
      this.fft.createComplexArray() as unknown as Float32Array;
    this.timeComplexBuffer =
      this.fft.createComplexArray() as unknown as Float32Array;
    this.magnitudes = new Float32Array(this.fftSize / 2 + 1);
    this.peakIndexes = new Int32Array(this.magnitudes.length);
    this.nbPeaks = 0;
  }

  processOLA(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: AudioParamMap
  ) {
    const pitchFactorParam = parameters.get("pitchFactor");
    const pitchFactor = pitchFactorParam?.value ?? 1.0;

    for (let i = 0; i < this.nbInputs; i++) {
      const inputArray = inputs[i];
      const outputArray = outputs[i];
      if (inputArray && outputArray) {
        for (let j = 0; j < inputArray.length; j++) {
          const input = inputArray[j];
          const output = outputArray[j];
          if (input && output) {
            this.applyHannWindow(input);

            this.fft.realTransform(this.freqComplexBuffer, input);

            this.computeMagnitudes();
            this.findPeaks();
            this.shiftPeaks(pitchFactor);

            this.fft.completeSpectrum(this.freqComplexBufferShifted);
            this.fft.inverseTransform(
              this.timeComplexBuffer,
              this.freqComplexBufferShifted
            );
            this.fft.fromComplexArray(this.timeComplexBuffer, output);

            this.applyHannWindow(output);
          }
        }
      }
    }

    this.timeCursor += this.hopSize;
    return true;
  }

  private applyHannWindow(input: Float32Array) {
    for (let i = 0; i < this.blockSize; i++) {
      const windowValue = this.hannWindow[i];
      if (windowValue !== undefined) {
        input[i] = (input[i] ?? 0) * windowValue;
      }
    }
  }

  private computeMagnitudes() {
    for (let i = 0, j = 0; i < this.magnitudes.length; i++, j += 2) {
      const real = this.freqComplexBuffer[j] ?? 0;
      const imag = this.freqComplexBuffer[j + 1] ?? 0;
      this.magnitudes[i] = real ** 2 + imag ** 2;
    }
  }

  private findPeaks() {
    this.nbPeaks = 0;
    for (let i = 2, end = this.magnitudes.length - 2; i < end; i++) {
      const mag = this.magnitudes[i];
      if (mag === undefined) {
        continue;
      }

      const magPrev1 = this.magnitudes[i - 1];
      const magPrev2 = this.magnitudes[i - 2];
      const magNext1 = this.magnitudes[i + 1];
      const magNext2 = this.magnitudes[i + 2];

      if (
        (magPrev1 !== undefined && magPrev1 >= mag) ||
        (magPrev2 !== undefined && magPrev2 >= mag) ||
        (magNext1 !== undefined && magNext1 >= mag) ||
        (magNext2 !== undefined && magNext2 >= mag)
      ) {
        continue;
      }

      this.peakIndexes[this.nbPeaks] = i;
      this.nbPeaks += 1;
    }
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Complex phase vocoder peak shifting algorithm
  private shiftPeaks(pitchFactor: number) {
    this.freqComplexBufferShifted.fill(0);

    for (let i = 0; i < this.nbPeaks; i++) {
      const peakIndex = this.peakIndexes[i];
      if (peakIndex === undefined) {
        continue;
      }
      const peakIndexShifted = Math.round(peakIndex * pitchFactor);

      if (peakIndexShifted > this.magnitudes.length) {
        break;
      }

      const prevPeakIndex = i > 0 ? this.peakIndexes[i - 1] : undefined;
      const nextPeakIndex =
        i < this.nbPeaks - 1 ? this.peakIndexes[i + 1] : undefined;

      const startIndex =
        i > 0 && prevPeakIndex !== undefined
          ? peakIndex - Math.floor((peakIndex - prevPeakIndex) / 2)
          : 0;
      const endIndex =
        i < this.nbPeaks - 1 && nextPeakIndex !== undefined
          ? peakIndex + Math.ceil((nextPeakIndex - peakIndex) / 2)
          : this.fftSize;

      for (let j = startIndex - peakIndex; j < endIndex - peakIndex; j++) {
        const binIndex = peakIndex + j;
        const binIndexShifted = peakIndexShifted + j;

        if (binIndexShifted >= this.magnitudes.length) {
          break;
        }

        const omegaDelta =
          (2 * Math.PI * (binIndexShifted - binIndex)) / this.fftSize;
        const phaseShiftReal = Math.cos(omegaDelta * this.timeCursor);
        const phaseShiftImag = Math.sin(omegaDelta * this.timeCursor);

        const indexReal = binIndex * 2;
        const indexImag = indexReal + 1;
        const valueReal = this.freqComplexBuffer[indexReal] ?? 0;
        const valueImag = this.freqComplexBuffer[indexImag] ?? 0;

        const valueShiftedReal =
          valueReal * phaseShiftReal - valueImag * phaseShiftImag;
        const valueShiftedImag =
          valueReal * phaseShiftImag + valueImag * phaseShiftReal;

        const indexShiftedReal = binIndexShifted * 2;
        const indexShiftedImag = indexShiftedReal + 1;
        const currentReal =
          this.freqComplexBufferShifted[indexShiftedReal] ?? 0;
        const currentImag =
          this.freqComplexBufferShifted[indexShiftedImag] ?? 0;
        this.freqComplexBufferShifted[indexShiftedReal] =
          currentReal + valueShiftedReal;
        this.freqComplexBufferShifted[indexShiftedImag] =
          currentImag + valueShiftedImag;
      }
    }
  }
}

// @ts-expect-error
registerProcessor("phase-vocoder", PhaseVocoderProcessor);
console.log("PhaseVocoderProcessor registered");
