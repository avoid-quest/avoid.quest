/**
 * CUE Bus System
 *
 * Provides pre-fader monitoring for DJ headphones.
 * Each deck can have its CUE enabled independently, allowing the DJ
 * to preview tracks before bringing them into the mix.
 *
 * Features:
 * - Per-deck CUE send (pre-fader tap point)
 * - CUE/MIX blend control (0 = only cue, 1 = only mix)
 * - Dual output support via MediaStream bridge
 * - Split cue fallback (L=CUE, R=MIX for single stereo output)
 */

import { safeDisconnect } from "../manager/audio-manager.js";

/**
 * Check if setSinkId is supported
 */
function isSinkIdSupported(): boolean {
  if (typeof AudioContext === "undefined") {
    return false;
  }
  return "setSinkId" in AudioContext.prototype;
}

/**
 * CUE send for a single deck
 */
type DeckCueSend = {
  enabled: boolean;
  inputNode: GainNode; // Connection point from deck's pre-fader output
  gain: GainNode; // CUE send level (0 when disabled, 1 when enabled)
};

/**
 * CUE mode for output
 */
export type CueMode = "dual" | "split";

/**
 * CueBus state
 */
export type CueBusState = {
  mode: CueMode;
  cueBlend: number; // 0 = only CUE, 0.5 = both, 1 = only MIX
  deckCueEnabled: Record<string, boolean>;
};

/**
 * Callbacks for CueBus events
 */
export type CueBusCallbacks = {
  onCueBlendChange?: (blend: number) => void;
  onDeckCueChange?: (deckId: string, enabled: boolean) => void;
  onModeChange?: (mode: CueMode) => void;
  onError?: (error: Error) => void;
};

/**
 * CueBus
 *
 * Manages pre-fader CUE monitoring for DJ headphones.
 *
 * Audio routing (dual mode with separate CUE output):
 * ```
 * Deck A (pre-fader) ──┬──► CUE Bus ──► cueGain ──┬──► CUE Output
 * Deck B (pre-fader) ──┘                          │
 *                                                 │
 * Main Mix ─────────────────► mixGain ────────────┘
 * ```
 *
 * Audio routing (split mode - mono L/R in single stereo output):
 * ```
 * CUE ──► Left channel  ──┬──► Main Output (split)
 * MIX ──► Right channel ──┘
 * ```
 */
export class CueBus {
  private readonly context: AudioContext;
  private readonly cueContext: AudioContext | null;
  private readonly callbacks: CueBusCallbacks;

  // CUE bus summing node (all deck CUE sends mix here)
  private readonly cueSumNode: GainNode;

  // Output blend controls
  private readonly cueGain: GainNode; // CUE level in headphones
  private readonly mixGain: GainNode; // MIX level in headphones

  // For split cue mode (mono L/R)
  private readonly splitter: ChannelSplitterNode | null = null;
  private readonly merger: ChannelMergerNode | null = null;

  // Per-deck CUE sends
  private readonly deckSends = new Map<string, DeckCueSend>();

  // State
  private _mode: CueMode;
  private _cueBlend = 0.5; // Default: 50% CUE, 50% MIX
  private _mainMixInput: AudioNode | null = null;

  // For dynamic CUE output device (MediaStream bridge)
  private _cueDeviceId: string | null = null;
  private _cueMediaStreamDest: MediaStreamAudioDestinationNode | null = null;
  private _cueAudioElement: HTMLAudioElement | null = null;
  private _cueOutputContext: AudioContext | null = null;

  constructor(
    mainContext: AudioContext,
    cueContext: AudioContext | null,
    callbacks: CueBusCallbacks = {}
  ) {
    this.context = mainContext;
    this.cueContext = cueContext;
    this.callbacks = callbacks;

    // Determine mode based on whether we have a separate CUE context
    this._mode = cueContext ? "dual" : "split";

    // Create CUE summing bus
    this.cueSumNode = this.context.createGain();
    this.cueSumNode.gain.value = 1;

    // Create blend controls (in the CUE output context)
    const outputContext = cueContext ?? mainContext;
    this.cueGain = outputContext.createGain();
    this.mixGain = outputContext.createGain();

    // Set initial blend (50/50)
    this.applyBlend();

    // Set up routing based on mode
    if (this._mode === "split") {
      // Split cue: L=CUE, R=MIX through channel manipulation
      this.splitter = this.context.createChannelSplitter(2);
      this.merger = this.context.createChannelMerger(2);

      // CUE (mono) → left channel
      // MIX (mono) → right channel
      // This requires mono downmix, which we'll handle via gain nodes
    }

    this.connectOutputGraph();
  }

  /**
   * Get current CUE mode
   */
  get mode(): CueMode {
    return this._mode;
  }

  /**
   * Get current CUE/MIX blend value
   */
  get cueBlend(): number {
    return this._cueBlend;
  }

  /**
   * Get current state
   */
  get state(): CueBusState {
    const deckCueEnabled: Record<string, boolean> = {};
    for (const [deckId, send] of this.deckSends) {
      deckCueEnabled[deckId] = send.enabled;
    }
    return {
      mode: this._mode,
      cueBlend: this._cueBlend,
      deckCueEnabled,
    };
  }

