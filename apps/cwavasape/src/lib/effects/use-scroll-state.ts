import { useCallback, useRef, useState } from "react";
import type { ScrollState } from "./types";

const DEFAULT_SCROLL_STATE: ScrollState = {
  currentIndex: 0,
  prevIndex: -1,
  nextIndex: 1,
  progress: 0,
  direction: "idle",
};

type UseScrollStateOptions = {
  itemHeight: number;
  totalItems: number;
};

export function useScrollState({
  itemHeight,
  totalItems,
}: UseScrollStateOptions) {
  const [scrollState, setScrollState] =
    useState<ScrollState>(DEFAULT_SCROLL_STATE);
  const lastScrollTop = useRef(0);
  const rafIdRef = useRef<number | null>(null);
  const pendingScrollTop = useRef<number | null>(null);

  const updateScrollState = useCallback(
    (scrollTop: number) => {
      // Store the latest scroll position
      pendingScrollTop.current = scrollTop;

      // If we already have a RAF scheduled, skip
      if (rafIdRef.current !== null) {
        return;
      }

      // Schedule update on next animation frame
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        const currentScrollTop = pendingScrollTop.current;
        if (currentScrollTop === null) return;

        // Calculate which image we're on and the progress between images
        const exactPosition = currentScrollTop / itemHeight;
        const currentIndex = Math.floor(exactPosition);
        const progress = exactPosition - currentIndex;

        // Determine scroll direction
        let direction: ScrollState["direction"] = "idle";
        if (currentScrollTop > lastScrollTop.current + 1) {
          direction = "forward";
        } else if (currentScrollTop < lastScrollTop.current - 1) {
          direction = "backward";
        }
        lastScrollTop.current = currentScrollTop;

        // Calculate prev/next indices with bounds checking
        const prevIndex = Math.max(0, currentIndex - 1);
        const nextIndex = Math.min(totalItems - 1, currentIndex + 1);

        setScrollState({
          currentIndex: Math.min(Math.max(0, currentIndex), totalItems - 1),
          prevIndex,
          nextIndex,
          progress,
          direction,
        });
      });
    },
    [itemHeight, totalItems]
  );

  // Flush is a no-op now since RAF handles it
  const flushScrollState = useCallback(() => {
    // No-op - RAF will handle the pending update
  }, []);

  return {
    scrollState,
    updateScrollState,
    flushScrollState,
  };
}
