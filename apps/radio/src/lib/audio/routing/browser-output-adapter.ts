import type {
  OutputBrowserAdapter,
  OutputBrowserGraph,
  OutputCueSink,
} from "../../output-routing.js";
import { getAudioContext } from "../playback/audio-context.js";
import {
  isSinkIdSupported,
  safeDisconnect,
  safeDisconnectFrom,
} from "../utils.js";

const MAX_OUTPUT_DELAY_SECONDS = 0.5;

class BrowserOutputGraph implements OutputBrowserGraph {
  readonly context: AudioContext;
  readonly cueDelay: DelayNode;
  readonly cueInput: GainNode;
  readonly headphoneGain: GainNode;
  readonly mainDelay: DelayNode;
  readonly mainOutput: AudioNode;

  constructor(context: AudioContext) {
    this.context = context;
    this.mainDelay = context.createDelay(MAX_OUTPUT_DELAY_SECONDS);
    this.mainOutput = this.mainDelay;
    this.cueInput = context.createGain();
    this.cueDelay = context.createDelay(MAX_OUTPUT_DELAY_SECONDS);
    this.headphoneGain = context.createGain();
    this.mainDelay.connect(context.destination);
    this.cueInput.connect(this.cueDelay);
    this.cueDelay.connect(this.headphoneGain);
  }

  connectCue(source: AudioNode): void {
    source.connect(this.cueInput);
  }

  connectMain(source: AudioNode, realtime = false): void {
    source.connect(realtime ? this.context.destination : this.mainDelay);
  }

  disconnectCue(source: AudioNode): void {
    safeDisconnectFrom(source, this.cueInput, "OutputRouting.disconnectCue");
  }

  disconnectMain(source: AudioNode): void {
    safeDisconnectFrom(source, this.mainDelay, "OutputRouting.disconnectMain");
    safeDisconnectFrom(
      source,
      this.context.destination,
      "OutputRouting.disconnectMainRealtime"
    );
  }

  dispose(): void {
    safeDisconnect(this.mainDelay, "OutputRouting.cleanup");
    safeDisconnect(this.cueInput, "OutputRouting.cleanup");
    safeDisconnect(this.cueDelay, "OutputRouting.cleanup");
    safeDisconnect(this.headphoneGain, "OutputRouting.cleanup");
  }

  setCueDelay(delayMs: number): void {
    this.cueDelay.delayTime.setTargetAtTime(
      delayMs / 1000,
      this.context.currentTime,
      0.02
    );
  }

  setHeadphoneVolume(volume: number): void {
    this.headphoneGain.gain.setTargetAtTime(
      volume,
      this.context.currentTime,
      0.02
    );
  }

  setMainDelay(delayMs: number): void {
    this.mainDelay.delayTime.setTargetAtTime(
      delayMs / 1000,
      this.context.currentTime,
      0.02
    );
  }
}

class BrowserCueSink implements OutputCueSink {
  readonly deviceId: string;
  private disposed = false as boolean;
  private readonly destination: MediaStreamAudioDestinationNode;
  private readonly element: HTMLAudioElement;
  private readonly graph: BrowserOutputGraph;

  constructor(
    deviceId: string,
    graph: BrowserOutputGraph,
    destination: MediaStreamAudioDestinationNode,
    element: HTMLAudioElement
  ) {
    this.deviceId = deviceId;
    this.graph = graph;
    this.destination = destination;
    this.element = element;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    safeDisconnectFrom(
      this.graph.headphoneGain,
      this.destination,
      "OutputRouting.cleanupCue"
    );
    this.element.pause();
    this.element.srcObject = null;
  }
}

class BrowserOutputAdapter implements OutputBrowserAdapter {
  async createCueSink(
    graph: OutputBrowserGraph,
    deviceId: string
  ): Promise<OutputCueSink> {
    if (!(graph instanceof BrowserOutputGraph)) {
      throw new Error("CUE output requires a browser output graph");
    }
    if (!this.isSinkSelectionSupported()) {
      throw new Error("Output device selection is not supported");
    }

    const destination = graph.context.createMediaStreamDestination();
    const element = new Audio();
    const sink = new BrowserCueSink(deviceId, graph, destination, element);
    graph.headphoneGain.connect(destination);
    element.srcObject = destination.stream;
    element.volume = 1;

    try {
      await element.setSinkId(deviceId);
      await element.play();
      return sink;
    } catch (error) {
      sink.dispose();
      throw error;
    }
  }

  createGraph(context: AudioContext): OutputBrowserGraph {
    return new BrowserOutputGraph(context);
  }

  getContext(): AudioContext {
    return getAudioContext();
  }

  isSinkSelectionSupported(): boolean {
    return isSinkIdSupported();
  }

  async setMainSink(context: AudioContext, deviceId: string): Promise<void> {
    if (!this.isSinkSelectionSupported()) {
      if (deviceId === "default") {
        return;
      }
      throw new Error("Output device selection is not supported");
    }
    await context.setSinkId(deviceId);
  }
}

export function createBrowserOutputAdapter(): OutputBrowserAdapter {
  return new BrowserOutputAdapter();
}