  /**
   * Get the CUE summing bus output node
   * Used for connecting to analysis (VU meters, etc.)
   */
  get cueSumOutput(): GainNode {
    return this.cueSumNode;
  }

  /**
   * Register a deck for CUE monitoring
   * Returns the input node that the deck should connect its pre-fader output to
   */
  registerDeck(deckId: string): GainNode {
    // Clean up existing if any
    this.unregisterDeck(deckId);

    // Create input node for the deck to connect to
    const inputNode = this.context.createGain();
    inputNode.gain.value = 1;

    // Create CUE send gain (controls whether CUE is enabled)
    const gain = this.context.createGain();
    gain.gain.value = 0; // Disabled by default

    // Connect: input → gain → CUE sum
    inputNode.connect(gain);
    gain.connect(this.cueSumNode);

    const send: DeckCueSend = {
      enabled: false,
      inputNode,
      gain,
    };

    this.deckSends.set(deckId, send);

    return inputNode;
  }

  /**
   * Unregister a deck from CUE monitoring
   */
  unregisterDeck(deckId: string): void {
    const send = this.deckSends.get(deckId);
    if (send) {
      safeDisconnect(send.inputNode, "CueBus.unregisterDeck");
      safeDisconnect(send.gain, "CueBus.unregisterDeck");
      this.deckSends.delete(deckId);
    }
  }

  /**
   * Enable or disable CUE for a deck
   */
  setCueEnabled(deckId: string, enabled: boolean): void {
    const send = this.deckSends.get(deckId);
    if (!send) {
      console.warn(`[CueBus] Deck ${deckId} not registered for CUE`);
      return;
    }

    send.enabled = enabled;

    // Smoothly ramp gain to avoid clicks
    const now = this.context.currentTime;
    send.gain.gain.setTargetAtTime(enabled ? 1 : 0, now, 0.01);

    this.callbacks.onDeckCueChange?.(deckId, enabled);
  }

  /**
   * Check if CUE is enabled for a deck
   */
  isCueEnabled(deckId: string): boolean {
    return this.deckSends.get(deckId)?.enabled ?? false;
  }

  /**
   * Set CUE/MIX blend for headphones
   * 0 = only CUE (pre-fader deck audio)
   * 0.5 = both (default)
   * 1 = only MIX (main program audio)
   */
  setCueMixBlend(blend: number): void {
    this._cueBlend = Math.max(0, Math.min(1, blend));
    this.applyBlend();
    this.callbacks.onCueBlendChange?.(this._cueBlend);
  }

  /**
   * Connect the main mix to the CUE bus for blending
   * This should be the final main mix output (post-crossfader, post-master)
   */
  connectMainMix(mainMixNode: AudioNode): void {
    // Disconnect previous if any
    if (this._mainMixInput) {
      safeDisconnect(this._mainMixInput, "CueBus.connectMainMix");
    }

    this._mainMixInput = mainMixNode;

    // Route to the mix gain for blending (for CUE/MIX blend in headphones)
    mainMixNode.connect(this.mixGain);
  }

  /**
   * Set CUE output device for separate headphone monitoring
   * This creates a MediaStream bridge to route CUE audio to a different device
   * @param deviceId - The output device ID, or null to use split cue mode
   */
  async setCueOutputDevice(deviceId: string | null): Promise<void> {
    // Cleanup existing CUE output
    this.cleanupCueOutput();

    if (!(deviceId && isSinkIdSupported())) {
      // No separate CUE device - use split cue mode
      this._cueDeviceId = null;
      this._mode = "split";
      this.reconnectOutputGraph();
      return;
    }

    this._cueDeviceId = deviceId;
    this._mode = "dual";

    try {
      // Create MediaStreamDestination for CUE audio
      this._cueMediaStreamDest = this.context.createMediaStreamDestination();

      // Route CUE bus to MediaStream
      // Disconnect from previous destination first
      safeDisconnect(this.cueGain, "CueBus.setCueOutputDevice");
      this.cueSumNode.connect(this.cueGain);
      this.cueGain.connect(this._cueMediaStreamDest);

      // Also route MIX to MediaStream for CUE/MIX blend
      safeDisconnect(this.mixGain, "CueBus.setCueOutputDevice");
      this.mixGain.connect(this._cueMediaStreamDest);

      // Create audio element to play the MediaStream
      this._cueAudioElement = new Audio();
      this._cueAudioElement.srcObject = this._cueMediaStreamDest.stream;

      // Set the output device on the audio element
      if ("setSinkId" in this._cueAudioElement) {
        await (
          this._cueAudioElement as HTMLAudioElement & {
            setSinkId: (id: string) => Promise<void>;
          }
        ).setSinkId(deviceId);
      }

      // Start playback
      await this._cueAudioElement.play();

      this.callbacks.onModeChange?.("dual");
    } catch (error) {
      console.error("[CueBus] Failed to set CUE output device:", error);
      this.cleanupCueOutput();
      this._mode = "split";
      this.reconnectOutputGraph();
      this.callbacks.onError?.(
        error instanceof Error ? error : new Error("Failed to set CUE output")
      );
    }
  }

