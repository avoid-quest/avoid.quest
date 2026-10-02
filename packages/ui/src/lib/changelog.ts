/** One user-facing change. `date` is an ISO timestamp. */
export type ChangelogEntry = {
  id: string;
  date: string;
  text: string;
};

/**
 * When this browser last caught up with the changelog: null if it never did,
 * undefined when that can't be known (no storage, or server rendering).
 */
export type ChangelogSeenAt = string | null | undefined;

const listeners = new Set<() => void>();

export function getChangelogSeenAt(storageKey: string): ChangelogSeenAt {
  try {
    return localStorage.getItem(storageKey);
  } catch {
    return undefined;
  }
}

/** Records that every change up to `at` has been seen. */
export function markChangelogSeen(
  storageKey: string,
  at = new Date().toISOString()
): void {
  try {
    localStorage.setItem(storageKey, at);
  } catch {
    // Full or blocked storage: the dot may come back; nothing else breaks.
  }
  for (const listener of listeners) {
    listener();
  }
}

/** Notifies on marks from this tab and, through `storage`, from other tabs. */
export function subscribeChangelogSeen(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** A browser that never caught up has seen nothing; an unknown one, everything. */
export function isChangelogEntryUnseen(
  entry: ChangelogEntry,
  seenAt: ChangelogSeenAt
): boolean {
  if (seenAt === undefined) {
    return false;
  }
  return seenAt === null || Date.parse(entry.date) > Date.parse(seenAt);
}
