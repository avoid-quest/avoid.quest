/**
 * Device Audio Source
 *
 * Captures audio from a specific audio input device (sound card, audio interface).
 * Extends the MicSource pattern with device selection capability.
 * Supports enumerating both input and output devices.
 */

import { safeDisconnect } from "../manager/audio-manager.js";

/**
 * Audio device information
 */
export type AudioDeviceInfo = {
  deviceId: string;
  label: string;
  kind: "audioinput" | "audiooutput";
  groupId: string;
};

/**
 * Device permission state
 */
export type DevicePermissionState = "prompt" | "granted" | "denied" | "error";

/**
 * Callbacks for DeviceSource
 */
export type DeviceSourceCallbacks = {
  onPermissionChange?: (state: DevicePermissionState) => void;
  onActive?: () => void;
  onInactive?: () => void;
  onError?: (error: Error) => void;
  onDeviceChange?: () => void;
};

/**
 * Audio constraints for device capture
 */
export type DeviceAudioConstraints = {
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  sampleRate?: number;
  channelCount?: number;
};

/**
 * Default constraints optimized for DJ/audio production (no processing)
 */
const DEFAULT_CONSTRAINTS: DeviceAudioConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  sampleRate: 48_000,
  channelCount: 2,
};

/**
 * DeviceSource
 *
 * Captures audio from a specific audio input device and provides it as a Web Audio node.
 * Supports selecting specific devices and handles permission requests.
 */
export class DeviceSource {
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private readonly context: AudioContext;
  private readonly callbacks: DeviceSourceCallbacks;
  private readonly sourceId: string;

  private _isActive = false;
  private _permissionState: DevicePermissionState = "prompt";
  private _currentDeviceId: string | null = null;
  private deviceChangeHandler: (() => void) | null = null;

  constructor(
    context: AudioContext,
    sourceId: string,
    callbacks: DeviceSourceCallbacks = {}
  ) {
    this.context = context;
    this.sourceId = sourceId;
    this.callbacks = callbacks;
    this.setupDeviceChangeListener();
  }

  /**
   * Set up listener for device changes (plug/unplug)
   */
  private setupDeviceChangeListener(): void {
    if (typeof navigator !== "undefined" && navigator.mediaDevices) {
      this.deviceChangeHandler = (): void => {
        this.callbacks.onDeviceChange?.();
      };
      navigator.mediaDevices.addEventListener(
        "devicechange",
        this.deviceChangeHandler
      );
    }
  }

  /**
   * Get source ID
   */
  get id(): string {
    return this.sourceId;
  }

  /**
   * Check if device capture is active
   */
  get isActive(): boolean {
    return this._isActive;
  }

  /**
   * Get current permission state
   */
  get permissionState(): DevicePermissionState {
    return this._permissionState;
  }

  /**
   * Get currently selected device ID
   */
  get currentDeviceId(): string | null {
    return this._currentDeviceId;
  }

  /**
   * Get audio output node for connecting to Web Audio graph
   */
  get output(): AudioNode | null {
    return this.source;
  }

