import type { Radio } from "@/lib/audio";
import { radios as defaultRadios } from "@/lib/const";
import type { RadioMetadataConfig } from "./types";

export function getRadioMetadataConfig(
  radio: Radio | null | undefined
): RadioMetadataConfig | undefined {
  if (!radio) {
    return;
  }
  const defaultRadio = defaultRadios.find(
    (candidate) => candidate.streamUrl === radio.streamUrl
  );
  if (radio.isSystem && defaultRadio?.name === radio.name) {
    return defaultRadio.metadataConfig;
  }
  if (radio.metadataConfig) {
    return radio.metadataConfig;
  }
  return defaultRadio?.metadataConfig;
}
