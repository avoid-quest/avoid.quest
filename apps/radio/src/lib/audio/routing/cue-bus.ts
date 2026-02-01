/**
 * CUE Bus System - Simplified
 *
 * Provides pre-fader monitoring for DJ headphones.
 * Direct connection from preFaderSend to CUE output device.
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
 * Per-deck CUE connection
 */
type DeckCue = {
  enabled: boolean;
  preFaderNode: AudioNode | null; // Reference to the deck's preFaderSend
  gainNode: GainNode; // Controls CUE on/off (0 or 1)
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
 * Audio routing:
 * preFaderSend → gainNode (0/1) → MediaStreamDest → Audio element (with setSinkId)
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
    _cueContext: AudioContext | null, // Ignored, kept for API compat
    callbacks: CueBusCallbacks = {}
  ) {
    this.context = mainContext;
    this.callbacks = callbacks;
    console.info("[CueBus] Created (simplified version)");
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
   * Returns a dummy node for API compatibility
   */
  registerDeck(deckId: string): GainNode {
    const existing = this.deckCues.get(deckId);
    if (existing) {
      console.info(`[CueBus] Deck ${deckId} already registered`);
      return existing.gainNode;
    }

    // Create gain node for CUE on/off control
    const gainNode = this.context.createGain();
    gainNode.gain.value = 0; // CUE off by default

    this.deckCues.set(deckId, {
      enabled: false,
      preFaderNode: null,
      gainNode,
    });

    console.info(`[CueBus] Registered deck ${deckId}`);
    return gainNode;
  }

  /**
   * Connect a deck's preFaderSend to CUE
   * This is the key method - directly connects audio to CUE output
   */
  connectPreFader(deckId: string, preFaderNode: AudioNode): void {
    let cue = this.deckCues.get(deckId);
    if (!cue) {
      // Auto-register if not exists
      this.registerDeck(deckId);
      cue = this.deckCues.get(deckId);
      if (!cue) {
        console.error(`[CueBus] Failed to register deck ${deckId}`);
        return;
      }
    }

    // Disconnect previous if any
    if (cue.preFaderNode) {
      try {
        cue.preFaderNode.disconnect(cue.gainNode);
      } catch {
        // May already be disconnected
      }
    }

    // Connect: preFaderNode → gainNode
    preFaderNode.connect(cue.gainNode);
    cue.preFaderNode = preFaderNode;

    // If MediaStreamDest exists, ensure gainNode is connected
    if (this._mediaStreamDest) {
      try {
        cue.gainNode.connect(this._mediaStreamDest);
      } catch {
        // May already be connected
      }
    }

    console.info(
      `[CueBus] Connected ${deckId} preFader → gainNode → MediaStreamDest`
    );
  }

  /**
   * Unregister a deck
   */
  unregisterDeck(deckId: string): void {
    const cue = this.deckCues.get(deckId);
    if (cue) {
      safeDisconnect(cue.gainNode, "CueBus.unregisterDeck");
      this.deckCues.delete(deckId);
    }
  }

  /**
   * Enable/disable CUE for a deck
   */
  setCueEnabled(deckId: string, enabled: boolean): void {
    const cue = this.deckCues.get(deckId);
    if (!cue) {
      console.warn(`[CueBus] Deck ${deckId} not registered`);
      return;
    }

    cue.enabled = enabled;
    cue.gainNode.gain.value = enabled ? 1 : 0;

    console.info(
      `[CueBus] ${deckId} CUE ${enabled ? "ON" : "OFF"}, gain=${cue.gainNode.gain.value}`
    );

    this.callbacks.onDeckCueChange?.(deckId, enabled);
  }

  isCueEnabled(deckId: string): boolean {
    return this.deckCues.get(deckId)?.enabled ?? false;
  }

  /**
   * Set CUE/MIX blend (kept for API compat, not used in simplified version)
   */
  setCueMixBlend(blend: number): void {
    this._cueBlend = Math.max(0, Math.min(1, blend));
    this.callbacks.onCueBlendChange?.(this._cueBlend);
  }

  /**
   * Connect main mix (kept for API compat, not used in simplified version)
   */
  connectMainMix(_mainMixNode: AudioNode): void {
    // Not used in simplified version
  }

  /**
   * Set CUE output device
   * Creates MediaStreamDestination and routes all deck CUE gains to it
   */
  async setCueOutputDevice(deviceId: string | null): Promise<void> {
    console.info("[CueBus] setCueOutputDevice:", deviceId);

    // Cleanup existing
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

      // TEST: Create oscillator to verify MediaStream routing works
      const testOsc = this.context.createOscillator();
      const testGain = this.context.createGain();
      testOsc.frequency.value = 440; // A4 note
      testGain.gain.value = 0.1; // Quiet
      testOsc.connect(testGain);
      testGain.connect(this._mediaStreamDest);
      testOsc.start();
      console.info("[CueBus] TEST: Started 440Hz oscillator → MediaStreamDest");

      // Stop oscillator after 2 seconds
      setTimeout(() => {
        testOsc.stop();
        testOsc.disconnect();
        testGain.disconnect();
        console.info("[CueBus] TEST: Stopped oscillator");
      }, 2000);

      // Connect all deck gain nodes to MediaStreamDest
      for (const [deckId, cue] of this.deckCues) {
        cue.gainNode.connect(this._mediaStreamDest);
        console.info(
          `[CueBus] Connected ${deckId} gainNode to MediaStreamDest, gain=${cue.gainNode.gain.value}`
        );
      }

      // Create Audio element for playback
      this._audioElement = new Audio();
      this._audioElement.srcObject = this._mediaStreamDest.stream;
      this._audioElement.volume = 1;
      console.info("[CueBus] Audio element volume:", this._audioElement.volume);

      // Set output device
      console.info("[CueBus] Setting sinkId:", deviceId);
      await (
        this._audioElement as HTMLAudioElement & {
          setSinkId: (id: string) => Promise<void>;
        }
      ).setSinkId(deviceId);
      console.info("[CueBus] setSinkId success");

      // Start playback
      await this._audioElement.play();
      console.info(
        "[CueBus] Audio element playing, paused:",
        this._audioElement.paused,
        "muted:",
        this._audioElement.muted
      );

      // Log MediaStream info
      const tracks = this._mediaStreamDest.stream.getAudioTracks();
      console.info(
        `[CueBus] MediaStream tracks: ${tracks.length}, enabled:`,
        tracks.map((t) => t.enabled)
      );

      // Log AudioContext state
      console.info("[CueBus] AudioContext state:", this.context.state);

      this.callbacks.onModeChange?.("dual");
    } catch (error) {
      console.error("[CueBus] Failed to set CUE output:", error);
      this.cleanupCueOutput();
      this._mode = "split";
      this.callbacks.onError?.(
        error instanceof Error ? error : new Error("CUE output failed")
      );
    }
  }

  private cleanupCueOutput(): void {
    if (this._audioElement) {
      this._audioElement.pause();
      this._audioElement.srcObject = null;
      this._audioElement = null;
    }
    if (this._mediaStreamDest) {
      // Disconnect all deck gains from MediaStreamDest
      for (const [, cue] of this.deckCues) {
        try {
          cue.gainNode.disconnect(this._mediaStreamDest);
        } catch {
          // May not be connected
        }
      }
      this._mediaStreamDest = null;
    }
  }

  cleanup(): void {
    this.cleanupCueOutput();
    for (const deckId of this.deckCues.keys()) {
      this.unregisterDeck(deckId);
    }
  }

  // API compat getters
  get cueSumOutput(): GainNode {
    // Return first deck's gain node or create dummy
    const firstCue = this.deckCues.values().next().value;
    return firstCue?.gainNode ?? this.context.createGain();
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
