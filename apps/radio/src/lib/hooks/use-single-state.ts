import { useLiveQuery } from "@tanstack/react-db";
import {
  type SingleStateRecord,
  singleStateCollection,
} from "@/lib/collections/single-state";

const SINGLE_STATE_ID = "single-state";

export function useSingleState(): SingleStateRecord | undefined {
  const result = useLiveQuery((q) =>
    q.from({ single: singleStateCollection }).toArray()
  );
  return result.data?.[0];
}
