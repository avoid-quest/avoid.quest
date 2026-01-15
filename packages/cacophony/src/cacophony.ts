import {
  AudioContext,
  AudioWorkletNode,
  type IAudioListener,
  type IPannerNode,
  type IPannerOptions,
} from "standardized-audio-context";
import { AudioCache, type ICache } from "./cache.js";
import type { AudioBuffer, BiquadFilterNode, GainNode } from "./context.js";
import { TypedEventEmitter } from "./eventEmitter.js";
import type { CacophonyEvents } from "./events.js";
import { Group } from "./group.js";
import { MicrophoneStream } from "./microphone.js";
import { Sound } from "./sound.js";
import { Synth } from "./synth.js";

export const SoundType = {
  HTML: "HTML",
  Streaming: "Streaming",
  Buffer: "Buffer",
  Oscillator: "Oscillator",
} as const;

export type SoundType = (typeof SoundType)[keyof typeof SoundType];

/**
 * Represents a 3D position in space.
 * @typedef {Array<number>} Position - An array of three numbers representing the x, y, and z coordinates.
 */
export type Position = [x: number, y: number, z: number];

/**
 * Represents the orientation of an object in 3D space.
 * @typedef {Object} Orientation - An object containing two positions: forward and up.
 * @property {Position} forward - The forward direction of the object.
 * @property {Position} up - The up direction of the object.
 */
export type Orientation = {
  forward: Position;
  up: Position;
};

/**
 * Represents the number of times a sound should loop.
 * @typedef {number | 'infinite'} LoopCount - The number of loops, or 'infinite' for endless looping.
 */
export type LoopCount = number | "infinite";

/**
 * Represents the type of fade effect to apply.
 * @typedef {'linear' | 'exponential'} FadeType - The fade type, either 'linear' or 'exponential'.
 */
export type FadeType = "linear" | "exponential";

/**
 * Represents the type of panning effect to apply.
 * @typedef {'HRTF' | 'stereo'} PanType - The pan type, either 'HRTF' for 3D audio or 'stereo' for traditional stereo panning.
 */
export type PanType = "HRTF" | "stereo";

/**
 * The base interface for any sound-producing entity, including individual sounds, groups, and playbacks.
 * @interface BaseSound
 */
export type BaseSound = {
  isPlaying: boolean;
  play(): BaseSound[];
  seek?(time: number): void;
  stop(): void;
  pause(): void;
  addFilter(filter: BiquadFilterNode): void;
  removeFilter(filter: BiquadFilterNode): void;
  volume: number;
  position?: Position;
  threeDOptions?: Partial<IPannerOptions>;
};

import { CacophonyEngine } from "./engine/cacophony-engine.js";

export class Cacophony {
  context: AudioContext;
  engine: CacophonyEngine;
  listener: IAudioListener;
  private prevVolume = 1;
  private _muted = false;
  private readonly eventEmitter: TypedEventEmitter<CacophonyEvents> =
    new TypedEventEmitter<CacophonyEvents>();
  private readonly cache: ICache;
  // Track which worklets have been loaded to avoid duplicate loads
  private readonly loadedWorklets = new Set<string>();
  // Track worklets currently being loaded to avoid race conditions
  private readonly loadingWorklets = new Map<string, Promise<void>>();

  constructor(context?: AudioContext, cache?: ICache) {
    this.context = context || new AudioContext();
    this.listener = this.context.listener;
    // @ts-ignore - IAudioContext vs AudioContext type mismatch from standardized-audio-context
    this.engine = new CacophonyEngine(this.context as any);
    this.cache = cache || new AudioCache();
  }

  /**
   * Register event listener.
   * @returns Cleanup function
   */
  on<K extends keyof CacophonyEvents>(
    event: K,
    listener: (data: CacophonyEvents[K]) => void
  ): void {
    this.eventEmitter.on(event, listener);
  }

  /**
   * Remove event listener.
   */
  off<K extends keyof CacophonyEvents>(
    event: K,
    listener: (data: CacophonyEvents[K]) => void
  ): void {
    this.eventEmitter.off(event, listener);
  }

  emit<K extends keyof CacophonyEvents>(
    event: K,
    data: CacophonyEvents[K]
  ): void {
    this.eventEmitter.emit(event, data);
  }

