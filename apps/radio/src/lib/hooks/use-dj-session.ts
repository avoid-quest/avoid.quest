import { useRef, useSyncExternalStore } from "react";
import {
  getPlaybackSession,
  type PlaybackSessionId,
  type PlaybackSessionRecord,
  playbackSessionsCollection,
} from "@/lib/collections/playback-sessions";

/** Collection drafts may clone untouched nested fields too. */
export function equalSessionSelection(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (!(a && b && typeof a === "object" && typeof b === "object")) {
    return false;
  }
  const left = Object.keys(a);
  return (
    left.length === Object.keys(b).length &&
    left.every(
      (key) =>
        Object.hasOwn(b, key) &&
        equalSessionSelection(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key]
        )
    )
  );
}

function subscribe(listener: () => void): () => void {
  const subscription = playbackSessionsCollection.subscribeChanges(listener);
  return () => subscription.unsubscribe();
}

/** Subscribe to selected values, retaining unchanged snapshots. */
export function usePlaybackSessionSelector<T>(
  sessionId: PlaybackSessionId,
  select: (session: PlaybackSessionRecord | undefined) => T
): T {
  const cache = useRef<{ value: T } | undefined>(undefined);
  const serverCache = useRef<{ value: T } | undefined>(undefined);
  const snapshot = () => {
    const value = select(getPlaybackSession(sessionId));
    if (!(cache.current && equalSessionSelection(cache.current.value, value))) {
      cache.current = { value };
    }
    return cache.current.value;
  };
  const serverSnapshot = () => {
    const value = select(undefined);
    if (
      !(
        serverCache.current &&
        equalSessionSelection(serverCache.current.value, value)
      )
    ) {
      serverCache.current = { value };
    }
    return serverCache.current.value;
  };
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

export function useDjSession(): PlaybackSessionRecord | undefined {
  return usePlaybackSessionSelector("dj", (session) => session);
}

export function useDjTempo(): number {
  return usePlaybackSessionSelector("dj", (session) => session?.tempo ?? 120);
}
