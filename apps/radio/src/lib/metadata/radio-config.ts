import type { Radio } from "@/lib/audio";
import { radios as defaultRadios } from "@/lib/const";
import type { RadioMetadataConfig } from "./types";

export function getRadioMetadataConfig(
  radio: Radio | null | undefined
): RadioMetadataConfig | undefined {
  if (!radio) {
    return;
  }
  if (radio.metadataConfig) {
    return radio.metadataConfig;
  }
  return defaultRadios.find(
    (defaultRadio) => defaultRadio.streamUrl === radio.streamUrl
  )?.metadataConfig;
}