  emitAsync<K extends keyof CacophonyEvents>(
    event: K,
    data: CacophonyEvents[K]
  ): Promise<void> {
    return this.eventEmitter.emitAsync(event, data);
  }


  async createWorkletNode(
    workletName: string,
    url: string,
    signal?: AbortSignal
  ) {
    // ensure audioWorklet has been loaded
    const audioWorklet = this.context.audioWorklet;
    if (!audioWorklet || typeof AudioWorkletNode === "undefined") {
      throw new Error("AudioWorklet not supported");
    }

    // Check if worklet is already loaded
    if (this.loadedWorklets.has(workletName)) {
      return new AudioWorkletNode(this.context, workletName);
    }

    // Check if worklet is currently being loaded (avoid race conditions)
    const loadingPromise = this.loadingWorklets.get(workletName);
    if (loadingPromise) {
      await loadingPromise;
      return new AudioWorkletNode(this.context, workletName);
    }

    // Try to create the node first (in case it's already loaded but not tracked)
    try {
      const node = new AudioWorkletNode(this.context, workletName);
      this.loadedWorklets.add(workletName);
      return node;
    } catch (err) {
      // Expected error - worklet not loaded yet, proceed to load it
      // Don't log this error as it's expected behavior
    }

    // Load the worklet module
    const loadPromise = (async () => {
      try {
        await audioWorklet.addModule(url, {
          credentials: "same-origin",
          ...(signal && { signal }),
        });
        this.loadedWorklets.add(workletName);
      } catch (moduleErr) {
        console.error(
          `Failed to load worklet "${workletName}" from ${url}:`,
          moduleErr
        );
        throw moduleErr; // Preserve original error (including AbortError)
      } finally {
        this.loadingWorklets.delete(workletName);
      }
    })();

    this.loadingWorklets.set(workletName, loadPromise);
    await loadPromise;

    return new AudioWorkletNode(this.context, workletName);
  }

  clearMemoryCache(): void {
    this.cache.clearMemoryCache();
  }

  createOscillator(
    options: OscillatorOptions,
    panType: PanType = "HRTF"
  ): Synth {
    const synth = new Synth({
      context: this.context,
      soundType: SoundType.Oscillator,
      panType,
      oscillatorOptions: options,
      cacophony: this,
    });
    return synth;
  }

  /**
   * Creates a Sound instance from an AudioBuffer or URL.
   *
   * @param bufferOrUrl - AudioBuffer instance or URL string to create sound from
   * @param soundType - Type of sound (Buffer, HTML, Streaming)
   * @param panType - Type of panning (HRTF or stereo)
   * @param signal - Optional AbortSignal to cancel the operation
   * @returns Promise that resolves to a Sound instance
   */

  async createSound(
    url: string | AudioBuffer,
    soundType?: SoundType,
    panType?: PanType,
    signal?: AbortSignal
  ): Promise<Sound>;

  async createSound(
    bufferOrUrl: AudioBuffer | string,
    soundType: SoundType = SoundType.Buffer,
    panType: PanType = "HRTF",
    signal?: AbortSignal
  ): Promise<Sound> {
    if (typeof bufferOrUrl === "object") {
      return Promise.resolve(
        new Sound({
          url: "",
          buffer: bufferOrUrl,
          context: this.context,
          soundType: SoundType.Buffer,
          panType,
          cacophony: this,
        })
      );
    }
    const url = bufferOrUrl;
    if (soundType === SoundType.Streaming) {
      return Promise.resolve(
        new Sound({
          url,
          buffer: undefined,
          context: this.context,
          soundType: SoundType.Streaming,
          panType,
          cacophony: this,
        })
      );
    }
    const buffer = await this.cache.getAudioBuffer(this.context, url, signal, {
      onLoadingStart: (event) => this.emitAsync("loadingStart", event),
      onLoadingProgress: (event) => this.emitAsync("loadingProgress", event),
      onLoadingComplete: (event) => this.emitAsync("loadingComplete", event),
      onLoadingError: (event) => this.emitAsync("loadingError", event),
      onCacheHit: (event) => this.emitAsync("cacheHit", event),
      onCacheMiss: (event) => this.emitAsync("cacheMiss", event),
      onCacheError: (event) => this.emitAsync("cacheError", event),
    });
    return new Sound({
      url: url as string,
      buffer,
      context: this.context,
      soundType,
      panType,
      cacophony: this,
    });
  }

