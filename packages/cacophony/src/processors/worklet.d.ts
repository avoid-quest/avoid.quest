export {};

declare global {
  var sampleRate: number;
  
  interface AudioWorkletProcessor {
    readonly port: MessagePort;
    process(
      inputs: Float32Array[][],
      outputs: Float32Array[][],
      parameters: Record<string, Float32Array> | AudioParamMap
    ): boolean;
  }

  var AudioWorkletProcessor: {
    prototype: AudioWorkletProcessor;
    new (options?: any): AudioWorkletProcessor;
  };

  interface AudioParamDescriptor {
    name: string;
    defaultValue?: number;
    minValue?: number;
    maxValue?: number;
    automationRate?: "a-rate" | "k-rate";
  }

  function registerProcessor(
    name: string,
    processorCtor: new () => AudioWorkletProcessor
  ): void;
}
