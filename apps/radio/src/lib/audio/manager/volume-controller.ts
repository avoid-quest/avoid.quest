import { type AudioState, getAudioContext } from "../playback/index.js";
import { notifySoundState } from "./audio-manager-state.js";
import type { SoundInstance } from "./audio-manager-types.js";

const MIN_GAIN = 0.0001;

type VolumeControllerOptions = {
  getSound: (soundId: string) => SoundInstance | null;
  getSounds: () => Iterable<[string, SoundInstance]>;
  notifyListeners: (soundId: string, state: AudioState) => void;
  getContext?: () => AudioContext | null;
};

type ScheduledVolumeCurve = {
  endTime: number;
  startTime: number;
  values: Float32Array;
};

function clampVolume(volume: number): number {
  return Math.max(0, Math.min(1, volume));
}

function sampleScheduledCurve(
  curve: ScheduledVolumeCurve,
  time: number
): number {
  if (curve.values.length === 0) {
    return MIN_GAIN;
  }
  if (time <= curve.startTime) {
    return curve.values[0] ?? MIN_GAIN;
  }
  if (time >= curve.endTime) {
    return curve.values.at(-1) ?? MIN_GAIN;
  }

  const progress = (time - curve.startTime) / (curve.endTime - curve.startTime);
  const position = progress * (curve.values.length - 1);
  const leftIndex = Math.floor(position);
  const rightIndex = Math.min(leftIndex + 1, curve.values.length - 1);
  const mix = position - leftIndex;
  const left = curve.values[leftIndex] ?? MIN_GAIN;
  const right = curve.values[rightIndex] ?? left;
  return left + (right - left) * mix;
}

class VolumeController {
  private readonly getSound: (soundId: string) => SoundInstance | null;
  private readonly getSounds: () => Iterable<[string, SoundInstance]>;
  private readonly notifyListeners: (
    soundId: string,
    state: AudioState
  ) => void;
  private readonly getContext: () => AudioContext | null;
  private readonly nativeVolumeAnimationFrames = new Map<string, number>();
  private readonly volumeCurveEndTimes = new Map<string, number>();
  private readonly volumeCurves = new Map<string, ScheduledVolumeCurve>();
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

    const clampedVolume = clampVolume(volume);
    instance.volume = clampedVolume;
    this.setSoundGainTarget(soundId, instance, clampedVolume);

    this.notifyVolumeChange(soundId, instance, clampedVolume);
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

    const lastVolume = clampVolume(volumeCurve.at(-1) ?? instance.volume);
    instance.volume = lastVolume;

    if (instance.outputMode === "native") {
      this.scheduleNativeVolumeCurve(
        soundId,
        instance,
        volumeCurve,
        durationMs
      );
      this.notifyVolumeChange(soundId, instance, lastVolume);
      return;
    }

    const nodes = instance.nodes;
    if (!nodes) {
      this.setSoundGainTarget(soundId, instance, lastVolume);
      this.notifyVolumeChange(soundId, instance, lastVolume);
      return;
    }

    const context = this.getContext();
    if (!context) {
      this.notifyVolumeChange(soundId, instance, lastVolume);
      return;
    }

    const now = context.currentTime;
    const durationSeconds = Math.max(0, durationMs) / 1000;
    const gainNode = nodes.gain.gain;
    const activeCurveEndTime = this.volumeCurveEndTimes.get(soundId) ?? 0;
    const cancelAndHoldAtTime = gainNode.cancelAndHoldAtTime?.bind(gainNode);
    const curveStartTime = now;

    if (activeCurveEndTime > now && cancelAndHoldAtTime) {
      cancelAndHoldAtTime(now);
    } else if (activeCurveEndTime > now) {
      const activeCurve = this.volumeCurves.get(soundId);
      const heldValue = activeCurve
        ? sampleScheduledCurve(activeCurve, now)
        : gainNode.value;
      gainNode.cancelScheduledValues(now);
      gainNode.setValueAtTime(heldValue, now);
    } else {
      gainNode.cancelScheduledValues(curveStartTime);
    }

    if (durationSeconds === 0) {
      gainNode.setValueAtTime(
        this.scaleForGlobalVolume(lastVolume),
        curveStartTime
      );
      this.volumeCurveEndTimes.delete(soundId);
      this.volumeCurves.delete(soundId);
      this.notifyVolumeChange(soundId, instance, lastVolume);
      return;
    }

