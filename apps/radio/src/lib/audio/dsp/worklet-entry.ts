import "./modulation-worklet";
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
  // Pre-allocated empty buffer to avoid GC pressure when no input
  private readonly emptyBuffer = new Float32Array(128);

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
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    _parameters: Record<string, Float32Array>
  ): boolean {
    const [input, sidechain] = inputs;
    const [output] = outputs;

    if (!output || output.length < 2) {
      return true;
    }

    const [outputL, outputR] = output;

    if (!(outputL && outputR)) {
      return true;
    }

    // Get input audio from the shared Web Audio graph
    // If no input, use pre-allocated empty buffer to avoid GC pressure
    const inputL = input?.[0] ?? this.emptyBuffer;
    const inputR = input?.[1] ?? input?.[0] ?? this.emptyBuffer;

    this.dsp.process(
      inputL,
      inputR,
      outputL,
      outputR,
      0,
      outputL.length,
      sidechain?.[0],
      sidechain?.[1] ?? sidechain?.[0]
    );

    return true;
  }
}

registerProcessor("cacophony-processor", CacophonyProcessor);
