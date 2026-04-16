import { eq, useLiveQuery } from "@tanstack/react-db";
import {
  type PlaybackSessionRecord,
  playbackSessionsCollection,
} from "@/lib/collections/playback-sessions";

export function useDjSession(): PlaybackSessionRecord | undefined {
  const result = useLiveQuery((q) =>
    q
      .from({ session: playbackSessionsCollection })
      .where(({ session }) => eq(session.id, "dj"))
  );
  return result.data?.[0] as PlaybackSessionRecord | undefined;
}
