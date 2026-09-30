/**
 * Device Audio Source
 *
 * Captures audio from a specific audio input device (sound card, audio interface).
 * Extends the MicSource pattern with device selection capability.
 * Supports enumerating both input and output devices.
 */

import { safeDisconnect } from "../utils.js";

/**
 * Channel selection for routing device input channels to stereo output.
 * Uses 0-based channel indices. Setting left === right produces mono.
 */
export type ChannelSelection = {
  left: number; // 0-based channel index for left output
  right: number; // 0-based channel index for right output (same as left = mono)
};

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
  latency?: number;
  sampleRate?: number;
  channelCount?: number;
};

type DeviceTrackConstraints = MediaTrackConstraints & {
  latency?: ConstrainDouble;
};

type DeviceSupportedConstraints = MediaTrackSupportedConstraints & {
  latency?: boolean;
};

type DeviceTrackCapabilities = MediaTrackCapabilities & {
  latency?: { max: number; min: number };
};

type DeviceTrackSettings = MediaTrackSettings & {
  latency?: number;
};

export type DeviceSourceDiagnostics = {
  actual: MediaTrackSettings & { latency?: number };
  capabilities: DeviceTrackCapabilities | null;
  label: string;
  latencyConstraintSupported: boolean;
  muted: boolean;
  readyState: MediaStreamTrackState;
  requested: DeviceTrackConstraints;
};

/**
 * Default constraints optimized for DJ/audio production (no processing)
 */
const DEFAULT_CONSTRAINTS: DeviceAudioConstraints = {
  autoGainControl: false,
  echoCancellation: false,
  noiseSuppression: false,
};

type CaptureState = {
  audioTrack: MediaStreamTrack | undefined;
  capabilities: DeviceTrackCapabilities | null;
  settings: DeviceTrackSettings | undefined;
};

