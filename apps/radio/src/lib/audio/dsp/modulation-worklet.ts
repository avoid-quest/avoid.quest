/// <reference path="./worklet-env.d.ts" />
import {
  ModulationDsp,
  type ModulationMessage,
} from "../../node-graph/modulation-dsp";

class NodeModulationProcessor extends AudioWorkletProcessor {
  private readonly dsp = new ModulationDsp(sampleRate);
  private frames = 0;
  private awaitingAck = false;
  private running = true as boolean;

  constructor() {
    super();
    this.port.onmessage = ({ data }: MessageEvent<ModulationMessage>) => {
      switch (data.type) {
        case "ack":
          this.awaitingAck = false;
          break;
        case "configure":
          this.dsp.configure(data.program);
          break;
        case "gate":
          this.dsp.gate(data.id, data.on);
          break;
        case "midi":
          this.dsp.midi(data.bytes);
          break;
        case "native-values":
          this.dsp.setNativeValues(data.values);
          break;
        case "stop":
          this.running = false;
          break;
        default:
          break;
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (!this.running) {
      return false;
    }
    const frames = outputs[0]?.[0]?.length ?? 128;
    const values = this.dsp.process(inputs, frames);
    this.frames += frames;
    if (this.frames >= sampleRate / 30 && !this.awaitingAck) {
      this.frames %= sampleRate / 30;
      this.awaitingAck = true;
      this.port.postMessage({
        amounts: this.dsp.amounts,
        resets: [...this.dsp.resets],
        type: "values",
        values,
      });
      this.dsp.resets.clear();
    }
    return true;
  }
}

registerProcessor("node-modulation-processor", NodeModulationProcessor);
