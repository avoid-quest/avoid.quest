import type { Radio } from "../playback/index.js";
import {
  createSoundInstance,
  type SoundInstance,
} from "./audio-manager-types.js";

type CleanupExistingSound = (soundId: string) => void;

class SoundRegistry {
  private readonly sounds = new Map<string, SoundInstance>();

  create(
    radio: Radio,
    soundId?: string,
    cleanupExisting?: CleanupExistingSound
  ): string {
    const id = soundId ?? `sound_${radio.id ?? Date.now()}`;

    if (this.sounds.has(id)) {
      cleanupExisting?.(id);
    }

    this.sounds.set(id, createSoundInstance(radio, id));
    return id;
  }

  get(soundId: string): SoundInstance | null {
    return this.sounds.get(soundId) ?? null;
  }

  has(soundId: string): boolean {
    return this.sounds.has(soundId);
  }

  delete(soundId: string): boolean {
    return this.sounds.delete(soundId);
  }

  clear(): void {
    this.sounds.clear();
  }

  ids(): IterableIterator<string> {
    return this.sounds.keys();
  }

  entries(): IterableIterator<[string, SoundInstance]> {
    return this.sounds.entries();
  }

  values(): IterableIterator<SoundInstance> {
    return this.sounds.values();
  }

  asMap(): Map<string, SoundInstance> {
    return this.sounds;
  }
}

export { SoundRegistry };
