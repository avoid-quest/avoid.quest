/**
 * MIDI System Types
 *
 * Shared type definitions for the MIDI subsystem.
 */

/** Target address for a MIDI-controllable parameter (e.g. "deck-a:volume", "deck-a:effect:<id>:delayTime") */
export type MidiTargetId = string;

export type MidiMessageType = "cc" | "note";

export type MidiTransform = {
  invert: boolean;
  min: number;
  max: number;
  curve: "linear" | "log" | "exp";
};

export const DEFAULT_TRANSFORM: MidiTransform = {
  curve: "linear",
  invert: false,
  max: 1,
  min: 0,
};

/** Apply transform pipeline: invert -> curve -> range clamp */
export function applyTransform(
  normalized: number,
  transform: Partial<MidiTransform>
): number {
  const t: MidiTransform = { ...DEFAULT_TRANSFORM, ...transform };
  let v = normalized;

  // Invert
  if (t.invert) {
    v = 1 - v;
  }

  // Curve
  switch (t.curve) {
    case "log":
      // Log curve (0->0, 1->1 with logarithmic response)
      v = v <= 0 ? 0 : Math.log1p(v * (Math.E - 1));
      break;
    case "exp":
      // Exponential curve (0->0, 1->1 with exp response)
      v = (Math.exp(v) - 1) / (Math.E - 1);
      break;
    default:
      // "linear" — no transform
      break;
  }

  // Range mapping: 0-1 -> min-max
  v = t.min + v * (t.max - t.min);

  // Clamp
  const lo = Math.min(t.min, t.max);
  const hi = Math.max(t.min, t.max);
  return Math.max(lo, Math.min(hi, v));
}

export type MidiMapping = {
  channel: number;
  control: number;
  type: MidiMessageType;
  targetId: MidiTargetId;
  transform?: MidiTransform;
};

export type MidiAction = {
  targetId: MidiTargetId;
  label: string;
  group: string;
  type: "button" | "continuous";
  dispatch: (value: number) => void;
  range?: { min: number; max: number; step: number };
};

export type MidiDeviceInfo = {
  id: string;
  name: string;
  manufacturer: string;
  state: "connected" | "disconnected";
  type: "input" | "output";
};
