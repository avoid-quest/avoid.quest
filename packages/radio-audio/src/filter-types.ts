export type FilterType =
  | "lowpass"
  | "highpass"
  | "bandpass"
  | "lowshelf"
  | "highshelf"
  | "peaking"
  | "notch"
  | "allpass";

export type FilterConfig = {
  type: FilterType;
  frequency: number;
  Q: number;
  gain: number;
  enabled: boolean;
};