  /**
   * Clean up CUE output resources
   */
  private cleanupCueOutput(): void {
    if (this._cueAudioElement) {
      this._cueAudioElement.pause();
      this._cueAudioElement.srcObject = null;
      this._cueAudioElement = null;
    }
    if (this._cueMediaStreamDest) {
      safeDisconnect(this._cueMediaStreamDest, "CueBus.cleanupCueOutput");
      this._cueMediaStreamDest = null;
    }
    if (this._cueOutputContext) {
      this._cueOutputContext.close().catch((e) => {
        console.warn("[CueBus] Error closing CUE context:", e);
      });
      this._cueOutputContext = null;
    }
  }

  /**
   * Reconnect the output graph after mode change
   */
  private reconnectOutputGraph(): void {
    // Disconnect current connections
    safeDisconnect(this.cueGain, "CueBus.reconnectOutputGraph");
    safeDisconnect(this.mixGain, "CueBus.reconnectOutputGraph");
    if (this.merger) {
      safeDisconnect(this.merger, "CueBus.reconnectOutputGraph");
    }

    // Reconnect based on mode
    this.connectOutputGraph();
  }

  /**
   * Get the CUE output destination node
   * In dual mode, this goes to the CUE context destination
   * In split mode, this is the merged L/R output
   */
  get destination(): AudioNode {
    if (this._mode === "dual" && this.cueContext) {
      return this.cueContext.destination;
    }
    if (this.merger) {
      return this.merger;
    }
    return this.context.destination;
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    this.cleanupCueOutput();

    for (const deckId of this.deckSends.keys()) {
      this.unregisterDeck(deckId);
    }

    safeDisconnect(this.cueSumNode, "CueBus.cleanup");
    safeDisconnect(this.cueGain, "CueBus.cleanup");
    safeDisconnect(this.mixGain, "CueBus.cleanup");

    if (this.splitter) {
      safeDisconnect(this.splitter, "CueBus.cleanup");
    }
    if (this.merger) {
      safeDisconnect(this.merger, "CueBus.cleanup");
    }
  }

  /**
   * Get the current CUE output device ID
   */
  get cueDeviceId(): string | null {
    return this._cueDeviceId;
  }

  /**
   * Apply the current blend setting
   */
  private applyBlend(): void {
    const outputContext = this.cueContext ?? this.context;
    const now = outputContext.currentTime;

    // CUE level = 1 - blend (full when blend=0, silent when blend=1)
    // MIX level = blend (silent when blend=0, full when blend=1)
    const cueLevel = 1 - this._cueBlend;
    const mixLevel = this._cueBlend;

    this.cueGain.gain.setTargetAtTime(cueLevel, now, 0.01);
    this.mixGain.gain.setTargetAtTime(mixLevel, now, 0.01);
  }

  /**
   * Set up the output routing graph
   */
  private connectOutputGraph(): void {
    if (this._mode === "dual" && this.cueContext) {
      // Dual mode: CUE sum → cueGain → CUE destination
      // Main mix is routed separately to CUE context via OutputRouter

      // Note: We can't directly connect from mainContext to cueContext
      // The CueBus operates in mainContext for deck taps
      // The actual CUE output routing must be handled by duplicating the audio
      // or using MediaStreamDestination/MediaStreamSource bridge

      // For now, we'll connect to main destination as fallback
      // Real dual output requires OutputRouter integration
      this.cueSumNode.connect(this.cueGain);
      this.cueGain.connect(this.cueContext.destination);

      // Mix gain connects to CUE context destination too
      this.mixGain.connect(this.cueContext.destination);
    } else if (this.splitter && this.merger) {
      // Split mode: L=CUE, R=MIX

      // Create mono downmix for CUE
      const cueMono = this.context.createGain();
      cueMono.gain.value = 1;

      // Create mono downmix for MIX
      const mixMono = this.context.createGain();
      mixMono.gain.value = 1;

      // CUE sum → cueGain → cueMono → left channel
      this.cueSumNode.connect(this.cueGain);
      this.cueGain.connect(cueMono);
      cueMono.connect(this.merger, 0, 0); // Left

      // MIX input → mixGain → mixMono → right channel
      // (mainMix is connected later via connectMainMix)
      this.mixGain.connect(mixMono);
      mixMono.connect(this.merger, 0, 1); // Right

      // Merger output goes to destination
      this.merger.connect(this.context.destination);
    } else {
      // Fallback: simple blend to main destination
      this.cueSumNode.connect(this.cueGain);
      this.cueGain.connect(this.context.destination);
      this.mixGain.connect(this.context.destination);
    }
  }
}

/**
 * Create a CueBus instance
 */
export function createCueBus(
  mainContext: AudioContext,
  cueContext: AudioContext | null = null,
  callbacks: CueBusCallbacks = {}
): CueBus {
  return new CueBus(mainContext, cueContext, callbacks);
}
