import { useThrottledCallback } from "@tanstack/react-pacer";
import { useRef, useState } from "react";
import { DIRECTION_VELOCITY_THRESHOLD, SCROLL_THROTTLE_MS } from "@/lib/const";
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
  const velocityRef = useRef({ lastScrollTop: 0, lastTime: 0 });

  // Use throttled callback instead of RAF for consistent 60fps updates
  const updateScrollState = useThrottledCallback(
    (scrollTop: number) => {
      // Calculate velocity-based direction
      const now = performance.now();
      const timeDelta = now - velocityRef.current.lastTime;
      let direction: ScrollState["direction"] = "idle";

      if (timeDelta > 0) {
        const scrollDelta = scrollTop - velocityRef.current.lastScrollTop;
        const velocity = scrollDelta / timeDelta;

        // Only change direction when velocity exceeds threshold
        // This prevents rapid direction flipping during slow scrolls
        if (Math.abs(velocity) > DIRECTION_VELOCITY_THRESHOLD) {
          direction = velocity > 0 ? "forward" : "backward";
        }
      }

      velocityRef.current = { lastScrollTop: scrollTop, lastTime: now };

      // Calculate which image we're on and the progress between images
      const exactPosition = scrollTop / itemHeight;
      const currentIndex = Math.floor(exactPosition);
      const progress = exactPosition - currentIndex;

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
    { wait: SCROLL_THROTTLE_MS, leading: true, trailing: true }
  );

  return {
    scrollState,
    updateScrollState,
  };
}
