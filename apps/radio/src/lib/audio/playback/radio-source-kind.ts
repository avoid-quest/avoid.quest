import type { Radio } from "./types.js";

/** Source-node provenance; media nodes can hold imported files without metadata. */
export type RadioSourceKind = "station" | "media";

export function isLiveRadioSource(
  radio: Radio,
  sourceKind?: RadioSourceKind
): boolean {
  const platform = radio.platformMetadata?.platform;
  return (
    platform === "radio-browser" ||
    platform === "radiogarden" ||
    (!platform && sourceKind !== "media")
  );
}
