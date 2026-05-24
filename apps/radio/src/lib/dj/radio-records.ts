import type { Radio } from "@/lib/audio";
import type { RadioRecord } from "@/lib/collections";

export function radioRecordsToDjRadios(
  radioRecords: RadioRecord[] | undefined
): Radio[] {
  return radioRecords?.map((radioRecord) => ({ ...radioRecord })) ?? [];
}
