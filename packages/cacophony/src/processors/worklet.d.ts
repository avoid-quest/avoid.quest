// https://github.com/microsoft/TypeScript/issues/28308#issuecomment-650802278
type AudioWorkletProcessor = {
  readonly port: MessagePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: AudioParamMap
  ): boolean;
};

type AudioParamDescriptor = {
  name: string;
  defaultValue: number;
  minValue?: number;
  maxValue?: number;
  automationRate?: AutomationRate;
};

declare var AudioWorkletProcessor: {
  prototype: AudioWorkletProcessor;
  new (options?: AudioWorkletNodeOptions): AudioWorkletProcessor;
};

declare function registerProcessor(
  name: string,
  processorCtor: (new (
    processorOptions?: AudioWorkletNodeOptions
  ) => AudioWorkletProcessor) & {
    parameterDescriptors?: AudioParamDescriptor[];
  }
): void;

type AudioParamMap = {
  get(name: string): AudioParam | undefined;
  has(name: string): boolean;
  forEach(
    callbackfn: (value: AudioParam, key: string, parent: AudioParamMap) => void,
    thisArg?: unknown
  ): void;
  readonly size: number;
};

// sample rate is 44100 Hz, buffer size is 128 frames
declare const BUFFER_SIZE = 128;
declare const sampleRate = 44_100;
