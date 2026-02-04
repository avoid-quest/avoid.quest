/**
 * CUE Bus System
 *
 * Provides headphone monitoring for DJ - pre-fader listening (PFL).
 *
 * Signal flow:
 * preFaderSends (from decks with CUE enabled) → cueSumNode → cueDelayNode → headphoneGainNode → MediaStreamDest → Headphones
 *
 * - CUE = post-effects, pre-fader audio from cued decks (unaffected by channel volume)
 * - Headphone volume controls the output level independently
 * - CUE delay allows timing adjustment relative to main output
 */

import { isSinkIdSupported, safeDisconnectFrom } from "../utils.js";

/**
 * Per-deck connection tracking
 */
type DeckConnection = {
  cueEnabled: boolean;
  preFaderNode: AudioNode | null;
};

export type CueMode = "dual" | "split";

export type CueBusState = {
  mode: CueMode;
  headphoneVolume: number;
  cueDelayMs: number;
  deckCueEnabled: Record<string, boolean>;
};

export type CueBusCallbacks = {
  onHeadphoneVolumeChange?: (volume: number) => void;
  onCueDelayChange?: (delayMs: number) => void;
  onDeckCueChange?: (deckId: string, enabled: boolean) => void;
  onModeChange?: (mode: CueMode) => void;
  onError?: (error: Error) => void;
};

/** Maximum CUE delay in milliseconds */
const MAX_CUE_DELAY_MS = 500;

/** Maximum CUE delay in seconds (for Web Audio API) */
const MAX_CUE_DELAY_SECONDS = MAX_CUE_DELAY_MS / 1000;

/**
 * CueBus - Pre-fader headphone monitoring
 *
 * Audio routing:
 * - Pre-fader from cued decks → cueSumNode → cueDelayNode → headphoneGainNode → MediaStreamDest → Audio element (setSinkId)
 */
export class CueBus {
  private readonly context: AudioContext;
  private readonly callbacks: CueBusCallbacks;

  // Per-deck connections
  private readonly deckConnections = new Map<string, DeckConnection>();

  // CUE output state
  private _mode: CueMode = "split";
  private _headphoneVolume = 1.0;
  private _cueDelayMs = 0;
  private _cueDeviceId: string | null = null;
  private _mediaStreamDest: MediaStreamAudioDestinationNode | null = null;
  private _audioElement: HTMLAudioElement | null = null;

  // Audio nodes
  private readonly _cueSumNode: GainNode; // Sum of pre-fader signals from cued decks
  private readonly _cueDelayNode: DelayNode; // CUE output delay
  private readonly _headphoneGainNode: GainNode; // Headphone volume control

  constructor(mainContext: AudioContext, callbacks: CueBusCallbacks = {}) {
    this.context = mainContext;
    this.callbacks = callbacks;

    // Create audio nodes
    this._cueSumNode = this.context.createGain();
    this._cueSumNode.gain.value = 1;

    this._cueDelayNode = this.context.createDelay(MAX_CUE_DELAY_SECONDS);
    this._cueDelayNode.delayTime.value = 0;

    this._headphoneGainNode = this.context.createGain();
    this._headphoneGainNode.gain.value = this._headphoneVolume;

    // Connect: cueSumNode → cueDelayNode → headphoneGainNode
    this._cueSumNode.connect(this._cueDelayNode);
    this._cueDelayNode.connect(this._headphoneGainNode);
  }

  get mode(): CueMode {
    return this._mode;
  }

  get headphoneVolume(): number {
    return this._headphoneVolume;
  }

  get cueDeviceId(): string | null {
    return this._cueDeviceId;
  }

  get cueDelayMs(): number {
    return this._cueDelayMs;
  }

  get state(): CueBusState {
    const deckCueEnabled: Record<string, boolean> = {};
    for (const [deckId, conn] of this.deckConnections) {
      deckCueEnabled[deckId] = conn.cueEnabled;
    }
    return {
      mode: this._mode,
      headphoneVolume: this._headphoneVolume,
      cueDelayMs: this._cueDelayMs,
      deckCueEnabled,
    };
  }

  /**
   * Register a deck for CUE monitoring
   */
  registerDeck(deckId: string): void {
    if (this.deckConnections.has(deckId)) {
      return;
    }
    this.deckConnections.set(deckId, {
      cueEnabled: false,
      preFaderNode: null,
    });
  }

  /**
   * Connect a deck's pre-fader node for CUE monitoring
   * Only routes to cueSumNode when CUE is enabled for this deck
   */
  connectPreFader(deckId: string, preFaderNode: AudioNode): void {
    let conn = this.deckConnections.get(deckId);
    if (!conn) {
      this.registerDeck(deckId);
      conn = this.deckConnections.get(deckId);
      if (!conn) {
        return;
      }
    }

    // Disconnect old preFaderNode (defensive: always try disconnect)
    if (conn.preFaderNode) {
      safeDisconnectFrom(
        conn.preFaderNode,
        this._cueSumNode,
        "CueBus.connectPreFader"
      );
    }

    // Store new preFaderNode
    conn.preFaderNode = preFaderNode;

    // If CUE is enabled, connect to cueSumNode
    if (conn.cueEnabled) {
      preFaderNode.connect(this._cueSumNode);
    }
  }