    const scaledCurve = Float32Array.from(volumeCurve, (value) =>
      this.scaleForGlobalVolume(clampVolume(value))
    );
    gainNode.setValueCurveAtTime(scaledCurve, curveStartTime, durationSeconds);
    const curveEndTime = curveStartTime + durationSeconds;
    this.volumeCurveEndTimes.set(soundId, curveEndTime);
    this.volumeCurves.set(soundId, {
      endTime: curveEndTime,
      startTime: curveStartTime,
      values: scaledCurve,
    });
    this.notifyVolumeChange(soundId, instance, lastVolume);
  }

  getSoundVolume(soundId: string): number | null {
    return this.getSound(soundId)?.volume ?? null;
  }

  getGlobalVolume(): number {
    return this.globalVolume;
  }

  setGlobalVolume(volume: number): void {
    this.globalVolume = clampVolume(volume);

    for (const [soundId, instance] of this.getSounds()) {
      this.setSoundGainTarget(soundId, instance, instance.volume);
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
    this.cancelNativeVolumeRamp(soundId);
    this.lastSoundVolumes.delete(soundId);
    this.volumeCurveEndTimes.delete(soundId);
    this.volumeCurves.delete(soundId);
  }

  clear(): void {
    for (const animationFrame of this.nativeVolumeAnimationFrames.values()) {
      globalThis.cancelAnimationFrame(animationFrame);
    }
    this.nativeVolumeAnimationFrames.clear();
    this.lastSoundVolumes.clear();
    this.volumeCurveEndTimes.clear();
    this.volumeCurves.clear();
    this.globalVolume = 1;
    this.globalMuted = false;
    this.lastGlobalVolume = 1;
  }

  private cancelNativeVolumeRamp(soundId: string): void {
    const animationFrame = this.nativeVolumeAnimationFrames.get(soundId);
    if (animationFrame === undefined) {
      return;
    }
    globalThis.cancelAnimationFrame(animationFrame);
    this.nativeVolumeAnimationFrames.delete(soundId);
  }

  private scheduleNativeVolumeCurve(
    soundId: string,
    instance: SoundInstance,
    volumeCurve: Float32Array,
    durationMs: number
  ): void {
    this.cancelNativeVolumeRamp(soundId);
    const playbackSource = instance.playbackSource;
    if (!playbackSource) {
      return;
    }

    const duration = Math.max(0, durationMs);
    const startedAt = performance.now();
    const scheduledCurve: ScheduledVolumeCurve = {
      endTime: 1,
      startTime: 0,
      values: volumeCurve,
    };
    const updateVolume = (now: number) => {
      if (
        this.getSound(soundId) !== instance ||
        instance.playbackSource !== playbackSource
      ) {
        this.nativeVolumeAnimationFrames.delete(soundId);
        return;
      }

      const progress =
        duration === 0 ? 1 : Math.min(1, (now - startedAt) / duration);
      const volume = sampleScheduledCurve(scheduledCurve, progress);
      playbackSource.volume = clampVolume(volume * this.globalVolume);
      if (progress >= 1) {
        this.nativeVolumeAnimationFrames.delete(soundId);
        return;
      }

      const animationFrame = globalThis.requestAnimationFrame(updateVolume);
      this.nativeVolumeAnimationFrames.set(soundId, animationFrame);
    };

    updateVolume(startedAt);
  }

  private setSoundGainTarget(
    soundId: string,
    instance: SoundInstance,
    volume: number
  ): void {
    if (instance.outputMode === "native") {
      this.cancelNativeVolumeRamp(soundId);
      if (instance.playbackSource) {
        instance.playbackSource.volume = clampVolume(
          volume * this.globalVolume
        );
      }
      return;
    }

    if (!instance.nodes) {
      return;
    }

    const context = this.getContext();
    if (!context) {
      return;
    }

    const now = context.currentTime;
    const gainParam = instance.nodes.gain.gain;
    const targetVolume = this.scaleForGlobalVolume(volume);
    const activeCurveEndTime = this.volumeCurveEndTimes.get(soundId) ?? 0;

    if (activeCurveEndTime > now) {
      const cancelAndHoldAtTime =
        gainParam.cancelAndHoldAtTime?.bind(gainParam);

      if (cancelAndHoldAtTime) {
        cancelAndHoldAtTime(now);
      } else {
        const activeCurve = this.volumeCurves.get(soundId);
        const heldValue = activeCurve
          ? sampleScheduledCurve(activeCurve, now)
          : gainParam.value;
        gainParam.cancelScheduledValues(now);
        gainParam.setValueAtTime(heldValue, now);
      }

      this.volumeCurveEndTimes.delete(soundId);
      this.volumeCurves.delete(soundId);
      gainParam.setTargetAtTime(targetVolume, now, 0.02);
      return;
    }

    this.volumeCurveEndTimes.delete(soundId);
    this.volumeCurves.delete(soundId);
    gainParam.cancelScheduledValues(now);
    gainParam.setTargetAtTime(targetVolume, now, 0.05);
  }

  private notifyVolumeChange(
    soundId: string,
    instance: SoundInstance,
    volume: number
  ): void {
    notifySoundState(this.notifyListeners, soundId, instance, {
      volume,
      error: null,
    });
  }

  private scaleForGlobalVolume(volume: number): number {
    return Math.max(MIN_GAIN, volume * this.globalVolume);
  }
}

export type { VolumeControllerOptions };
export { VolumeController };
