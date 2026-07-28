import type { Radio } from "@/lib/audio";
import type { UnifiedRadioSearchResult } from "@/lib/hooks/use-unified-radio-search";

export function toDjBrowserRadio(result: UnifiedRadioSearchResult): Radio {
  const location = [result.location, result.country].filter(Boolean).join(", ");
  return {
    ...result.action.radio,
    description:
      location || result.description || result.action.radio.description,
  };
}
