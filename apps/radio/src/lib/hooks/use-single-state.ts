import { eq, useLiveQuery } from "@tanstack/react-db";
import {
  SINGLE_STATE_ID,
  type SingleStateRecord,
  singleStateCollection,
} from "@/lib/collections/single-state";

export function useSingleState(): SingleStateRecord | undefined {
  const result = useLiveQuery((q) =>
    q
      .from({ single: singleStateCollection })
      .where(({ single }) => eq(single.id, SINGLE_STATE_ID))
  );
  return result.data?.[0] as SingleStateRecord | undefined;
}