  createGroup(sounds: Sound[]): Promise<Group> {
    const group = new Group();
    for (const sound of sounds) {
      group.addSound(sound);
    }
    return Promise.resolve(group);
  }

  /**
   * Creates a Group containing Sound instances loaded from multiple URLs.
   *
   * @param urls - Array of URL strings to load as sounds
   * @param soundType - Type of sound (Buffer, HTML, Streaming)
   * @param panType - Type of panning (HRTF or stereo)
   * @param signal - Optional AbortSignal to cancel the operation
   * @returns Promise that resolves to a Group containing all loaded sounds
   */
  async createGroupFromUrls(
    urls: string[],
    soundType: SoundType = SoundType.Buffer,
    panType: PanType = "HRTF",
    signal?: AbortSignal
  ): Promise<Group> {
    const group = new Group();
    const sounds = await Promise.all(
      urls.map((url) => this.createSound(url, soundType, panType, signal))
    );
    for (const sound of sounds) {
      group.addSound(sound);
    }
    return group;
  }

  /**
   * Creates a streaming Sound instance from a URL.
   * Streaming begins when play() is called on the returned Sound.
   *
   * @param url - URL string to stream audio from
   * @param signal - Optional AbortSignal to cancel the operation (not yet implemented)
   * @returns Promise that resolves to a Sound instance for streaming
   */
  createStream(url: string, _signal?: AbortSignal): Promise<Sound> {
    // Note: Streaming is now initiated when play() is called on the Sound
    // The AbortSignal should be passed to the Sound for later use
    const sound = new Sound({
      url,
      buffer: undefined,
      context: this.context,
      soundType: SoundType.Streaming,
      panType: "stereo", // Use stereo for radio streams
      cacophony: this,
    });
    return Promise.resolve(sound);
  }

  createBiquadFilter = ({
    type,
    frequency,
    gain,
    Q,
  }: BiquadFilterOptions): BiquadFilterNode => {
    if (frequency === undefined) {
      frequency = 350;
    }
    const filter = this.context.createBiquadFilter();
    filter.type = type || "lowpass";
    filter.frequency.value = frequency;
    filter.gain.value = gain || 0;
    filter.Q.value = Q || 1;
    return filter as BiquadFilterNode;
  };

  /**
   * Creates a PannerNode with the specified options.
   * @param {IPannerOptions} options - An object containing the options to use when creating the PannerNode.
   * @returns {PannerNode} A new PannerNode instance with the specified options.
   * @example
   * const panner = audio.createPanner({
   *  positionX: 0,
   * positionY: 0,
   * positionZ: 0,
   * orientationX: 0,
   * orientationY: 0,
   * orientationZ: 0,
   * });
   */

  createPanner(options: Partial<IPannerOptions>): IPannerNode<AudioContext> {
    const panner = this.context.createPanner();
    this.configurePannerProperties(panner, options);
    this.configurePannerPosition(panner, options);
    this.configurePannerOrientation(panner, options);
    return panner;
  }

  private configurePannerProperties(
    panner: IPannerNode<AudioContext>,
    options: Partial<IPannerOptions>
  ): void {
    panner.coneInnerAngle = options.coneInnerAngle ?? 360;
    panner.coneOuterAngle = options.coneOuterAngle ?? 360;
    panner.coneOuterGain = options.coneOuterGain ?? 0;
    panner.distanceModel = options.distanceModel ?? "inverse";
    panner.maxDistance = options.maxDistance ?? 10_000;
    panner.channelCount = options.channelCount ?? 2;
    panner.channelCountMode = options.channelCountMode ?? "clamped-max";
    panner.channelInterpretation = options.channelInterpretation ?? "speakers";
    panner.panningModel = options.panningModel ?? "HRTF";
    panner.refDistance = options.refDistance ?? 1;
    panner.rolloffFactor = options.rolloffFactor ?? 1;
  }