  /**
   * Unregister a deck
   */
  unregisterDeck(deckId: string): void {
    const conn = this.deckConnections.get(deckId);
    if (conn?.preFaderNode && conn.cueEnabled) {
      safeDisconnectFrom(
        conn.preFaderNode,
        this._cueSumNode,
        "CueBus.unregisterDeck"
      );
    }
    this.deckConnections.delete(deckId);
  }

  /**
   * Enable/disable CUE for a deck
   * Controls connect/disconnect of pre-fader to cueSumNode
   */
  setCueEnabled(deckId: string, enabled: boolean): void {
    const conn = this.deckConnections.get(deckId);
    if (!conn) {
      return;
    }

    const wasEnabled = conn.cueEnabled;
    conn.cueEnabled = enabled;

    // Only act if state changed and we have a preFaderNode
    if (wasEnabled !== enabled && conn.preFaderNode) {
      if (enabled) {
        conn.preFaderNode.connect(this._cueSumNode);
      } else {
        safeDisconnectFrom(
          conn.preFaderNode,
          this._cueSumNode,
          "CueBus.setCueEnabled"
        );
      }
    }

    this.callbacks.onDeckCueChange?.(deckId, enabled);
  }

  isCueEnabled(deckId: string): boolean {
    return this.deckConnections.get(deckId)?.cueEnabled ?? false;
  }

  /**
   * Set headphone volume (0-1)
   */
  setHeadphoneVolume(volume: number): void {
    this._headphoneVolume = Math.max(0, Math.min(1, volume));

    const now = this.context.currentTime;
    this._headphoneGainNode.gain.setTargetAtTime(
      this._headphoneVolume,
      now,
      0.02
    );

    this.callbacks.onHeadphoneVolumeChange?.(this._headphoneVolume);
  }

  /**
   * Set CUE output delay (0-500ms)
   * Allows timing adjustment relative to main output
   */
  setCueDelay(ms: number): void {
    this._cueDelayMs = Math.max(0, Math.min(MAX_CUE_DELAY_MS, ms));

    const now = this.context.currentTime;
    const seconds = this._cueDelayMs / 1000;

    // Smooth transition to avoid clicks
    this._cueDelayNode.delayTime.setTargetAtTime(seconds, now, 0.02);

    this.callbacks.onCueDelayChange?.(this._cueDelayMs);
  }

  /**
   * Set CUE output device
   */
  async setCueOutputDevice(deviceId: string | null): Promise<void> {
    this.cleanupCueOutput();

    if (!(deviceId && isSinkIdSupported())) {
      this._cueDeviceId = null;
      this._mode = "split";
      this.callbacks.onModeChange?.("split");
      return;
    }

    this._cueDeviceId = deviceId;
    this._mode = "dual";

    try {
      // Create MediaStreamDestination
      this._mediaStreamDest = this.context.createMediaStreamDestination();

      // Connect headphoneGainNode to MediaStreamDest
      this._headphoneGainNode.connect(this._mediaStreamDest);

      // Create Audio element
      this._audioElement = new Audio();
      this._audioElement.srcObject = this._mediaStreamDest.stream;
      this._audioElement.volume = 1;

      // Set output device
      await this._audioElement.setSinkId(deviceId);

      // Start playback
      await this._audioElement.play();

      this.callbacks.onModeChange?.("dual");
    } catch (error) {
      this.cleanupCueOutput();
      this._mode = "split";
      this.callbacks.onModeChange?.("split");
      this.callbacks.onError?.(
        error instanceof Error
          ? error
          : new Error(`CUE output failed: ${String(error)}`)
      );
    }
  }

  private cleanupCueOutput(): void {
    if (this._mediaStreamDest) {
      safeDisconnectFrom(
        this._headphoneGainNode,
        this._mediaStreamDest,
        "CueBus.cleanupCueOutput"
      );
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

    for (const [, conn] of this.deckConnections) {
      if (conn.preFaderNode && conn.cueEnabled) {
        safeDisconnectFrom(
          conn.preFaderNode,
          this._cueSumNode,
          "CueBus.cleanup"
        );
      }
    }
    this.deckConnections.clear();
  }

  // API compatibility
  get cueSumOutput(): GainNode {
    return this._cueSumNode;
  }

  get destination(): AudioNode {
    return this.context.destination;
  }
}

/**
 * Create a CueBus instance
 */
export function createCueBus(
  mainContext: AudioContext,
  callbacks: CueBusCallbacks = {}
): CueBus {
  return new CueBus(mainContext, callbacks);
}