  /**
   * Enumerate available audio devices
   * Requires permission to be granted to see device labels
   */
  static async getDevices(): Promise<AudioDeviceInfo[]> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      return [];
    }

    const devices = await navigator.mediaDevices.enumerateDevices();

    return devices
      .filter((d) => d.kind === "audioinput" || d.kind === "audiooutput")
      .map((d) => ({
        deviceId: d.deviceId,
        label:
          d.label ||
          `${d.kind === "audioinput" ? "Input" : "Output"} ${d.deviceId.slice(0, 8)}`,
        kind: d.kind as "audioinput" | "audiooutput",
        groupId: d.groupId,
      }));
  }

  /**
   * Get only input devices
   */
  static async getInputDevices(): Promise<AudioDeviceInfo[]> {
    const devices = await DeviceSource.getDevices();
    return devices.filter((d) => d.kind === "audioinput");
  }

  /**
   * Get only output devices
   */
  static async getOutputDevices(): Promise<AudioDeviceInfo[]> {
    const devices = await DeviceSource.getDevices();
    return devices.filter((d) => d.kind === "audiooutput");
  }

  /**
   * Request permission to access audio devices
   * This triggers the browser permission prompt
   */
  static async requestPermission(): Promise<DevicePermissionState> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Immediately stop tracks - we just needed to trigger permission
      for (const track of stream.getTracks()) {
        track.stop();
      }
      return "granted";
    } catch (error) {
      if (
        error instanceof DOMException &&
        (error.name === "NotAllowedError" ||
          error.name === "PermissionDeniedError")
      ) {
        return "denied";
      }
      return "error";
    }
  }

  /**
   * Check audio device permission without requesting
   */
  async checkPermission(): Promise<DevicePermissionState> {
    try {
      if (typeof navigator !== "undefined" && navigator.permissions) {
        const result = await navigator.permissions.query({
          name: "microphone" as PermissionName,
        });
        this._permissionState = result.state as DevicePermissionState;
        return this._permissionState;
      }
      return "prompt";
    } catch {
      // Some browsers don't support microphone permission query
      return "prompt";
    }
  }

  /**
   * Start capturing from a specific audio input device
   * @param deviceId - Optional device ID. If not provided, uses system default.
   * @param constraints - Optional audio constraints
   */
  async start(
    deviceId?: string,
    constraints: DeviceAudioConstraints = {}
  ): Promise<void> {
    if (this._isActive) {
      // If already active with same device, do nothing
      if (deviceId === this._currentDeviceId) {
        return;
      }
      // Otherwise stop current and restart with new device
      this.stop();
    }

    const mergedConstraints = { ...DEFAULT_CONSTRAINTS, ...constraints };

    try {
      // Use 'ideal' instead of 'exact' for device selection
      // 'exact' throws NotFoundError if device is disconnected between enumeration and selection
      // 'ideal' falls back to default device gracefully
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { ideal: deviceId } : undefined,
          echoCancellation: mergedConstraints.echoCancellation,
          noiseSuppression: mergedConstraints.noiseSuppression,
          autoGainControl: mergedConstraints.autoGainControl,
          sampleRate: mergedConstraints.sampleRate,
          channelCount: mergedConstraints.channelCount,
        },
      });

      this._permissionState = "granted";
      this.callbacks.onPermissionChange?.("granted");

      // Get actual device ID from track settings
      const audioTrack = this.stream.getAudioTracks()[0];
      const settings = audioTrack?.getSettings();
      this._currentDeviceId = settings?.deviceId ?? deviceId ?? null;

      // Create Web Audio source from stream
      this.source = this.context.createMediaStreamSource(this.stream);
      this._isActive = true;
      this.callbacks.onActive?.();
    } catch (error) {
      this.handleStartError(error);
      throw error;
    }
  }

  /**
   * Handle errors during start
   */
  private handleStartError(error: unknown): void {
    if (
      error instanceof DOMException &&
      (error.name === "NotAllowedError" ||
        error.name === "PermissionDeniedError")
    ) {
      this._permissionState = "denied";
      this.callbacks.onPermissionChange?.("denied");
    } else if (
      error instanceof DOMException &&
      error.name === "NotFoundError"
    ) {
      // Device not found
      this._permissionState = "error";
      this.callbacks.onPermissionChange?.("error");
      this.callbacks.onError?.(new Error("Audio device not found"));
    } else {
      this._permissionState = "error";
      this.callbacks.onPermissionChange?.("error");
      this.callbacks.onError?.(
        error instanceof Error
          ? error
          : new Error("Failed to access audio device")
      );
    }
  }

  /**
   * Switch to a different input device
   */
  async switchDevice(
    deviceId: string,
    constraints?: DeviceAudioConstraints
  ): Promise<void> {
    await this.start(deviceId, constraints);
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
    safeDisconnect(this.source, "DeviceSource.stop");
    this.source = null;

    this._isActive = false;
    this._currentDeviceId = null;
    this.callbacks.onInactive?.();
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    this.stop();

    // Remove device change listener
    if (this.deviceChangeHandler && navigator.mediaDevices) {
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        this.deviceChangeHandler
      );
      this.deviceChangeHandler = null;
    }
  }
}

/**
 * Create a device source
 */
export function createDeviceSource(
  context: AudioContext,
  sourceId: string,
  callbacks: DeviceSourceCallbacks = {}
): DeviceSource {
  return new DeviceSource(context, sourceId, callbacks);
}
