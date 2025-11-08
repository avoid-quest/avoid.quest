import type { Synth } from "./synth.js";

export class SynthGroup {
  synths: Synth[] = [];

  constructor(synths: Synth[] = []) {
    this.synths = synths;
  }

  addSynth(synth: Synth) {
    this.synths.push(synth);
  }

  removeSynth(synth: Synth) {
    const index = this.synths.indexOf(synth);
    if (index !== -1) {
      this.synths.splice(index, 1);
    } else {
      throw new Error("Synth not found in group");
    }
  }

  play() {
    for (const synth of this.synths) {
      synth.play();
    }
  }

  stop() {
    for (const synth of this.synths) {
      synth.stop();
    }
  }

  setVolume(volume: number) {
    for (const synth of this.synths) {
      synth.volume = volume;
    }
  }

  set stereoPan(pan: number) {
    for (const synth of this.synths) {
      synth.stereoPan = pan;
    }
  }

  set position(position: [number, number, number]) {
    for (const synth of this.synths) {
      synth.position = position;
    }
  }
}
