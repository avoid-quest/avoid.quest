import type { Unsubscribe } from "../playback/index.js";
import {
  startMasterMeterLoop,
  stopMasterMeterLoop,
} from "./audio-manager-graph.js";

type MeterLevel = { left: number; right: number };
type MeterListener = (level: MeterLevel) => void;

class MeterService {
  readonly soundMeterListeners = new Map<string, Set<MeterListener>>();
  private readonly masterMeterListeners = new Set<MeterListener>();
  private masterAnalyserL: AnalyserNode | null = null;
  private masterAnalyserR: AnalyserNode | null = null;
  private masterMeterRafId: number | null = null;
  private readonly masterMeterFrame = { count: 0, value: 0 };

  setMasterAnalysers(
    analyserL: AnalyserNode | null,
    analyserR: AnalyserNode | null
  ): void {
    this.stopMasterMeterLoop();
    this.masterAnalyserL = analyserL;
    this.masterAnalyserR = analyserR;

    if (this.masterMeterListeners.size > 0) {
      this.startMasterMeterLoop();
    }
  }

  subscribeMasterMeter(callback: MeterListener): Unsubscribe {
    this.masterMeterListeners.add(callback);

    if (this.masterMeterListeners.size === 1) {
      this.startMasterMeterLoop();
    }

    return () => {
      this.masterMeterListeners.delete(callback);
      if (this.masterMeterListeners.size === 0) {
        this.stopMasterMeterLoop();
      }
    };
  }

  subscribeMeter(soundId: string, callback: MeterListener): Unsubscribe {
    if (!this.soundMeterListeners.has(soundId)) {
      this.soundMeterListeners.set(soundId, new Set());
    }

    this.soundMeterListeners.get(soundId)?.add(callback);

    return () => {
      const callbacks = this.soundMeterListeners.get(soundId);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.soundMeterListeners.delete(soundId);
        }
      }
    };
  }

  notifySoundZero(soundId: string): void {
    const callbacks = this.soundMeterListeners.get(soundId);
    if (!callbacks) {
      return;
    }

    for (const callback of callbacks) {
      callback({ left: 0, right: 0 });
    }
  }

  clear(): void {
    this.stopMasterMeterLoop();
    this.soundMeterListeners.clear();
    this.masterMeterListeners.clear();
    this.setMasterAnalysers(null, null);
  }

  private startMasterMeterLoop(): void {
    if (!(this.masterAnalyserL && this.masterAnalyserR)) {
      return;
    }

    this.masterMeterRafId = startMasterMeterLoop(
      this.masterAnalyserL,
      this.masterAnalyserR,
      this.masterMeterListeners,
      this.masterMeterFrame
    );
  }

  private stopMasterMeterLoop(): void {
    stopMasterMeterLoop(this.masterMeterFrame.value || this.masterMeterRafId);
    this.masterMeterRafId = null;
    this.masterMeterFrame.count = 0;
    this.masterMeterFrame.value = 0;
  }
}

export type { MeterLevel, MeterListener };
export { MeterService };
