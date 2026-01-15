/**
 * AudioWorklet Entry Point
 *
 * This file is bundled separately and loaded as an AudioWorklet module.
 * It wraps the DSPProcessor in an AudioWorkletProcessor class.
 */

/// <reference path="./worklet-env.d.ts" />

import { DSPProcessor } from "./processor.js";

/**
 * AudioWorklet processor wrapper for DSPProcessor
 */
class CacophonyProcessor extends AudioWorkletProcessor {
  private readonly dsp: DSPProcessor;

  constructor() {
    super();
    this.dsp = new DSPProcessor(sampleRate);

    // Set up message callback to send events to main thread
    this.dsp.setMessageCallback((message) => {
      this.port.postMessage(message);
    });

    // Handle messages from main thread
    this.port.onmessage = (event: MessageEvent) => {
      this.dsp.handleMessage(event.data);
    };
  }

  process(
    _inputs: Float32Array[][],
    outputs: Float32Array[][],
    _parameters: Record<string, Float32Array>
  ): boolean {
    const output = outputs[0];
    if (!output || output.length < 2) {
      return true;
    }

    const outputL = output[0];
    const outputR = output[1];

    if (!(outputL && outputR)) {
      return true;
    }

    this.dsp.process(outputL, outputR, 0, outputL.length);

    return true;
  }
}

registerProcessor("cacophony-processor", CacophonyProcessor);
