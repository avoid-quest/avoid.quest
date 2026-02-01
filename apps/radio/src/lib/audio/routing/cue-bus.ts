/**
 * CUE Bus System - Simplified
 *
 * Provides pre-fader monitoring for DJ headphones.
 * Direct connection from preFaderSend to CUE output device.
 */

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
 * Per-deck CUE connection
 */
type DeckCue = {
  enabled: boolean;
  preFaderNode: AudioNode | null;
};

export type CueMode = "dual" | "split";

export type CueBusState = {
  mode: CueMode;
  cueBlend: number;
  deckCueEnabled: Record<string, boolean>;
};

export type CueBusCallbacks = {
  onCueBlendChange?: (blend: number) => void;
  onDeckCueChange?: (deckId: string, enabled: boolean) => void;
  onModeChange?: (mode: CueMode) => void;
  onError?: (error: Error) => void;
};

/**
 * Simplified CueBus
 *
 * Audio routing (when CUE enabled):
 * preFaderSend → MediaStreamDest → Audio element (with setSinkId)
 *
 * CUE is controlled by connect/disconnect, not gain.
 */
export class CueBus {
  private readonly context: AudioContext;
  private readonly callbacks: CueBusCallbacks;

  // Per-deck CUE
  private readonly deckCues = new Map<string, DeckCue>();

  // CUE output
  private _mode: CueMode = "split";
  private _cueBlend = 0.5;
  private _cueDeviceId: string | null = null;
  private _mediaStreamDest: MediaStreamAudioDestinationNode | null = null;
  private _audioElement: HTMLAudioElement | null = null;

  constructor(
    mainContext: AudioContext,
    _cueContext: AudioContext | null,
    callbacks: CueBusCallbacks = {}
  ) {
    this.context = mainContext;
    this.callbacks = callbacks;
    console.info("[CueBus] Created");
  }

  get mode(): CueMode {
    return this._mode;
  }

  get cueBlend(): number {
    return this._cueBlend;
  }

  get state(): CueBusState {
    const deckCueEnabled: Record<string, boolean> = {};
    for (const [deckId, cue] of this.deckCues) {
      deckCueEnabled[deckId] = cue.enabled;
    }
    return {
      mode: this._mode,
      cueBlend: this._cueBlend,
      deckCueEnabled,
    };
  }

  get cueDeviceId(): string | null {
    return this._cueDeviceId;
  }

  /**
   * Register a deck for CUE monitoring
   */
  registerDeck(deckId: string): GainNode {
    const existing = this.deckCues.get(deckId);
    if (existing) {
      return this.context.createGain(); // Dummy for API compat
    }

    this.deckCues.set(deckId, {
      enabled: false,
      preFaderNode: null,
    });

    console.info(`[CueBus] Registered ${deckId}`);
    return this.context.createGain(); // Dummy for API compat
  }

  /**
   * Connect a deck's preFaderSend
   */
  connectPreFader(deckId: string, preFaderNode: AudioNode): void {
    let cue = this.deckCues.get(deckId);
    if (!cue) {
      this.registerDeck(deckId);
      cue = this.deckCues.get(deckId);
      if (!cue) {
        return;
      }
    }

    // Disconnect old preFaderNode if any
    if (cue.preFaderNode && this._mediaStreamDest && cue.enabled) {
      try {
        cue.preFaderNode.disconnect(this._mediaStreamDest);
      } catch {
        // May not be connected
      }
    }

    // Store new preFaderNode
    cue.preFaderNode = preFaderNode;

    // If CUE is enabled and MediaStreamDest exists, connect
    if (cue.enabled && this._mediaStreamDest) {
      preFaderNode.connect(this._mediaStreamDest);
      console.info(`[CueBus] ${deckId}: preFader → MediaStreamDest (CUE ON)`);
    } else {
      console.info(
        `[CueBus] ${deckId}: preFader stored (CUE ${cue.enabled ? "ON" : "OFF"}, device ${this._mediaStreamDest ? "ready" : "not ready"})`
      );
    }
  }

  /**
   * Unregister a deck
   */
  unregisterDeck(deckId: string): void {
    const cue = this.deckCues.get(deckId);
    if (cue?.preFaderNode && this._mediaStreamDest) {
      try {
        cue.preFaderNode.disconnect(this._mediaStreamDest);
      } catch {
        // May not be connected
      }
    }
    this.deckCues.delete(deckId);
  }

