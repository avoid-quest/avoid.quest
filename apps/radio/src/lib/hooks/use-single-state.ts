import { eq, useLiveQuery } from "@tanstack/react-db";
import { playbackSessionsCollection } from "@/lib/collections/playback-sessions";
import {
  type SingleStateRecord,
  singleStateCollection,
} from "@/lib/collections/single-state";

const SINGLE_STATE_ID = "single-state";

export function useSingleState(): SingleStateRecord | undefined {
  const singleStateResult = useLiveQuery((q) =>
    q
      .from({ single: singleStateCollection })
      .where(({ single }) => eq(single.id, SINGLE_STATE_ID))
  );
  const playbackSessionResult = useLiveQuery((q) =>
    q
      .from({ session: playbackSessionsCollection })
      .where(({ session }) => eq(session.id, "single"))
  );

  const singleState = singleStateResult.data?.[0] as
    | SingleStateRecord
    | undefined;
  if (singleState) {
    return singleState;
  }

  const session = playbackSessionResult.data?.[0];
  const activeChannel = session?.channels.find(
    (channel) => channel.id === session.activeChannelId
  );
  if (!session) {
    return undefined;
  }

  return {
    id: SINGLE_STATE_ID,
    radio: activeChannel?.radio ?? null,
    volume: activeChannel?.volume ?? 1,
  };
}
