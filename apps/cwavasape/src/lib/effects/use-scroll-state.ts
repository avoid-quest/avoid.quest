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
  const lastUpdateTime = useRef(0);

  const updateScrollState = useCallback(
    (scrollTop: number) => {
      const now = performance.now();

      // Throttle updates to ~60fps
      if (now - lastUpdateTime.current < 16) {
        return;
      }
      lastUpdateTime.current = now;

      // Calculate which image we're on and the progress between images
      const exactPosition = scrollTop / itemHeight;
      const currentIndex = Math.floor(exactPosition);
      const progress = exactPosition - currentIndex;

      // Determine scroll direction
      let direction: ScrollState["direction"] = "idle";
      if (scrollTop > lastScrollTop.current + 1) {
        direction = "forward";
      } else if (scrollTop < lastScrollTop.current - 1) {
        direction = "backward";
      }
      lastScrollTop.current = scrollTop;

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
    },
    [itemHeight, totalItems]
  );

  return {
    scrollState,
    updateScrollState,
  };
}
