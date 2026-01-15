/**
 * AudioWorklet environment type declarations
 *
 * These globals are available in the AudioWorklet scope.
 */

declare const sampleRate: number;
declare const currentTime: number;
declare const currentFrame: number;

declare function registerProcessor(
  name: string,
  processorCtor: new (
    options?: AudioWorkletNodeOptions
  ) => AudioWorkletProcessor
): void;

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean;
}

interface AudioWorkletNodeOptions {
  numberOfInputs?: number;
  numberOfOutputs?: number;
  outputChannelCount?: number[];
  parameterData?: Record<string, number>;
  processorOptions?: unknown;
}
