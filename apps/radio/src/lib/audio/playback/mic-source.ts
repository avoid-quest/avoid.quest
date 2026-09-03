/**
 * Microphone Audio Source
 *
 * Wraps getUserMedia for microphone input capability.
 * Designed for future live looper functionality.
 * No CORS needed - microphone input is always same-origin.
 */

/**
 * Microphone permission state
 */
export type MicPermissionState = "prompt" | "granted" | "denied" | "error";

/**
 * Callbacks for MicSource
 */
export type MicSourceCallbacks = {
  onPermissionChange?: (state: MicPermissionState) => void;
  onActive?: () => void;
  onInactive?: () => void;
  onError?: (error: Error) => void;
};

/**
 * MicSource
 *
 * Captures audio from the user's microphone and provides it as a Web Audio node.
 * Handles permission requests and stream lifecycle.
 */
export class MicSource {
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private readonly context: AudioContext;
  private readonly callbacks: MicSourceCallbacks;
  private readonly sourceId: string;

  private _isActive = false;
  private _permissionState: MicPermissionState = "prompt";

  constructor(
    context: AudioContext,
    sourceId: string,
    callbacks: MicSourceCallbacks = {}
  ) {
    this.context = context;
    this.sourceId = sourceId;
    this.callbacks = callbacks;
  }

  /**
   * Get source ID
   */
  get id(): string {
    return this.sourceId;
  }

  /**
   * Check if microphone is active
   */
  get isActive(): boolean {
    return this._isActive;
  }

  /**
   * Get current permission state
   */
  get permissionState(): MicPermissionState {
    return this._permissionState;
  }

  /**
   * Get audio output node for connecting to Web Audio graph
   */
  get output(): AudioNode | null {
    return this.source;
  }

  /**
   * Check microphone permission without requesting
   * Returns current permission state from browser API
   */
  async checkPermission(): Promise<MicPermissionState> {
    try {
      // Query permission state if API available
      if (navigator.permissions) {
        const result = await navigator.permissions.query({
          name: "microphone" as PermissionName,
        });
        this._permissionState = result.state as MicPermissionState;
        return this._permissionState;
      }
      // If permissions API not available, state is unknown (prompt)
      return "prompt";
    } catch {
      // Some browsers don't support microphone permission query
      return "prompt";
    }
  }

  /**
   * Start capturing from microphone
   * Requests permission if not already granted
   */
  async start(): Promise<void> {
    if (this._isActive) {
      return;
    }

    try {
      // Request microphone access
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      this._permissionState = "granted";
      this.callbacks.onPermissionChange?.("granted");

      // Create Web Audio source from stream
      this.source = this.context.createMediaStreamSource(this.stream);
      this._isActive = true;
      this.callbacks.onActive?.();
    } catch (error) {
      // Handle permission denied
      if (
        error instanceof DOMException &&
        (error.name === "NotAllowedError" ||
          error.name === "PermissionDeniedError")
      ) {
        this._permissionState = "denied";
        this.callbacks.onPermissionChange?.("denied");
        throw new Error("Microphone permission denied");
      }

      // Handle other errors (no device, etc)
      this._permissionState = "error";
      this.callbacks.onPermissionChange?.("error");
      this.callbacks.onError?.(
        error instanceof Error
          ? error
          : new Error("Failed to access microphone")
      );
      throw error;
    }
  }

  /**
   * Stop capturing and release resources
   */
  stop(): void {
    if (!this._isActive) {
      return;
    }

    // Stop all tracks in the stream
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }

    // Disconnect Web Audio node
    this.source?.disconnect();
    this.source = null;

    this._isActive = false;
    this.callbacks.onInactive?.();
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    this.stop();
  }
}

/**
 * Create a microphone source
 */
export function createMicSource(
  context: AudioContext,
  sourceId: string,
  callbacks: MicSourceCallbacks = {}
): MicSource {
  return new MicSource(context, sourceId, callbacks);
}
