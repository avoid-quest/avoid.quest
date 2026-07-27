export const dbToGain = (value: number): number => 10 ** (value / 20);
export const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));
