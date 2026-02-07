const MIN_DURATION = 0.1;
const MAX_DURATION = 2.0;
const RELEASE_TIME = 1.0;
const VOLUME_RAMP_MS = 50;

class AudioEngine {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly activeSources = new Set<AudioBufferSourceNode>();

  initialize(): void {
    if (this.context) {
      return;
    }
    this.context = new AudioContext();
    this.masterGain = this.context.createGain();
    this.masterGain.connect(this.context.destination);
  }

  resume(): void {
    if (this.context?.state === "suspended") {
      this.context.resume().catch((error: unknown) => {
        console.warn("AudioContext resume failed:", error);
      });
    }
  }

  async loadSample(key: string, url: string): Promise<void> {
    if (this.buffers.has(key) || !this.context) {
      return;
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch sample "${key}": ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await this.context.decodeAudioData(arrayBuffer);
    this.buffers.set(key, audioBuffer);
  }

  playRandom(): void {
    if (!(this.context && this.masterGain) || this.buffers.size === 0) {
      return;
    }

    if (this.context.state === "suspended") {
      this.context.resume().catch((error: unknown) => {
        console.warn("AudioContext resume failed:", error);
      });
    }

    const keys = [...this.buffers.keys()];
    const randomKey = keys[Math.floor(Math.random() * keys.length)];
    const buffer = this.buffers.get(randomKey);
    if (!buffer) {
      return;
    }

    const source = this.context.createBufferSource();
    source.buffer = buffer;

    // Per-voice gain for release envelope
    const voiceGain = this.context.createGain();
    voiceGain.connect(this.masterGain);
    source.connect(voiceGain);

    const now = this.context.currentTime;
    const duration =
      MIN_DURATION + Math.random() * (MAX_DURATION - MIN_DURATION);
    const maxOffset = Math.max(0, buffer.duration - duration - RELEASE_TIME);
    const offset = Math.random() * maxOffset;

    // Release envelope
    voiceGain.gain.setValueAtTime(1, now + duration);
    voiceGain.gain.linearRampToValueAtTime(0, now + duration + RELEASE_TIME);

    this.activeSources.add(source);
    source.onended = () => {
      this.activeSources.delete(source);
      voiceGain.disconnect();
    };

    source.start(0, offset, duration + RELEASE_TIME);
  }

  setVolume(value: number): void {
    if (!(this.masterGain && this.context)) {
      return;
    }
    const now = this.context.currentTime;
    this.masterGain.gain.linearRampToValueAtTime(
      value,
      now + VOLUME_RAMP_MS / 1000
    );
  }

  dispose(): void {
    for (const source of this.activeSources) {
      try {
        source.stop();
      } catch (error: unknown) {
        console.warn("Failed to stop audio source:", error);
      }
    }
    this.activeSources.clear();
    this.buffers.clear();

    if (this.context) {
      this.context.close().catch((error: unknown) => {
        console.warn("AudioContext close failed:", error);
      });
      this.context = null;
    }
    this.masterGain = null;
  }

  get isInitialized(): boolean {
    return this.context !== null;
  }
}

let instance: AudioEngine | null = null;

export function getAudioEngine(): AudioEngine | null {
  return instance;
}

export function createAudioEngine(): AudioEngine {
  if (!instance) {
    instance = new AudioEngine();
  }
  return instance;
}

export function disposeAudioEngine(): void {
  if (instance) {
    instance.dispose();
    instance = null;
  }
}
