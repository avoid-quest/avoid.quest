/**
 * Audio-graph seam shared by the compatibility worklet and the official
 * openDAW monitoring engine.
 */
export type EffectsGraphRuntime = {
  connectSound(
    soundId: string,
    source: AudioNode,
    destination: AudioNode,
    generation?: number
  ): Promise<boolean>;
  disconnectSound(soundId: string): void;
  setTempo(bpm: number): void;
  cleanup(): void;
};
