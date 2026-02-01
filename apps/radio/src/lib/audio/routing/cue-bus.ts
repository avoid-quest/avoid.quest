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

  // Split cue mode nodes (L=CUE, R=MIX)
  private readonly splitMerger: ChannelMergerNode;
  private readonly cueMono: GainNode; // Mono CUE for left channel
  private readonly mixMono: GainNode; // Mono MIX for right channel

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

    // Create split cue nodes (for L=CUE, R=MIX mode)
    // Merger combines two mono signals into stereo (input 0 = L, input 1 = R)
    this.splitMerger = mainContext.createChannelMerger(2);
    this.cueMono = mainContext.createGain();
    this.mixMono = mainContext.createGain();

    // Set initial blend (50/50)
    this.applyBlend();

    // Set up output routing
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
   * If deck is already registered, returns existing input node (preserves CUE state)
   */
  registerDeck(deckId: string): GainNode {
    // Return existing input node if already registered (preserves CUE state)
    const existing = this.deckSends.get(deckId);
    if (existing) {
      console.info(
        `[CueBus] Deck ${deckId} already registered, reusing input (enabled=${existing.enabled}, gain=${existing.gain.gain.value})`
      );
      return existing.inputNode;
    }

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

    console.info(
      `[CueBus] Registered deck ${deckId}: inputNode → gain(0) → cueSumNode`
    );

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

    // Set gain immediately - the ramp time is too short to matter and
    // setTargetAtTime doesn't work reliably when context was just created
    const targetGain = enabled ? 1 : 0;
    send.gain.gain.value = targetGain;

    console.info(
      `[CueBus] CUE ${enabled ? "enabled" : "disabled"} for ${deckId}, gain set to ${targetGain}, mode: ${this._mode}`
    );

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
    console.info("[CueBus] setCueOutputDevice called with:", deviceId);

    // Cleanup existing CUE output (but don't disconnect deck sends)
    this.cleanupCueOutput();

    if (!(deviceId && isSinkIdSupported())) {
      console.info(
        "[CueBus] No deviceId or setSinkId not supported, using split mode"
      );
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
      console.info("[CueBus] Created MediaStreamDestination");

      // Log current deck send states before reconnecting
      for (const [deckId, send] of this.deckSends) {
        console.info(
          `[CueBus] Deck ${deckId} send state: enabled=${send.enabled}, gain=${send.gain.gain.value}`
        );
      }

      // Disconnect cueSumNode's OUTPUTS (split cue connections to destination)
      // This does NOT affect INPUTS (deck sends → cueSumNode)
      // disconnect() only removes outgoing connections, not incoming ones
      safeDisconnect(this.cueSumNode, "CueBus.setCueOutputDevice");
      console.info("[CueBus] Disconnected cueSumNode outputs (split mode)");

      // Connect cueSumNode to MediaStreamDest for CUE output
      this.cueSumNode.connect(this._cueMediaStreamDest);
      console.info("[CueBus] Connected cueSumNode to MediaStreamDestination");

      // Create audio element to play the MediaStream
      this._cueAudioElement = new Audio();
      this._cueAudioElement.srcObject = this._cueMediaStreamDest.stream;

      // Set the output device on the audio element
      if ("setSinkId" in this._cueAudioElement) {
        console.info("[CueBus] Setting sinkId to:", deviceId);
        await (
          this._cueAudioElement as HTMLAudioElement & {
            setSinkId: (id: string) => Promise<void>;
          }
        ).setSinkId(deviceId);
        console.info("[CueBus] setSinkId success");
      }

      // Start playback
      await this._cueAudioElement.play();
      console.info("[CueBus] CUE audio element playing");

      // Debug: Check MediaStream tracks
      const tracks = this._cueMediaStreamDest.stream.getAudioTracks();
      console.info(
        `[CueBus] MediaStream has ${tracks.length} audio track(s), enabled: ${tracks.map((t) => t.enabled)}`
      );

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
    safeDisconnect(this.cueSumNode, "CueBus.reconnectOutputGraph");
    safeDisconnect(this.cueGain, "CueBus.reconnectOutputGraph");
    safeDisconnect(this.mixGain, "CueBus.reconnectOutputGraph");
    safeDisconnect(this.cueMono, "CueBus.reconnectOutputGraph");
    safeDisconnect(this.mixMono, "CueBus.reconnectOutputGraph");
    safeDisconnect(this.splitMerger, "CueBus.reconnectOutputGraph");

    // Reconnect based on mode
    this.connectOutputGraph();
  }

  /**
   * Get the CUE output destination node
   */
  get destination(): AudioNode {
    if (this._mode === "dual" && this.cueContext) {
      return this.cueContext.destination;
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
    safeDisconnect(this.cueMono, "CueBus.cleanup");
    safeDisconnect(this.mixMono, "CueBus.cleanup");
    safeDisconnect(this.splitMerger, "CueBus.cleanup");
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
    if (this._mode === "split") {
      // Split cue mode: L=CUE, R=MIX on single stereo output
      // Route CUE (pre-fader deck audio) to left channel
      this.cueSumNode.connect(this.cueMono);
      this.cueMono.connect(this.splitMerger, 0, 0); // Input 0 to merger channel 0 (L)

      // Route MIX to right channel (via mixMono which will get input from connectMainMix)
      this.mixMono.connect(this.splitMerger, 0, 1); // Input 0 to merger channel 1 (R)

      // Merger to destination
      this.splitMerger.connect(this.context.destination);

      console.info("[CueBus] Split cue mode: L=CUE, R=MIX");
    } else {
      // Dual mode: separate CUE output device handled by setCueOutputDevice
      // This path is for when we have a separate AudioContext for CUE
      this.cueSumNode.connect(this.cueGain);
      this.cueGain.connect(this.context.destination);

      // MIX gain also connects to destination for blending
      this.mixGain.connect(this.context.destination);

      console.info("[CueBus] Dual output mode connected");
    }
  }

  /**
   * Get the mix input node for split cue mode
   * Connect the main mix output here for split cue (R channel)
   */
  get mixInput(): GainNode {
    return this.mixMono;
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
