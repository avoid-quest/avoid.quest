export type ParamFormatter = (value: number) => string;

export const paramFormatters: Record<string, ParamFormatter> = {
  bits: (value: number) => `${Math.round(value)} bits`,
  db: (value: number) => `${value.toFixed(1)} dB`,
  default: (value: number) => value.toFixed(2),
  degrees: (value: number) => `${Math.round(value)}°`,
  distance: (value: number) => `${value.toFixed(1)}`,
  frequency: (freq: number) => {
    if (freq >= 1000) {
      return `${(freq / 1000).toFixed(1)}k Hz`;
    }
    return `${freq.toFixed(0)} Hz`;
  },
  gain: (gain: number) => `${gain > 0 ? "+" : ""}${gain.toFixed(1)} dB`,
  hz: (value: number) => `${value.toFixed(2)} Hz`,
  linearGain: (value: number) => {
    if (value === 0) {
      return "-∞ dB";
    }
    const db = 20 * Math.log10(value);
    return `${db > 0 ? "+" : ""}${db.toFixed(1)} dB`;
  },
  milliseconds: (value: number) => `${value.toFixed(1)}ms`,
  pan: (pan: number) => {
    if (pan === 0) {
      return "Center";
    }
    if (pan < 0) {
      return `L ${Math.abs(pan).toFixed(2)}`;
    }
    return `R ${pan.toFixed(2)}`;
  },
  percentage: (value: number) => `${Math.round(value * 100)}%`,
  percentage100: (value: number) => `${Math.round(value)}%`,
  q: (value: number) => `Q ${value.toFixed(2)}`,
  ratio: (value: number) => `${value.toFixed(1)}:1`,
  samples: (value: number) => `${Math.round(value).toLocaleString()} samples`,
  semitones: (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)} st`,
  time: (seconds: number) => `${seconds.toFixed(2)}s`,
  timeMs: (seconds: number) => `${(seconds * 1000).toFixed(1)}ms`,
};

export function formatParam(
  key: string,
  value: number,
  customFormatter?: ParamFormatter
): string {
  if (customFormatter) {
    return customFormatter(value);
  }
  return paramFormatters[key]?.(value) ?? paramFormatters.default(value);
}
