import type { BaseSound, LoopCount, Position } from "./cacophony.js";
import type { BiquadFilterNode } from "./context.js";
import type { Playback } from "./playback.js";
import type { Sound } from "./sound.js";

export class Group implements BaseSound {
  private _position: Position = [0, 0, 0];
  loopCount: LoopCount = 0;
  private playIndex = 0;

  sounds: Sound[] = [];

  constructor(sounds: Sound[] = []) {
    this.sounds = sounds;
  }

  /**
   * Prepares a random sound from the group for playback.
   * @returns The playback object representing the prepared sound.
   * @throws Error if the group is empty and there are no sounds to prepare.
   */
  preplayRandom(): Playback | undefined {
    if (this.sounds.length === 0) {
      return;
    }
    const randomSound = this.randomSound();
    const playbacks = randomSound.preplay();
    return playbacks.length > 0 ? playbacks[0] : undefined;
  }

  /**
   * Plays a random sound from the group.
   * @returns The playback object representing the played sound, or undefined if the group is empty.
   */
  playRandom(): Playback | undefined {
    const playback = this.preplayRandom();
    if (playback) {
      playback.play();
    }
    return playback;
  }

  /**
   * Prepares the sounds in the group for playback in a specific order.
   *
   * @param shouldLoop - Indicates whether the sounds should be prepared for looping.
   * @returns The playback object representing the first sound being prepared, or undefined if the group is empty.
   */
  preplayOrdered(shouldLoop = true): Playback | undefined {
    if (this.sounds.length === 0) {
      return;
    }
    const sound = this.sounds[this.playIndex];
    if (!sound) {
      return;
    }
    const playbacks = sound.preplay();
    if (playbacks.length === 0) {
      return;
    }
    this.playIndex = (this.playIndex + 1) % this.sounds.length;
    if (!shouldLoop && this.playIndex === 0) {
      this.playIndex = this.sounds.length;
    }
    return playbacks[0];
  }

  /**
   * Plays the sounds in the group in a specific order.
   *
   * @param shouldLoop - Indicates whether the sounds should be played in a loop.
   * @returns The playback object representing the first sound being played, or undefined if the group is empty.
   */
  playOrdered(shouldLoop = true): Playback | undefined {
    const playback = this.preplayOrdered(shouldLoop);
    if (playback) {
      playback.play();
    }
    return playback;
  }

  get duration() {
    return this.sounds
      .map((sound) => sound.duration)
      .reduce((a, b) => Math.max(a, b), 0);
  }

  seek(time: number): void {
    for (const sound of this.sounds) {
      if (sound.seek) {
        sound.seek(time);
      }
    }
  }

  addSound(sound: Sound): void {
    this.sounds.push(sound);
  }

  /**
   * Returns a random sound from the group.
   * @returns A random Sound object from the group.
   * @throws Error if the group is empty.
   */
  randomSound(): Sound {
    if (this.sounds.length === 0) {
      throw new Error("Cannot get a random sound from an empty group");
    }
    const randomIndex = Math.floor(Math.random() * this.sounds.length);
    const sound = this.sounds[randomIndex];
    if (!sound) {
      throw new Error("Cannot get a random sound from an empty group");
    }
    return sound;
  }

  preplay(): Playback[] {
    const playbacks = this.sounds
      .filter((sound): sound is Sound => sound !== undefined)
      .map((sound) => sound.preplay());
    return playbacks.flat();
  }

  /***
   *   Plays all sounds in the group.
   *  @returns {Playback[]} An array of Playback objects, one for each sound in the group.
   */

  play(): BaseSound[] {
    // const playbacks = this.preplay().map((playback) => playback.play()[0]);
    const playbacks: BaseSound[] = [];
    // preplay returns an array, and then play on each of those also returns an array, and we only want one array of playbacks
    for (const playback of this.preplay()) {
      playback.play();
      playbacks.push(playback);
    }
    return playbacks;
  }

  /**
   * A boolean indicating whether any of the sounds in the group are currently playing.
   * @returns {boolean} True if any sound is playing, false otherwise.
   */

  get isPlaying(): boolean {
    return this.sounds.some((sound) => sound.isPlaying);
  }

  /**
   * Stops all the sounds in the group.
   */

  stop(): void {
    for (const sound of this.sounds) {
      sound.stop();
    }
  }

  pause(): void {
    for (const sound of this.sounds) {
      sound.pause();
    }
  }

  loop(loopCount?: LoopCount): LoopCount {
    if (loopCount === undefined) {
      return this.loopCount;
    }
    this.loopCount = loopCount;
    for (const sound of this.sounds) {
      sound.loop(loopCount);
    }
    return this.loopCount;
  }

  addFilter(filter: BiquadFilterNode): void {
    for (const sound of this.sounds) {
      sound.addFilter(filter);
    }
  }

  removeFilter(filter: BiquadFilterNode): void {
    for (const sound of this.sounds) {
      sound.removeFilter(filter);
    }
  }

  get position(): [number, number, number] {
    return this._position;
  }

  set position(position: [number, number, number]) {
    this._position = position;
    for (const sound of this.sounds) {
      sound.position = this._position;
    }
  }

  get volume(): number {
    return (
      this.sounds.map((sound) => sound.volume).reduce((a, b) => a + b, 0) /
      this.sounds.length
    );
  }

  set volume(volume: number) {
    for (const sound of this.sounds) {
      sound.volume = volume;
    }
  }

  get playbackRate(): number {
    if (this.sounds.length === 0) {
      return 1;
    }
    const firstSound = this.sounds[0];
    return firstSound ? firstSound.playbackRate : 1;
  }

  set playbackRate(rate: number) {
    for (const sound of this.sounds) {
      sound.playbackRate = rate;
    }
  }
}
