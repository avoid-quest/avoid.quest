import { Ramp, StereoMatrix, dbToGain, RenderQuantum } from "@opendaw/lib-dsp";
import { type int } from "@opendaw/lib-std";

export class ChannelStrip {
  private volume: number = 0; // dB
  private pan: number = 0; // -1 to 1
  private isMuted: boolean = false;
  private isSoloed: boolean = false;

  private gainL: Ramp<number>;
  private gainR: Ramp<number>;
  private outGain: Ramp<number>;
  
  private updateGain: boolean = true;
  private processing: boolean = false;

  constructor(sampleRate: number) {
    this.gainL = Ramp.linear(sampleRate);
    this.gainR = Ramp.linear(sampleRate);
    this.outGain = Ramp.linear(sampleRate);
  }

  setVolume(db: number) {
    if (this.volume !== db) {
      this.volume = db;
      this.updateGain = true;
    }
  }

  setPan(pan: number) {
    if (this.pan !== pan) {
      this.pan = pan;
      this.updateGain = true;
    }
  }

  setMute(mute: boolean) {
    if (this.isMuted !== mute) {
      this.isMuted = mute;
      this.updateGain = true;
    }
  }

  process(
    inputL: Float32Array,
    inputR: Float32Array,
    outputL: Float32Array,
    outputR: Float32Array,
    fromIndex: int,
    toIndex: int
  ) {
    if (this.updateGain) {
      const gain = dbToGain(this.volume);
      const panning = this.pan;
      const silent = this.isMuted; // Add solo logic later

      this.gainL.set((1.0 - Math.max(0.0, panning)) * gain, this.processing);
      this.gainR.set((1.0 + Math.min(0.0, panning)) * gain, this.processing);
      this.outGain.set(silent ? 0.0 : 1.0, this.processing);
      this.updateGain = false;
    }

    if (
      this.gainL.isInterpolating() ||
      this.gainR.isInterpolating() ||
      this.outGain.isInterpolating()
    ) {
      for (let i = fromIndex; i < toIndex; i++) {
        const gain = this.outGain.moveAndGet();
        const l = (inputL[i] ?? 0) * this.gainL.moveAndGet();
        const r = (inputR[i] ?? 0) * this.gainR.moveAndGet();
        outputL[i] = l * gain;
        outputR[i] = r * gain;
      }
    } else {
      const gainL = this.gainL.get();
      const gainR = this.gainR.get();
      const outGain = this.outGain.get();
      for (let i = fromIndex; i < toIndex; i++) {
        const l = (inputL[i] ?? 0) * gainL;
        const r = (inputR[i] ?? 0) * gainR;
        outputL[i] = l * outGain;
        outputR[i] = r * outGain;
      }
    }
    this.processing = true;
  }
}