  /**
   * Enable/disable CUE for a deck
   * Controls connect/disconnect to MediaStreamDest
   */
  setCueEnabled(deckId: string, enabled: boolean): void {
    const cue = this.deckCues.get(deckId);
    if (!cue) {
      console.warn(`[CueBus] ${deckId} not registered`);
      return;
    }

    const wasEnabled = cue.enabled;
    cue.enabled = enabled;

    // Only act if state changed and we have MediaStreamDest
    if (wasEnabled !== enabled && this._mediaStreamDest && cue.preFaderNode) {
      if (enabled) {
        cue.preFaderNode.connect(this._mediaStreamDest);
        console.info(
          `[CueBus] ${deckId}: CUE ON → connected to MediaStreamDest`
        );
      } else {
        try {
          cue.preFaderNode.disconnect(this._mediaStreamDest);
          console.info(`[CueBus] ${deckId}: CUE OFF → disconnected`);
        } catch {
          // May already be disconnected
        }
      }
    } else {
      console.info(
        `[CueBus] ${deckId}: CUE ${enabled ? "ON" : "OFF"} (no action: device=${!!this._mediaStreamDest}, preFader=${!!cue.preFaderNode})`
      );
    }

    this.callbacks.onDeckCueChange?.(deckId, enabled);
  }

  isCueEnabled(deckId: string): boolean {
    return this.deckCues.get(deckId)?.enabled ?? false;
  }

  /**
   * Set CUE/MIX blend (API compat)
   */
  setCueMixBlend(blend: number): void {
    this._cueBlend = Math.max(0, Math.min(1, blend));
    this.callbacks.onCueBlendChange?.(this._cueBlend);
  }

  /**
   * Connect main mix (API compat - not used in simplified version)
   */
  connectMainMix(_mainMixNode: AudioNode): void {
    // Not used in simplified version - kept for API compatibility
  }

  /**
   * Set CUE output device
   */
  async setCueOutputDevice(deviceId: string | null): Promise<void> {
    console.info("[CueBus] setCueOutputDevice:", deviceId);

    this.cleanupCueOutput();

    if (!(deviceId && isSinkIdSupported())) {
      console.info("[CueBus] No device or setSinkId not supported");
      this._cueDeviceId = null;
      this._mode = "split";
      return;
    }

    this._cueDeviceId = deviceId;
    this._mode = "dual";

    try {
      // Create MediaStreamDestination
      this._mediaStreamDest = this.context.createMediaStreamDestination();
      console.info("[CueBus] Created MediaStreamDestination");

      // Connect all decks that have CUE enabled
      for (const [deckId, cue] of this.deckCues) {
        if (cue.enabled && cue.preFaderNode) {
          cue.preFaderNode.connect(this._mediaStreamDest);
          console.info(`[CueBus] ${deckId}: connected (CUE was ON)`);
        }
      }

      // Create Audio element
      this._audioElement = new Audio();
      this._audioElement.srcObject = this._mediaStreamDest.stream;
      this._audioElement.volume = 1;

      // Set output device
      await (
        this._audioElement as HTMLAudioElement & {
          setSinkId: (id: string) => Promise<void>;
        }
      ).setSinkId(deviceId);
      console.info("[CueBus] setSinkId success");

      // Start playback
      await this._audioElement.play();
      console.info("[CueBus] Audio element playing");

      this.callbacks.onModeChange?.("dual");
    } catch (error) {
      console.error("[CueBus] Failed:", error);
      this.cleanupCueOutput();
      this._mode = "split";
      this.callbacks.onError?.(
        error instanceof Error ? error : new Error("CUE output failed")
      );
    }
  }

  private cleanupCueOutput(): void {
    // Disconnect all preFaderNodes from MediaStreamDest
    if (this._mediaStreamDest) {
      for (const [, cue] of this.deckCues) {
        if (cue.preFaderNode) {
          try {
            cue.preFaderNode.disconnect(this._mediaStreamDest);
          } catch {
            // May not be connected
          }
        }
      }
    }

    if (this._audioElement) {
      this._audioElement.pause();
      this._audioElement.srcObject = null;
      this._audioElement = null;
    }
    this._mediaStreamDest = null;
  }

  cleanup(): void {
    this.cleanupCueOutput();
    this.deckCues.clear();
  }

  // API compat
  get cueSumOutput(): GainNode {
    return this.context.createGain();
  }

  get destination(): AudioNode {
    return this.context.destination;
  }

  get mixInput(): GainNode {
    return this.context.createGain();
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
