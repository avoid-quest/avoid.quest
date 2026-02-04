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
import { isSinkIdSupported } from "../utils.js";

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

  // Track pending close operation to prevent race conditions
  private _cueContextClosePromise: Promise<void> | null = null;

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
   * Throws if the operation fails
   */
  async setMainOutput(deviceId: string): Promise<void> {
    if (!this._isSupported) {
      const error = new Error(
        "Output device selection not supported in this browser (setSinkId unavailable)"
      );
      this.callbacks.onError?.(error);
      throw error;
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
      throw error;
    }
  }

  /**
   * Set CUE/headphone output device
   * Creates a separate AudioContext for independent routing
   */
  async setCueOutput(deviceId: string | null): Promise<void> {
    // Setting to null removes CUE output (same as main)
    if (deviceId === null) {
      await this.destroyCueContext();
      this._cueDeviceId = null;
      this.callbacks.onCueOutputChange?.(null);
      return;
    }

    if (!this._isSupported) {
      const error = new Error(
        "Output device selection not supported in this browser (setSinkId unavailable). CUE output requires Chrome or Edge."
      );
      this.callbacks.onError?.(error);
      throw error;
    }

    // Wait for any pending close operation before creating new context
    if (this._cueContextClosePromise) {
      await this._cueContextClosePromise;
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
      throw error;
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
   * Returns a promise that resolves when the context is closed
   */
  private async destroyCueContext(): Promise<void> {
    // Wait for any pending close operation to complete
    if (this._cueContextClosePromise) {
      await this._cueContextClosePromise;
    }

    if (this.cueContext) {
      const contextToClose = this.cueContext;
      this.cueContext = null;

      // Track the close promise to prevent race conditions
      try {
        this._cueContextClosePromise = contextToClose.close();
        await this._cueContextClosePromise;
      } catch (e) {
        console.warn("[OutputRouter] Error closing CUE context:", e);
      } finally {
        this._cueContextClosePromise = null;
      }
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    await this.destroyCueContext();
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