  private configurePannerPosition(
    panner: IPannerNode<AudioContext>,
    options: Partial<IPannerOptions>
  ): void {
    panner.positionX.value = options.positionX ?? 0;
    panner.positionY.value = options.positionY ?? 0;
    panner.positionZ.value = options.positionZ ?? 0;
  }

  private configurePannerOrientation(
    panner: IPannerNode<AudioContext>,
    options: Partial<IPannerOptions>
  ): void {
    panner.orientationX.value = options.orientationX ?? 0;
    panner.orientationY.value = options.orientationY ?? 0;
    panner.orientationZ.value = options.orientationZ ?? 0;
  }

  /**
   * Suspends the audio context.
   */
  pause(): void {
    if ("suspend" in this.context) {
      this.context.suspend();
    }
  }

  /**
   * Resumes the audio context.
   * This method is required to resume the audio context on mobile devices.
   * On desktop, the audio context will automatically resume when a sound is played.
   */

  resume() {
    if ("resume" in this.context) {
      this.context.resume();
    }
  }

  setGlobalVolume(volume: number) {
    // Update engine volume via channelStrip
    this.engine.setVolume(volume);
    this.prevVolume = volume;
  }

  get volume(): number {
    return this.prevVolume; 
  }

  set volume(volume: number) {
    if (this._muted) {
      this.prevVolume = volume;
      return;
    }
    this.setGlobalVolume(volume);
  }

  mute() {
    if (!this._muted) {
      this.prevVolume = 1; // Default or track actual volume
      this.setGlobalVolume(0);
      this._muted = true;
    }
  }

  unmute() {
    if (this._muted) {
      this.setGlobalVolume(this.prevVolume);
      this._muted = false;
    }
  }

  get muted(): boolean {
    return this._muted;
  }

  set muted(muted: boolean) {
    if (muted !== this._muted) {
      if (muted) {
        this.mute();
      } else {
        this.unmute();
      }
    }
  }

  getMicrophoneStream(): Promise<MicrophoneStream> {
    return new Promise((resolve, reject) => {
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((_stream) => {
          const microphoneStream = new MicrophoneStream(this.context);
          microphoneStream.play();
          resolve(microphoneStream);
        })
        .catch((err) => {
          reject(err);
        });
    });
  }

  get listenerOrientation(): Orientation {
    return {
      forward: [
        this.listener.forwardX.value,
        this.listener.forwardY.value,
        this.listener.forwardZ.value,
      ],
      up: [
        this.listener.upX.value,
        this.listener.upY.value,
        this.listener.upZ.value,
      ],
    };
  }

  set listenerOrientation(orientation: Orientation) {
    const { forward, up } = orientation;
    const [forwardX, forwardY, forwardZ] = forward;
    const [upX, upY, upZ] = up;
    this.listener.forwardX.value = forwardX;
    this.listener.forwardY.value = forwardY;
    this.listener.forwardZ.value = forwardZ;
    this.listener.upX.value = upX;
    this.listener.upY.value = upY;
    this.listener.upZ.value = upZ;
  }

  get listenerUpOrientation(): Position {
    return [
      this.listener.upX.value,
      this.listener.upY.value,
      this.listener.upZ.value,
    ];
  }

  set listenerUpOrientation(up: Position) {
    const [x, y, z] = up;
    this.listener.upX.value = x;
    this.listener.upY.value = y;
    this.listener.upZ.value = z;
  }

  get listenerForwardOrientation(): Position {
    return [
      this.listener.forwardX.value,
      this.listener.forwardY.value,
      this.listener.forwardZ.value,
    ];
  }

  set listenerForwardOrientation(forward: Position) {
    const [x, y, z] = forward;
    this.listener.forwardX.value = x;
    this.listener.forwardY.value = y;
    this.listener.forwardZ.value = z;
  }

  get listenerPosition(): Position {
    return [
      this.listener.positionX.value,
      this.listener.positionY.value,
      this.listener.positionZ.value,
    ];
  }

  set listenerPosition(position: Position) {
    const [x, y, z] = position;
    const currentTime = this.context.currentTime;
    this.listener.positionX.setValueAtTime(x, currentTime);
    this.listener.positionY.setValueAtTime(y, currentTime);
    this.listener.positionZ.setValueAtTime(z, currentTime);
  }
}
