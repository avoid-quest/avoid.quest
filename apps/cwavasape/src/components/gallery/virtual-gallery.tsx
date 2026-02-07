import type { ImageSize, PinResponse } from "@avoid.quest/pinterest";
import { Spinner } from "@avoid.quest/ui/components/spinner";
import { useThrottledCallback } from "@tanstack/react-pacer";
import {
  defaultRangeExtractor,
  type Range,
  useVirtualizer,
  type Virtualizer,
} from "@tanstack/react-virtual";
import { useCallback, useEffect, useRef } from "react";
import {
  DEFAULT_IMAGE_SIZE,
  DEFAULT_SCROLL_SENSITIVITY,
  FETCH_THROTTLE_MS,
  WHEEL_THROTTLE_MS,
} from "@/lib/const";
import {
  canRenderEffects,
  useCapabilities,
  useScrollState,
} from "@/lib/effects";
import { useAudio } from "@/lib/hooks/use-audio";
import { usePins } from "@/lib/hooks/use-pins";
import { useSettings } from "@/lib/hooks/use-settings";
import { EffectsCanvas } from "./effects-canvas";
import { PinImage } from "./pin-image";

const OVERSCAN_COUNT = 5;

export function VirtualGallery() {
  const parentRef = useRef<HTMLDivElement>(null);
  const activeStickyIndexRef = useRef(0);
  const itemHeightRef = useRef(
    typeof window !== "undefined" ? window.innerHeight : 800
  );

  const { data: settings } = useSettings();
  const imageSize = settings?.imageSize ?? DEFAULT_IMAGE_SIZE;
  const scrollSensitivity =
    settings?.scrollSensitivity ?? DEFAULT_SCROLL_SENSITIVITY;
  const capabilities = useCapabilities();

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isError,
    error,
    refetch,
    isLoading,
  } = usePins();

  const allPins = data?.pages.flatMap((page) => page.pins) ?? [];

  // Gate effects on data availability to prevent race condition on hard refresh
  const effectsActive =
    (settings?.effectsEnabled ?? false) &&
    canRenderEffects(capabilities) &&
    allPins.length > 0;

  useEffect(() => {
    const updateHeight = () => {
      itemHeightRef.current = window.innerHeight;
    };
    // Set correct height on mount (SSR may have different value)
    updateHeight();
    window.addEventListener("resize", updateHeight);
    return () => window.removeEventListener("resize", updateHeight);
  }, []);

  // Throttled wheel handler for custom scroll sensitivity (when effects off)
  const throttledWheelHandler = useThrottledCallback(
    (deltaY: number) => {
      if (parentRef.current) {
        parentRef.current.scrollTop += deltaY * scrollSensitivity;
      }
    },
    { wait: WHEEL_THROTTLE_MS, leading: true, trailing: true }
  );

  // When effects are active, we need to manually forward wheel events
  // because the canvas overlay intercepts them
  // Also directly update scroll state to ensure EffectsCanvas updates
  useEffect(() => {
    if (!effectsActive) {
      return;
    }

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const scrollElement = parentRef.current;
      if (scrollElement) {
        scrollElement.scrollTop += e.deltaY * scrollSensitivity;
        // Directly update scroll state since scroll events may not fire reliably
        updateScrollStateRef.current(scrollElement.scrollTop);
      }
    };

    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => window.removeEventListener("wheel", handleWheel);
  }, [effectsActive, scrollSensitivity]);

  // Custom scroll sensitivity when effects are off
  useEffect(() => {
    if (effectsActive || scrollSensitivity === 1.0) {
      return;
    }

    const scrollElement = parentRef.current;
    if (!scrollElement) {
      return;
    }

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      throttledWheelHandler(e.deltaY);
    };

    scrollElement.addEventListener("wheel", handleWheel, { passive: false });
    return () => scrollElement.removeEventListener("wheel", handleWheel);
  }, [effectsActive, scrollSensitivity, throttledWheelHandler]);

  // Throttle fetchNextPage to prevent rapid pagination calls during fast scrolling
  const throttledFetchNextPage = useThrottledCallback(
    () => {
      if (hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    },
    { wait: FETCH_THROTTLE_MS, leading: true, trailing: false }
  );

  // Helper to get image URL for a pin at given index
  const getImageUrl = useCallback(
    (index: number): string | undefined => {
      const pin: PinResponse | undefined = allPins[index];
      // imageSize from settings is compatible with ImageSize from pinterest
      const size: ImageSize = imageSize;
      return pin?.images[size]?.url;
    },
    [allPins, imageSize]
  );

  const itemHeight = itemHeightRef.current;

  // Scroll state for effects canvas
  const { scrollState, updateScrollState } = useScrollState({
    itemHeight,
    totalItems: allPins.length,
  });

  useAudio({
    scrollRef: parentRef,
    itemHeight,
    audioEnabled: settings?.audioEnabled ?? false,
    audioVolume: settings?.audioVolume ?? 0.5,
  });

  // Use ref to avoid re-attaching listener when callback changes
  const updateScrollStateRef = useRef(updateScrollState);
  updateScrollStateRef.current = updateScrollState;

  // Update scroll state on scroll
  useEffect(() => {
    const scrollElement = parentRef.current;
    if (!scrollElement) {
      return;
    }

    const handleScroll = () => {
      updateScrollStateRef.current(scrollElement.scrollTop);
    };

    scrollElement.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      scrollElement.removeEventListener("scroll", handleScroll);
    };
  }, []);

  const virtualizer = useVirtualizer({
    count: allPins.length || 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => itemHeight,
    overscan: OVERSCAN_COUNT,
    rangeExtractor: (range: Range) => {
      const scrollTop = parentRef.current?.scrollTop ?? 0;
      const currentIndex = Math.floor(scrollTop / itemHeightRef.current);
      activeStickyIndexRef.current = currentIndex;

      const extendedRange = {
        ...range,
        startIndex: Math.max(0, currentIndex - OVERSCAN_COUNT),
        endIndex: Math.min(currentIndex + OVERSCAN_COUNT * 2, range.count - 1),
      };

      const visibleRange = defaultRangeExtractor(extendedRange);
      return [...new Set([activeStickyIndexRef.current, ...visibleRange])].sort(
        (a, b) => a - b
      );
    },
    onChange: (instance: Virtualizer<HTMLDivElement, HTMLDivElement>) => {
      if (!hasNextPage || isFetchingNextPage) {
        return;
      }

      if (instance.isScrolling && instance.scrollDirection === "forward") {
        const lastItem = instance.getVirtualItems().at(-1);
        if (!lastItem) {
          return;
        }

        const remainingItems = allPins.length - lastItem.index;
        if (remainingItems <= OVERSCAN_COUNT * 2) {
          throttledFetchNextPage();
        }
      }
    },
  });

  const isActiveSticky = (index: number) =>
    activeStickyIndexRef.current === index;

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-black">
        <Spinner className="size-8 text-white" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-black text-white">
        <p className="text-red-400">
          {error instanceof Error ? error.message : "Failed to load pins"}
        </p>
        <button
          className="rounded-lg bg-white/10 px-4 py-2 hover:bg-white/20"
          onClick={() => refetch()}
          type="button"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!allPins.length) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-black text-white/60">
        No pins found. Try a different username.
      </div>
    );
  }

  return (
    <div className="relative h-screen w-full">
      <div
        className="relative z-0 h-full w-full touch-pan-y overflow-y-scroll"
        ref={parentRef}
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const pin = allPins[virtualItem.index];
            const activeSticky = isActiveSticky(virtualItem.index);

            if (!pin) {
              return null;
            }

            return (
              <div
                className="w-full"
                data-index={virtualItem.index}
                key={virtualItem.key}
                ref={virtualizer.measureElement}
                style={{
                  height: `${itemHeight}px`,
                  position: activeSticky ? "sticky" : "absolute",
                  transform: activeSticky
                    ? undefined
                    : `translateY(${virtualItem.start}px)`,
                  top: 0,
                  left: 0,
                  zIndex: activeSticky ? 1 : 0,
                }}
              >
                {effectsActive ? null : (
                  <PinImage
                    imageSize={imageSize}
                    index={virtualItem.index}
                    pin={pin}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {isFetchingNextPage && (
        <div className="fixed right-4 bottom-4 z-50 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 backdrop-blur">
          <Spinner className="size-5 text-white" />
        </div>
      )}

      {effectsActive && (
        <EffectsCanvas
          analysisEffects={settings?.analysisEffects}
          currentImageUrl={getImageUrl(scrollState.currentIndex)}
          currentIndex={scrollState.currentIndex}
          nextImageUrl={getImageUrl(scrollState.nextIndex)}
          prevImageUrl={getImageUrl(scrollState.prevIndex)}
          scrollProgress={scrollState.progress}
        />
      )}
    </div>
  );
}
