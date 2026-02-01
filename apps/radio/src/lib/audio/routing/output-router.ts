/**
 * Output Router
 *
 * Manages audio output device selection for main and CUE (headphone) outputs.
 * Uses setSinkId for routing to specific output devices.
 * Handles browser compatibility (setSinkId not available in Firefox/Safari).
 */

import {
  type AudioDeviceInfo,
  DeviceSource,
} from "../playback/device-source.js";

/**
 * Check if setSinkId is supported in the current browser
 */
export function isSinkIdSupported(): boolean {
  if (typeof AudioContext === "undefined") {
    return false;
  }
  return "setSinkId" in AudioContext.prototype;
}

/**
 * Output routing state
 */
export type OutputRouterState = {
  mainDeviceId: string;
  cueDeviceId: string | null;
  isSupported: boolean;
};

/**
 * Callbacks for OutputRouter
 */
export type OutputRouterCallbacks = {
  onMainOutputChange?: (deviceId: string) => void;
  onCueOutputChange?: (deviceId: string | null) => void;
  onError?: (error: Error) => void;
  onSupportChange?: (isSupported: boolean) => void;
};

/**
 * OutputRouter
 *
 * Manages separate output routing for main (PA/speakers) and CUE (headphones).
 * For CUE output to work independently, a separate AudioContext is required.
 */
export class OutputRouter {
  private readonly mainContext: AudioContext;
  private cueContext: AudioContext | null = null;
  private readonly callbacks: OutputRouterCallbacks;

  private _mainDeviceId = "default";
  private _cueDeviceId: string | null = null;
  private readonly _isSupported: boolean;

  constructor(
    mainContext: AudioContext,
    callbacks: OutputRouterCallbacks = {}
  ) {
    this.mainContext = mainContext;
    this.callbacks = callbacks;
    this._isSupported = isSinkIdSupported();

    if (!this._isSupported) {
      console.warn(
        "[OutputRouter] setSinkId not supported - output device selection unavailable"
      );
    }
  }

  /**
   * Check if output device selection is supported
   */
  get isSupported(): boolean {
    return this._isSupported;
  }

  /**
   * Get current main output device ID
   */
  get mainDeviceId(): string {
    return this._mainDeviceId;
  }

  /**
   * Get current CUE output device ID
   */
  get cueDeviceId(): string | null {
    return this._cueDeviceId;
  }

  /**
   * Get the CUE AudioContext (for routing CUE audio)
   * Creates one if it doesn't exist
   */
  get cueAudioContext(): AudioContext | null {
    return this.cueContext;
  }

  /**
   * Get current state
   */
  get state(): OutputRouterState {
    return {
      mainDeviceId: this._mainDeviceId,
      cueDeviceId: this._cueDeviceId,
      isSupported: this._isSupported,
    };
  }

  /**
   * Get available output devices
   */
  getOutputDevices(): Promise<AudioDeviceInfo[]> {
    return DeviceSource.getOutputDevices();
  }

  /**
   * Set main output device (speakers/PA)
   */
  async setMainOutput(deviceId: string): Promise<void> {
    if (!this._isSupported) {
      this.callbacks.onError?.(
        new Error("Output device selection not supported in this browser")
      );
      return;
    }

    try {
      // Type assertion needed as setSinkId is not in all TS lib definitions
      await (
        this.mainContext as AudioContext & {
          setSinkId: (id: string) => Promise<void>;
        }
      ).setSinkId(deviceId);
      this._mainDeviceId = deviceId;
      this.callbacks.onMainOutputChange?.(deviceId);
    } catch (error) {
      this.handleError("Failed to set main output device", error);
    }
  }

  /**
   * Set CUE/headphone output device
   * Creates a separate AudioContext for independent routing
   */
  async setCueOutput(deviceId: string | null): Promise<void> {
    // Setting to null removes CUE output (same as main)
    if (deviceId === null) {
      this.destroyCueContext();
      this._cueDeviceId = null;
      this.callbacks.onCueOutputChange?.(null);
      return;
    }

    if (!this._isSupported) {
      this.callbacks.onError?.(
        new Error("Output device selection not supported in this browser")
      );
      return;
    }

    try {
      // Create CUE context if needed
      if (!this.cueContext) {
        this.cueContext = new AudioContext({
          sampleRate: this.mainContext.sampleRate,
        });
      }

      // Ensure context is running
      if (this.cueContext.state === "suspended") {
        await this.cueContext.resume();
      }

      // Set sink ID
      await (
        this.cueContext as AudioContext & {
          setSinkId: (id: string) => Promise<void>;
        }
      ).setSinkId(deviceId);
      this._cueDeviceId = deviceId;
      this.callbacks.onCueOutputChange?.(deviceId);
    } catch (error) {
      this.handleError("Failed to set CUE output device", error);
    }
  }

  /**
   * Reset to default outputs
   */
  async resetToDefaults(): Promise<void> {
    await this.setMainOutput("default");
    await this.setCueOutput(null);
  }

  /**
   * Handle errors
   */
  private handleError(message: string, error: unknown): void {
    const errorObj =
      error instanceof Error
        ? error
        : new Error(`${message}: ${String(error)}`);

    console.error(`[OutputRouter] ${message}:`, error);
    this.callbacks.onError?.(errorObj);
  }

  /**
   * Destroy CUE context
   */
  private destroyCueContext(): void {
    if (this.cueContext) {
      this.cueContext.close().catch((e) => {
        console.warn("[OutputRouter] Error closing CUE context:", e);
      });
      this.cueContext = null;
    }
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    this.destroyCueContext();
    this._mainDeviceId = "default";
    this._cueDeviceId = null;
  }
}

/**
 * Create an output router
 */
export function createOutputRouter(
  mainContext: AudioContext,
  callbacks: OutputRouterCallbacks = {}
): OutputRouter {
  return new OutputRouter(mainContext, callbacks);
}
