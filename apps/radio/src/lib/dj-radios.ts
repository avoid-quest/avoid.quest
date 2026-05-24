import type { Radio } from "@/lib/types";

export function getDjRadios(radioRecords: Radio[] | undefined): Radio[] {
  return radioRecords ?? [];
}