function getCaptureState(stream: MediaStream): CaptureState {
  const [audioTrack] = stream.getAudioTracks();
  return {
    audioTrack,
    capabilities:
      (audioTrack?.getCapabilities?.() as DeviceTrackCapabilities) ?? null,
    settings: audioTrack?.getSettings() as DeviceTrackSettings | undefined,
  };
}

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

  private _isActive = false as boolean;
  private _permissionState: DevicePermissionState = "prompt";
  private _currentDeviceId: string | null = null;
  private deviceChangeHandler: (() => void) | null = null;
  private startRevision = 0;

  // Channel routing
  private _channelSelection: ChannelSelection = { left: 0, right: 1 };
  private _channelCount = 2;
  private diagnostics: DeviceSourceDiagnostics | null = null;
  private diagnosticsTrack: MediaStreamTrack | null = null;
  private splitter: ChannelSplitterNode | null = null;
  private merger: ChannelMergerNode | null = null;
  private routingOutput: GainNode | null = null;

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

  getDiagnostics(): DeviceSourceDiagnostics | null {
    if (!(this.diagnostics && this.diagnosticsTrack)) {
      return null;
    }
    return {
      ...this.diagnostics,
      actual: { ...this.diagnostics.actual },
      muted: this.diagnosticsTrack.muted,
      readyState: this.diagnosticsTrack.readyState,
      requested: { ...this.diagnostics.requested },
    };
  }

  /**
   * Get audio output node for connecting to Web Audio graph
   */
  get output(): AudioNode | null {
    return this.routingOutput ?? this.source;
  }

  /**
   * Get actual channel count reported by the device
   */
  get channelCount(): number {
    return this._channelCount;
  }

  get outputChannelCount(): 1 | 2 {
    return this._channelCount === 1 ||
      this._channelSelection.left === this._channelSelection.right
      ? 1
      : 2;
  }

  /**
   * Get current channel selection
   */
  get currentChannelSelection(): ChannelSelection {
    return this._channelSelection;
  }

  /**
   * Set channel selection (which device channels route to stereo L/R output)
   */
  setChannelSelection(selection: ChannelSelection): void {
    if (
      selection.left === this._channelSelection.left &&
      selection.right === this._channelSelection.right
    ) {
      return;
    }
    this._channelSelection = selection;
    if (this._isActive && this.source) {
      this.applyChannelRouting();
    }
  }

  /**
   * Apply current channel routing by wiring splitter/merger nodes.
   * Routes selected device channels to stereo (2-channel) output.
   */
  private applyChannelRouting(): void {
    if (!this.source) {
      return;
    }

    // Disconnect existing routing
    safeDisconnect(this.source, "DeviceSource.applyChannelRouting");
    safeDisconnect(this.splitter, "DeviceSource.applyChannelRouting");
    safeDisconnect(this.merger, "DeviceSource.applyChannelRouting");
    this.splitter = null;
    this.merger = null;

    // Ensure routing output exists
    if (!this.routingOutput) {
      this.routingOutput = this.context.createGain();
      this.routingOutput.gain.value = 1;
    }

    const { left, right } = this._channelSelection;
    const count = this._channelCount;
    this.routingOutput.channelCount = this.outputChannelCount;
    this.routingOutput.channelCountMode = "explicit";

    // Keep a microphone mono until the post-effects panner. openDAW then
    // spends one monitoring channel and duplicates its mono return to stereo.
    if (this.outputChannelCount === 1) {
      if (count === 1) {
        this.source.connect(this.routingOutput);
        return;
      }
      this.splitter = this.context.createChannelSplitter(count);
      this.source.connect(this.splitter);
      const channel = Math.max(0, Math.min(left, count - 1));
      this.splitter.connect(this.routingOutput, channel, 0);
      return;
    }

    // If default stereo passthrough (ch0 → L, ch1 → R) on a 2-channel device, skip splitter/merger
    if (left === 0 && right === 1 && count === 2) {
      this.source.connect(this.routingOutput);
      return;
    }

    // Recreate splitter/merger for the actual channel count
    this.splitter = this.context.createChannelSplitter(count);
    this.merger = this.context.createChannelMerger(2);

    this.source.connect(this.splitter);

    // Clamp indices to available channels
    const safeLeft = Math.max(0, Math.min(left, count - 1));
    const safeRight = Math.max(0, Math.min(right, count - 1));

    // Route selected channels to stereo output
    this.splitter.connect(this.merger, safeLeft, 0); // → left output
    this.splitter.connect(this.merger, safeRight, 1); // → right output

    this.merger.connect(this.routingOutput);
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
      .filter(
        (d): d is MediaDeviceInfo & { kind: "audioinput" | "audiooutput" } =>
          d.kind === "audioinput" || d.kind === "audiooutput"
      )
      .map((d) => ({
        deviceId: d.deviceId,
        groupId: d.groupId,
        kind: d.kind,
        label:
          d.label ||
          `${d.kind === "audioinput" ? "Input" : "Output"} ${d.deviceId.slice(0, 8)}`,
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
          name: "microphone",
        });
        const { state } = result;
        if (state === "granted" || state === "denied" || state === "prompt") {
          this._permissionState = state;
          return state;
        }
        return "prompt";
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
    if (this._isActive && deviceId === this._currentDeviceId) {
      return;
    }
    // Release the previous capture, including an acquisition still pending.
    this.stop();
    this.startRevision += 1;
    const revision = this.startRevision;

    const mergedConstraints = { ...DEFAULT_CONSTRAINTS, ...constraints };
    const supportsLatency = Boolean(
      (
        navigator.mediaDevices.getSupportedConstraints?.() as
          | DeviceSupportedConstraints
          | undefined
      )?.latency
    );
    const initialRequest: DeviceTrackConstraints = {
      autoGainControl: mergedConstraints.autoGainControl,
      channelCount: mergedConstraints.channelCount ?? { ideal: 2 },
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: mergedConstraints.echoCancellation,
      ...(supportsLatency
        ? { latency: { ideal: mergedConstraints.latency ?? 0 } }
        : {}),
      noiseSuppression: mergedConstraints.noiseSuppression,
      ...(mergedConstraints.sampleRate === undefined
        ? {}
        : { sampleRate: mergedConstraints.sampleRate }),
    };
    this.diagnostics = null;
    this.diagnosticsTrack = null;

    try {
      // Use 'exact' for device selection to ensure the correct device is captured
      // If the device is unavailable, NotFoundError is thrown and handled by handleStartError
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: initialRequest,
      });
      if (revision !== this.startRevision) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
        return;
      }
      const { audioTrack, capabilities, settings } = getCaptureState(stream);
      this.stream = stream;

      this._permissionState = "granted";
      this.callbacks.onPermissionChange?.("granted");
      if (revision !== this.startRevision) {
        return;
      }

      // Get actual device ID and channel count from track settings.
      // Match openDAW's capture policy: request at most stereo and use the
      // browser-reported shape for routing.
      this._currentDeviceId = settings?.deviceId ?? deviceId ?? null;
      this._channelCount = settings?.channelCount ?? 2;
      if (audioTrack && settings) {
        this.diagnosticsTrack = audioTrack;
        this.diagnostics = {
          actual: settings,
          capabilities,
          label: audioTrack.label,
          latencyConstraintSupported: supportsLatency,
          muted: audioTrack.muted,
          readyState: audioTrack.readyState,
          requested: initialRequest,
        };
      }

      // Create Web Audio source from stream
      this.source = this.context.createMediaStreamSource(this.stream);

      // Initialize channel routing
      this.routingOutput = this.context.createGain();
      this.routingOutput.gain.value = 1;
      this.applyChannelRouting();

      this._isActive = true;
      this.callbacks.onActive?.();
    } catch (error) {
      if (revision !== this.startRevision) {
        return;
      }
      this.stop();
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
    this.startRevision += 1;
    this.diagnostics = null;
    this.diagnosticsTrack = null;
    const wasActive = this._isActive;

    // Stop all tracks in the stream
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }

    // Disconnect Web Audio nodes
    safeDisconnect(this.source, "DeviceSource.stop");
    safeDisconnect(this.splitter, "DeviceSource.stop");
    safeDisconnect(this.merger, "DeviceSource.stop");
    safeDisconnect(this.routingOutput, "DeviceSource.stop");
    this.source = null;
    this.splitter = null;
    this.merger = null;
    this.routingOutput = null;

    this._isActive = false;
    this._currentDeviceId = null;
    if (wasActive) {
      this.callbacks.onInactive?.();
    }
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
