import { BasePlayback } from "./base-playback.js";
import type { BaseSound } from "./cacophony.js";
import type {
  AudioContext,
  AudioNode,
  GainNode,
  OscillatorNode,
} from "./context.js";
import { OscillatorMixin } from "./oscillator-mixin.js";
import type { Synth } from "./synth.js";

const SynthPlaybackBase = OscillatorMixin(BasePlayback);

export class SynthPlayback extends SynthPlaybackBase implements BaseSound {
  context: AudioContext;
  origin: Synth;
  source: OscillatorNode;
  constructor(origin: Synth, source: OscillatorNode, gainNode: GainNode) {
    super();
    this.context = origin.context;
    this.origin = origin;
    this.source = source;
    this.setPanType(origin.panType, origin.context);
    if (this.panner) {
      this.source.connect(this.panner);
    }
    this.setGainNode(gainNode);
    if (this.panner && this.gainNode) {
      this.panner.connect(this.gainNode);
    }
    this.refreshFilters();
  }

  /**
   * Refreshes the audio filters by re-applying them to the audio signal chain.
   * This method is called internally whenever filters are added or removed.
   * @throws {Error} Throws an error if the synth has been cleaned up.
   */

  private refreshFilters(): void {
    if (!(this.panner && this.gainNode)) {
      throw new Error(
        "Cannot update filters on a sound that has been cleaned up"
      );
    }
    let connection: AudioNode = this.panner as unknown as AudioNode;
    connection.disconnect();
    connection = this.applyFilters(connection);
    if (this.gainNode) {
      connection.connect(this.gainNode as unknown as AudioNode);
    }
  }

  cleanup(): void {
    if (this.panner && this.gainNode) {
      this.source.disconnect(this.panner);
      this.panner.disconnect();
      this.gainNode.disconnect();
    }
    super.cleanup();
  }
}
