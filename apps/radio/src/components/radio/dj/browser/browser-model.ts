import type { Radio } from "@/lib/audio";
import type { UnifiedRadioSearchResult } from "@/lib/hooks/use-unified-radio-search";
import { formatLocation } from "../../station-row";

export function toDjBrowserRadio(result: UnifiedRadioSearchResult): Radio {
  const location = formatLocation(result.location, result.country);
  return {
    ...result.action.radio,
    description:
      location || result.description || result.action.radio.description,
  };
}
