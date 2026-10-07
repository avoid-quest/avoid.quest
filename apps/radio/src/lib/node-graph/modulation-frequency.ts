import { PPQN } from "@opendaw/lib-dsp";
export const NATIVE_TYPES = new Set(["lfo", "steps", "randomiser", "macro"]);

export function modulationFrequency(data: {
  rate: number;
  sync: string;
  tempo: number;
}): number {
  if (data.sync === "Off") {
    return data.rate;
  }
  const [numerator, denominator] = data.sync.split("/").map(Number);
  return (
    data.rate +
    1 /
      PPQN.pulsesToSeconds(
        PPQN.fromSignature(numerator, denominator),
        data.tempo
      )
  );
}
