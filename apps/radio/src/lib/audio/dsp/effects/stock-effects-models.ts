import { BiquadFilter } from "./biquad-filter.js";
import { clamp, dbToGain } from "./stock-effect-utils.js";
import type { StereoChannels } from "./types.js";

const WERKSTATT_RETURN_PREFIX = /^return\s+/;
const WERKSTATT_TRAILING_SEMICOLON = /;\s*$/;
const WERKSTATT_FORBIDDEN_SOURCE =
  /(?:\b(?:for|while|do|function|class|new|this|globalThis|self|constructor|prototype|import|eval)\b|[[\]{}"'`;])/;
const WERKSTATT_IDENTIFIER = /[A-Za-z_$][\w$]*/g;

type WerkstattBlockProcessor = {
  paramChanged?: (label: string, value: number) => void;
  process: (
    audio: { src: StereoChannels; out: StereoChannels },
    block: { s0: number; s1: number; flags: number }
  ) => void;
};

export class NeuralAmpEffect {
  private drive = 0;
  private tone = 0.5;
  private presence = 0.5;
  private output = -6;
  private mono = false as boolean;
  private mix = 1;
  private modelAvailable = false as boolean;
  private readonly highPass: BiquadFilter;
  private readonly lowPass: BiquadFilter;

  constructor(sampleRate: number) {
    this.highPass = new BiquadFilter(sampleRate);
    this.highPass.type = "highpass";
    this.highPass.frequency = 70;
    this.highPass.Q = 0.7;
    this.lowPass = new BiquadFilter(sampleRate);
    this.lowPass.type = "lowpass";
    this.lowPass.frequency = 6500;
    this.lowPass.Q = 0.7;
  }

  setInput(value: number): void {
    this.drive = clamp(value, -72, 12);
  }

  setTone(value: number): void {
    this.tone = clamp(value, 0, 1);
    this.lowPass.frequency = 1800 + this.tone * 10_000;
  }

  setPresence(value: number): void {
    this.presence = clamp(value, 0, 1);
    this.highPass.frequency = 35 + this.presence * 135;
  }

  setOutput(value: number): void {
    this.output = clamp(value, -48, 12);
  }

  setCabinetEnabled(value: boolean): void {
    this.lowPass.frequency = value ? 6500 : 19_000;
  }

  setMono(value: boolean): void {
    this.mono = value;
  }

  setMix(value: number): void {
    this.mix = clamp(value, 0, 1);
  }

  setModelAvailable(value: boolean): void {
    this.modelAvailable = value;
    if (!value) {
      this.reset();
    }
  }

  reset(): void {
    this.highPass.reset();
    this.lowPass.reset();
  }

  process(
    input: StereoChannels,
    output: StereoChannels,
    fromIndex: number,
    toIndex: number
  ): void {
    if (!this.modelAvailable) {
      output[0].set(input[0].subarray(fromIndex, toIndex), fromIndex);
      output[1].set(input[1].subarray(fromIndex, toIndex), fromIndex);
      return;
    }
    this.highPass.process(input, output, fromIndex, toIndex);
    const drive = dbToGain(this.drive);
    const makeup = dbToGain(this.output);
    for (let i = fromIndex; i < toIndex; i += 1) {
      output[0][i] = Math.tanh((output[0][i] ?? 0) * drive) * makeup;
      output[1][i] = Math.tanh((output[1][i] ?? 0) * drive) * makeup;
    }
    this.lowPass.process(output, output, fromIndex, toIndex);
    for (let i = fromIndex; i < toIndex; i += 1) {
      const left = input[0][i] ?? 0;
      const right = input[1][i] ?? 0;
      const processedLeft = output[0][i] ?? 0;
      const processedRight = output[1][i] ?? 0;
      const mono = (processedLeft + processedRight) * 0.5;
      output[0][i] =
        left * (1 - this.mix) + (this.mono ? mono : processedLeft) * this.mix;
      output[1][i] =
        right * (1 - this.mix) + (this.mono ? mono : processedRight) * this.mix;
    }
  }
}

export class WerkstattEffect {
  private readonly sampleRate: number;
  private blockProcessor: WerkstattBlockProcessor | null = null;
  private sampleFunction: (input: number, channel: number) => number = (
    input
  ) => input;
  private source = "return input;" as string;
  private parameters: Record<string, number> = {};
  private failed = false as boolean;
  private parameterA = 0.5;
  private parameterB = 0.5;
  private phase = 0;
  private heldL = 0;
  private heldR = 0;
  private resetPending = false as boolean;

  constructor(sampleRate = 48_000) {
    this.sampleRate = sampleRate;
  }

  setSource(value: string): void {
    const source = value.trim();
    this.source = source;
    this.blockProcessor = null;
    this.failed = false;
    this.resetPending = true;
    if (source === "ring" || source === "rectify" || source === "sampleHold") {
      return;
    }
    if (source.includes("class Processor")) {
      try {
        const Processor = Function(
          "sampleRate",
          `"use strict"; ${source}\nreturn Processor;`
        )(this.sampleRate) as new () => WerkstattBlockProcessor;
        const blockProcessor = new Processor();
        if (typeof blockProcessor.process !== "function") {
          throw new Error("Werkstatt Processor must define process()");
        }
        this.blockProcessor = blockProcessor;
        this.applyBlockParameters();
      } catch {
        this.failed = true;
      }
      return;
    }
    const expression = source
      .replace(WERKSTATT_RETURN_PREFIX, "")
      .replace(WERKSTATT_TRAILING_SEMICOLON, "")
      .trim();
    const identifiers = expression.match(WERKSTATT_IDENTIFIER) ?? [];
    const allowedIdentifiers = new Set([
      "input",
      "channel",
      "sampleRate",
      "p",
      "Math",
      ...Object.getOwnPropertyNames(Math),
      ...Object.keys(this.parameters),
    ]);
    if (
      !expression ||
      WERKSTATT_FORBIDDEN_SOURCE.test(expression) ||
      identifiers.some((identifier) => !allowedIdentifiers.has(identifier))
    ) {
      this.failed = true;
      this.sampleFunction = (input) => input;
      return;
    }
    try {
      const evaluate = Function(
        "input",
        "channel",
        "sampleRate",
        "p",
        `"use strict"; return (${expression});`
      ) as (
        input: number,
        channel: number,
        sampleRate: number,
        parameters: Readonly<Record<string, number>>
      ) => unknown;
      this.sampleFunction = (input, channel) => {
        const result = evaluate(
          input,
          channel,
          this.sampleRate,
          this.parameters
        );
        return typeof result === "number" && Number.isFinite(result)
          ? result
          : input;
      };
    } catch {
      this.failed = true;
      this.sampleFunction = (input) => input;
    }
  }

  setParameters(value: Partial<Record<string, number>>): void {
    this.parameters = Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, number] =>
        Number.isFinite(entry[1])
      )
    );
    this.parameterA = clamp(
      value.a ?? value.parameterA ?? this.parameterA,
      0,
      1
    );
    this.parameterB = clamp(
      value.b ?? value.parameterB ?? this.parameterB,
      0,
      1
    );
    if (this.blockProcessor) {
      this.applyBlockParameters();
      return;
    }
    this.setSource(this.source);
  }

  reset(): void {
    this.phase = 0;
    this.heldL = 0;
    this.heldR = 0;
    this.resetPending = true;
  }

  process(
    input: StereoChannels,
    output: StereoChannels,
    fromIndex: number,
    toIndex: number
  ): void {
    if (this.blockProcessor) {
      try {
        this.blockProcessor.process(
          { out: output, src: input },
          {
            flags: this.resetPending ? 2 : 0,
            s0: fromIndex,
            s1: toIndex,
          }
        );
        this.resetPending = false;
        return;
      } catch {
        this.failed = true;
        this.blockProcessor = null;
      }
    }
    for (let i = fromIndex; i < toIndex; i += 1) {
      const left = input[0][i] ?? 0;
      const right = input[1][i] ?? 0;
      switch (this.source) {
        case "ring": {
          const carrier = Math.sin(this.phase * Math.PI * 2);
          output[0][i] = left * carrier;
          output[1][i] = right * carrier;
          this.phase = (this.phase + 0.0002 + this.parameterA * 0.05) % 1;
          break;
        }
        case "rectify":
          output[0][i] =
            left * (1 - this.parameterA) + Math.abs(left) * this.parameterA;
          output[1][i] =
            right * (1 - this.parameterA) + Math.abs(right) * this.parameterA;
          break;
        case "sampleHold": {
          this.phase += 0.001 + this.parameterA * 0.2;
          if (this.phase >= 1) {
            this.phase %= 1;
            this.heldL = left;
            this.heldR = right;
          }
          output[0][i] = this.heldL * (0.25 + this.parameterB * 0.75);
          output[1][i] = this.heldR * (0.25 + this.parameterB * 0.75);
          break;
        }
        default:
          if (this.failed) {
            output[0][i] = left;
            output[1][i] = right;
            break;
          }
          try {
            output[0][i] = this.sampleFunction(left, 0);
            output[1][i] = this.sampleFunction(right, 1);
          } catch {
            this.failed = true;
            output[0][i] = left;
            output[1][i] = right;
          }
      }
    }
  }

  private applyBlockParameters(): void {
    if (!this.blockProcessor?.paramChanged) {
      return;
    }
    try {
      for (const [label, value] of Object.entries(this.parameters)) {
        this.blockProcessor.paramChanged(label, value);
      }
    } catch {
      this.failed = true;
      this.blockProcessor = null;
    }
  }
}
