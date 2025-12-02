/** biome-ignore-all lint/complexity/noUselessConstructor: Required for mixin pattern */
/** biome-ignore-all lint/suspicious/noExplicitAny: Required for mixin pattern */
import type {
  AudioContext,
  AudioNode,
  BiquadFilterNode,
  GainNode,
} from "./context.js";

export type FilterCloneOverrides = {
  filters?: BiquadFilterNode[];
};

export abstract class FilterManager {
  constructor(..._args: unknown[]) {
    // Base class for mixins - constructor required for mixin compatibility
  }
  _filters: BiquadFilterNode[] = [];
  _dryWet = 1.0; // 0.0 = fully dry, 1.0 = fully wet
  _inputGain = 1.0; // Linear gain: 0.0 = -∞dB, 1.0 = 0dB, ~4.0 = +12dB
  _outputGain = 1.0; // Linear gain: 0.0 = -∞dB, 1.0 = 0dB, ~4.0 = +12dB
  _inputGainNode?: GainNode;
  _outputGainNode?: GainNode;
  _wetGainNode?: GainNode;
  _dryGainNode?: GainNode;

  get dryWet(): number {
    return this._dryWet;
  }

  set dryWet(value: number) {
    this._dryWet = Math.max(0, Math.min(1, value));
    if (this._wetGainNode) {
      this._wetGainNode.gain.value = this._dryWet;
    }
    if (this._dryGainNode) {
      this._dryGainNode.gain.value = 1.0 - this._dryWet;
    }
  }

  get inputGain(): number {
    return this._inputGain;
  }

  set inputGain(value: number) {
    this._inputGain = Math.max(0, Math.min(4.0, value));
    if (this._inputGainNode) {
      this._inputGainNode.gain.value = this._inputGain;
    }
  }

  get outputGain(): number {
    return this._outputGain;
  }

  set outputGain(value: number) {
    this._outputGain = Math.max(0, Math.min(4.0, value));
    if (this._outputGainNode) {
      this._outputGainNode.gain.value = this._outputGain;
    }
  }

  addFilter(filter: BiquadFilterNode) {
    this._filters.push(filter);
  }

  removeFilter(filter: BiquadFilterNode) {
    this._filters = this._filters.filter(
      (f) =>
        f.frequency.value !== filter.frequency.value &&
        f.type !== filter.type &&
        f.Q.value !== filter.Q.value &&
        f.gain.value !== filter.gain.value
    );
  }

  applyFilters(connection: AudioNode): AudioNode {
    // Get context from the connection node
    const context = (connection as { context: AudioContext }).context;
    if (!context) {
      // Fallback: if no context available, use simple filter chain
      this._filters.reduce((prevConnection, filter) => {
        prevConnection.connect(filter);
        return filter;
      }, connection);
      return this._filters.length > 0
        ? (this._filters.at(-1) ?? connection)
        : connection;
    }

    // Create input gain node if needed
    if (!this._inputGainNode) {
      this._inputGainNode = context.createGain();
      this._inputGainNode.gain.value = this._inputGain;
    }
    this._inputGainNode.gain.value = this._inputGain;

    // Connect input through input gain
    connection.disconnect();
    connection.connect(this._inputGainNode as unknown as AudioNode);
    let currentNode: AudioNode = this._inputGainNode as unknown as AudioNode;

    // If no filters, just pass through with dry/wet mixing
    if (this._filters.length === 0) {
      // Create merge node for dry/wet
      const mergeNode = context.createGain();
      mergeNode.gain.value = 1.0;

      // Create dry and wet gain nodes if needed
      if (!this._dryGainNode) {
        this._dryGainNode = context.createGain();
      }
      if (!this._wetGainNode) {
        this._wetGainNode = context.createGain();
      }

      this._dryGainNode.gain.value = 1.0 - this._dryWet;
      this._wetGainNode.gain.value = this._dryWet;

      // Dry path: direct connection
      currentNode.connect(this._dryGainNode as unknown as AudioNode);
      this._dryGainNode.connect(mergeNode as unknown as AudioNode);

      // Wet path: also direct (no filters)
      currentNode.connect(this._wetGainNode as unknown as AudioNode);
      this._wetGainNode.connect(mergeNode as unknown as AudioNode);

      currentNode = mergeNode as unknown as AudioNode;
    } else {
      // Create merge node for dry/wet
      const mergeNode = context.createGain();
      mergeNode.gain.value = 1.0;

      // Create dry and wet gain nodes if needed
      if (!this._dryGainNode) {
        this._dryGainNode = context.createGain();
      }
      if (!this._wetGainNode) {
        this._wetGainNode = context.createGain();
      }

      this._dryGainNode.gain.value = 1.0 - this._dryWet;
      this._wetGainNode.gain.value = this._dryWet;

      // Dry path: bypass filters
      currentNode.connect(this._dryGainNode as unknown as AudioNode);
      this._dryGainNode.connect(mergeNode as unknown as AudioNode);

      // Wet path: through filters
      const wetConnection: AudioNode = currentNode;
      this._filters.reduce((prevConnection, filter) => {
        prevConnection.connect(filter);
        return filter;
      }, wetConnection);
      const lastFilter = this._filters.at(-1);
      if (lastFilter) {
        lastFilter.connect(this._wetGainNode as unknown as AudioNode);
        this._wetGainNode.connect(mergeNode as unknown as AudioNode);
      }

      currentNode = mergeNode as unknown as AudioNode;
    }

    // Create output gain node if needed
    if (!this._outputGainNode) {
      this._outputGainNode = context.createGain();
      this._outputGainNode.gain.value = this._outputGain;
    }
    this._outputGainNode.gain.value = this._outputGain;

    currentNode.connect(this._outputGainNode as unknown as AudioNode);

    return this._outputGainNode as unknown as AudioNode;
  }

  get filters() {
    return this._filters;
  }

  addFilters(filters: BiquadFilterNode[]) {
    // todo: be more efficient
    for (const filter of filters) {
      this.addFilter(filter);
    }
  }

  removeFilters(filters: BiquadFilterNode[]) {
    for (const filter of filters) {
      this.removeFilter(filter);
    }
  }

  cleanup(): void {
    // Disconnect all gain nodes
    if (this._inputGainNode) {
      this._inputGainNode.disconnect();
    }
    if (this._outputGainNode) {
      this._outputGainNode.disconnect();
    }
    if (this._wetGainNode) {
      this._wetGainNode.disconnect();
    }
    if (this._dryGainNode) {
      this._dryGainNode.disconnect();
    }
    // Disconnect all filters before removing them
    for (const filter of this._filters) {
      filter.disconnect();
    }
    this._filters = [];
    this._inputGainNode = undefined;
    this._outputGainNode = undefined;
    this._wetGainNode = undefined;
    this._dryGainNode = undefined;
  }
}
