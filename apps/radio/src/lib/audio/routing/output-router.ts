/**
 * Output Router
 *
 * Manages audio output device selection for the main output.
 * Uses setSinkId for routing to specific output devices.
 * Handles browser compatibility (setSinkId not available in Firefox/Safari).
 *
 * Note: CUE (headphone) routing is handled entirely by CueBus.
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
  isSupported: boolean;
};

/**
 * Callbacks for OutputRouter
 */
export type OutputRouterCallbacks = {
  onMainOutputChange?: (deviceId: string) => void;
  onError?: (error: Error) => void;
};

/**
 * OutputRouter
 *
 * Manages output routing for main (PA/speakers).
 * CUE (headphone) routing is handled by CueBus.
 */
export class OutputRouter {
  private readonly mainContext: AudioContext;
  private readonly callbacks: OutputRouterCallbacks;

  private _mainDeviceId = "default";
  private readonly _isSupported: boolean;

  constructor(
    mainContext: AudioContext,
    callbacks: OutputRouterCallbacks = {}
  ) {
    this.mainContext = mainContext;
    this.callbacks = callbacks;
    this._isSupported = isSinkIdSupported();
  }

  get isSupported(): boolean {
    return this._isSupported;
  }

  get mainDeviceId(): string {
    return this._mainDeviceId;
  }

  get state(): OutputRouterState {
    return {
      mainDeviceId: this._mainDeviceId,
      isSupported: this._isSupported,
    };
  }

  getOutputDevices(): Promise<AudioDeviceInfo[]> {
    return DeviceSource.getOutputDevices();
  }

  async setMainOutput(deviceId: string): Promise<void> {
    if (!this._isSupported) {
      const error = new Error(
        "Output device selection not supported in this browser (setSinkId unavailable)"
      );
      this.callbacks.onError?.(error);
      throw error;
    }

    try {
      await this.mainContext.setSinkId(deviceId);
      this._mainDeviceId = deviceId;
      this.callbacks.onMainOutputChange?.(deviceId);
    } catch (error) {
      this.handleError("Failed to set main output device", error);
      throw error;
    }
  }

  private handleError(message: string, error: unknown): void {
    const errorObj =
      error instanceof Error
        ? error
        : new Error(`${message}: ${String(error)}`);

    this.callbacks.onError?.(errorObj);
  }

  cleanup(): void {
    this._mainDeviceId = "default";
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
