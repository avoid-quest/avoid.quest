import { type AudioState, getAudioContext } from "../playback/index.js";
import { notifySoundState } from "./audio-manager-state.js";
import type { SoundInstance } from "./audio-manager-types.js";

type VolumeControllerOptions = {
  getSound: (soundId: string) => SoundInstance | null;
  getSounds: () => Iterable<[string, SoundInstance]>;
  notifyListeners: (soundId: string, state: AudioState) => void;
  getContext?: () => AudioContext | null;
};

class VolumeController {
  private readonly getSound: (soundId: string) => SoundInstance | null;
  private readonly getSounds: () => Iterable<[string, SoundInstance]>;
  private readonly notifyListeners: (
    soundId: string,
    state: AudioState
  ) => void;
  private readonly getContext: () => AudioContext | null;
  private readonly volumeCurveEndTimes = new Map<string, number>();
  private readonly lastSoundVolumes = new Map<string, number>();
  private globalVolume = 1;
  private globalMuted = false;
  private lastGlobalVolume = 1;

  constructor({
    getSound,
    getSounds,
    notifyListeners,
    getContext = getAudioContext,
  }: VolumeControllerOptions) {
    this.getSound = getSound;
    this.getSounds = getSounds;
    this.notifyListeners = notifyListeners;
    this.getContext = getContext;
  }

  set(soundId: string, volume: number): void {
    const instance = this.getSound(soundId);
    if (!instance) {
      console.warn(`[AudioManager] setVolume: sound ${soundId} not found`);
      return;
    }

    const clampedVolume = Math.max(0, Math.min(1, volume));
    instance.volume = clampedVolume;
    this.setSoundGainTarget(soundId, instance, clampedVolume);

    notifySoundState(this.notifyListeners, soundId, instance, {
      volume: clampedVolume,
      error: null,
    });
  }

  scheduleVolumeCurve(
    soundId: string,
    volumeCurve: Float32Array,
    durationMs: number
  ): void {
    const instance = this.getSound(soundId);
    if (!instance || volumeCurve.length === 0) {
      return;
    }

    const lastVolume = Math.max(
      0,
      Math.min(1, volumeCurve.at(-1) ?? instance.volume)
    );
    instance.volume = lastVolume;

    if (instance.nodes) {
      const context = this.getContext();
      if (context) {
        const now = context.currentTime;
        const durationSeconds = Math.max(0, durationMs) / 1000;
        const gainNode = instance.nodes.gain.gain;
        const activeCurveEndTime = this.volumeCurveEndTimes.get(soundId) ?? 0;
        const cancelAndHoldAtTime =
          gainNode.cancelAndHoldAtTime?.bind(gainNode);
        const curveStartTime =
          activeCurveEndTime > now && !cancelAndHoldAtTime
            ? activeCurveEndTime + 0.001
            : now;

        if (activeCurveEndTime > now && cancelAndHoldAtTime) {
          cancelAndHoldAtTime(now);
        } else {
          gainNode.cancelScheduledValues(curveStartTime);
        }

        if (durationSeconds === 0) {
          gainNode.setValueAtTime(
            Math.max(0.0001, lastVolume * this.globalVolume),
            curveStartTime
          );
          this.volumeCurveEndTimes.delete(soundId);
        } else {
          const scaledCurve = Float32Array.from(volumeCurve, (value) =>
            Math.max(
              0.0001,
              Math.max(0, Math.min(1, value)) * this.globalVolume
            )
          );
          gainNode.setValueCurveAtTime(
            scaledCurve,
            curveStartTime,
            durationSeconds
          );
          this.volumeCurveEndTimes.set(
            soundId,
            curveStartTime + durationSeconds
          );
        }
      }
    }

    notifySoundState(this.notifyListeners, soundId, instance, {
      volume: lastVolume,
      error: null,
    });
  }

  getSoundVolume(soundId: string): number | null {
    return this.getSound(soundId)?.volume ?? null;
  }

  getGlobalVolume(): number {
    return this.globalVolume;
  }

  setGlobalVolume(volume: number): void {
    this.globalVolume = Math.max(0, Math.min(1, volume));

    for (const [soundId, instance] of this.getSounds()) {
      if (instance.nodes) {
        this.setSoundGainTarget(soundId, instance, instance.volume);
      }
    }
  }

  muteGlobal(): void {
    if (!this.globalMuted) {
      this.lastGlobalVolume = this.globalVolume;
      this.setGlobalVolume(0);
      this.globalMuted = true;
    }
  }

  unmuteGlobal(): void {
    if (this.globalMuted) {
      this.setGlobalVolume(this.lastGlobalVolume);
      this.globalMuted = false;
    }
  }

  isGlobalMuted(): boolean {
    return this.globalMuted;
  }

  muteSound(soundId: string): void {
    const instance = this.getSound(soundId);
    if (instance) {
      this.lastSoundVolumes.set(soundId, instance.volume);
      this.set(soundId, 0);
    }
  }

  unmuteSound(soundId: string): void {
    const instance = this.getSound(soundId);
    if (instance) {
      const lastVolume = this.lastSoundVolumes.get(soundId) ?? 1;
      this.set(soundId, lastVolume);
      this.lastSoundVolumes.delete(soundId);
    }
  }

  isSoundMuted(soundId: string): boolean {
    const instance = this.getSound(soundId);
    return instance ? instance.volume === 0 : false;
  }

  deleteSound(soundId: string): void {
    this.lastSoundVolumes.delete(soundId);
    this.volumeCurveEndTimes.delete(soundId);
  }

  clear(): void {
    this.lastSoundVolumes.clear();
    this.volumeCurveEndTimes.clear();
    this.globalVolume = 1;
    this.globalMuted = false;
    this.lastGlobalVolume = 1;
  }

  private setSoundGainTarget(
    soundId: string,
    instance: SoundInstance,
    volume: number
  ): void {
    if (!instance.nodes) {
      return;
    }

    const context = this.getContext();
    if (!context) {
      return;
    }

    const now = context.currentTime;
    const gainParam = instance.nodes.gain.gain;
    const targetVolume = Math.max(0.0001, volume * this.globalVolume);
    const activeCurveEndTime = this.volumeCurveEndTimes.get(soundId) ?? 0;

    if (activeCurveEndTime > now) {
      const cancelAndHoldAtTime =
        gainParam.cancelAndHoldAtTime?.bind(gainParam);

      if (cancelAndHoldAtTime) {
        cancelAndHoldAtTime(now);
        this.volumeCurveEndTimes.delete(soundId);
        gainParam.setTargetAtTime(targetVolume, now, 0.05);
        return;
      }

      gainParam.setTargetAtTime(targetVolume, activeCurveEndTime + 0.001, 0.05);
      return;
    }

    this.volumeCurveEndTimes.delete(soundId);
    gainParam.cancelScheduledValues(now);
    gainParam.setTargetAtTime(targetVolume, now, 0.05);
  }
}

export { VolumeController };
export type { VolumeControllerOptions };
