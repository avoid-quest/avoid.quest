type PendingChannelStart = { cancelled: boolean; channelId: string };

/** Cancellation ownership while a start resolves a track or waits for a lane. */
export function createPendingChannelStarts() {
  const pendingStarts = new Set<PendingChannelStart>();

  return {
    begin(channelId: string, isCurrent = () => true) {
      const pending: PendingChannelStart = { cancelled: false, channelId };
      pendingStarts.add(pending);
      return {
        isCurrent: () => !pending.cancelled && isCurrent(),
        /**
         * Release before replacing this start's own source. Releasing ends
         * cancellation tracking; it does not erase an earlier cancellation
         * or stop checking the caller's ownership.
         */
        release: () => {
          pendingStarts.delete(pending);
        },
      };
    },
    cancel(channelId?: string) {
      for (const pending of pendingStarts) {
        if (!channelId || pending.channelId === channelId) {
          pending.cancelled = true;
        }
      }
    },
  };
}
