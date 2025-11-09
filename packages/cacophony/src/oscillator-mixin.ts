/** biome-ignore-all lint/complexity/noUselessConstructor: Required for mixin pattern */
/** biome-ignore-all lint/suspicious/noExplicitAny: Required for mixin pattern */
import type { BasePlayback } from "./base-playback.js";
import type { OscillatorNode } from "./context.js";

export type OscillatorCloneOverrides = {
  oscillatorOptions?: Partial<OscillatorOptions>;
};

type Constructor<T = BasePlayback> = abstract new (...args: unknown[]) => T;

export function OscillatorMixin<TBase extends Constructor>(Base: TBase) {
  // @ts-expect-error - Mixin constructor pattern requirement and protected property export limitation
  abstract class OscillatorMixinClass extends Base {
    constructor(...args: any[]) {
      super(...args);
    }
    _oscillatorOptions: Partial<OscillatorOptions> = {};
    declare source?: OscillatorNode;

    get oscillatorOptions(): Partial<OscillatorOptions> {
      return this._oscillatorOptions;
    }

    set oscillatorOptions(options: Partial<OscillatorOptions>) {
      this._oscillatorOptions = options;
      if (this.source && this.source instanceof OscillatorNode) {
        if (this.oscillatorOptions.detune) {
          this.source.detune.value = this.oscillatorOptions.detune;
        }
        if (this.oscillatorOptions.frequency) {
          this.source.frequency.value = this.oscillatorOptions.frequency;
        }
        if (this.oscillatorOptions.type) {
          this.source.type = this.oscillatorOptions.type;
        }
      }
    }

    play(): [this] {
      if (!this.source) {
        throw new Error("No source node found");
      }
      if (this.oscillatorOptions.detune) {
        this.source.detune.value = this.oscillatorOptions.detune;
      }
      if (this.oscillatorOptions.frequency) {
        this.source.frequency.value = this.oscillatorOptions.frequency;
      }
      if (this.oscillatorOptions.type) {
        this.source.type = this.oscillatorOptions.type;
      }
      this.source.start();
      this._playing = true;
      return [this];
    }

    stop() {
      if (this.source?.stop) {
        this.source.stop();
        this._playing = false;
      }
    }

    pause(): void {
      this.stop();
    }

    get frequency(): number {
      if (!this.source) {
        throw new Error(
          "Cannot get frequency of a sound that has been cleaned up"
        );
      }
      return this.source.frequency.value;
    }

    set frequency(frequency: number) {
      if (!this.source) {
        throw new Error(
          "Cannot set frequency of a sound that has been cleaned up"
        );
      }
      this.source.frequency.value = frequency;
      this.oscillatorOptions.frequency = frequency;
    }

    get detune(): number {
      if (!this.source) {
        throw new Error(
          "Cannot get detune of a sound that has been cleaned up"
        );
      }
      return this.source.detune.value;
    }

    set detune(detune: number) {
      if (!this.source) {
        throw new Error(
          "Cannot set detune of a sound that has been cleaned up"
        );
      }
      this.source.detune.value = detune;
      this.oscillatorOptions.detune = detune;
    }

    get type(): OscillatorType {
      if (!this.source) {
        throw new Error("Cannot get type of a sound that has been cleaned up");
      }
      return this.source.type;
    }

    set type(type: OscillatorType) {
      if (!this.source) {
        throw new Error("Cannot set type of a sound that has been cleaned up");
      }
      this.source.type = type;
      this.oscillatorOptions.type = type;
    }
  }
  return OscillatorMixinClass;
}
