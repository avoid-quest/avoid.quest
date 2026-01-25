import type { PinResponse } from "@avoid.quest/pinterest";
import { Spinner } from "@avoid.quest/ui/components/spinner";
import {
  defaultRangeExtractor,
  type Range,
  useVirtualizer,
  type Virtualizer,
} from "@tanstack/react-virtual";
import { useCallback, useEffect, useRef } from "react";
import { DEFAULT_IMAGE_SIZE, DEFAULT_SCROLL_SENSITIVITY } from "@/lib/const";
import {
  canRenderEffects,
  useCapabilities,
  useScrollState,
} from "@/lib/effects";
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
  const effectsActive =
    (settings?.effectsEnabled ?? false) && canRenderEffects(capabilities);

  useEffect(() => {
    const updateHeight = () => {
      itemHeightRef.current = window.innerHeight;
    };
    window.addEventListener("resize", updateHeight);
    return () => window.removeEventListener("resize", updateHeight);
  }, []);

  useEffect(() => {
    const scrollElement = parentRef.current;
    if (!scrollElement) {
      return;
    }

    // Skip custom handling when sensitivity is default
    if (scrollSensitivity === 1.0) {
      return;
    }

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      scrollElement.scrollTop += e.deltaY * scrollSensitivity;
    };

    scrollElement.addEventListener("wheel", handleWheel, { passive: false });
    return () => scrollElement.removeEventListener("wheel", handleWheel);
  }, [scrollSensitivity]);

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

  // Helper to get image URL for a pin at given index
  const getImageUrl = useCallback(
    (index: number): string | undefined => {
      const pin: PinResponse | undefined = allPins[index];
      return pin?.images[imageSize as keyof typeof pin.images]?.url;
    },
    [allPins, imageSize]
  );

  const itemHeight = itemHeightRef.current;

  // Scroll state for effects canvas
  const { scrollState, updateScrollState } = useScrollState({
    itemHeight,
    totalItems: allPins.length,
  });

  // Update scroll state on scroll
  useEffect(() => {
    const scrollElement = parentRef.current;
    if (!scrollElement) {
      return;
    }

    const handleScroll = () => {
      updateScrollState(scrollElement.scrollTop);
    };

    scrollElement.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      scrollElement.removeEventListener("scroll", handleScroll);
    };
  }, [updateScrollState]);

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
          fetchNextPage();
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
        className="h-full w-full overflow-auto"
        ref={parentRef}
        style={{
          contain: "strict",
          scrollBehavior: "auto",
          WebkitOverflowScrolling: "touch",
        }}
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
                {effectsActive ? (
                  // Empty placeholder to maintain scroll height when effects handle rendering
                  <div className="h-full w-full" />
                ) : (
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

      <EffectsCanvas
        analysisEffects={settings?.analysisEffects}
        currentImageUrl={getImageUrl(scrollState.currentIndex)}
        currentIndex={scrollState.currentIndex}
        nextImageUrl={getImageUrl(scrollState.nextIndex)}
        prevImageUrl={getImageUrl(scrollState.prevIndex)}
        scrollProgress={scrollState.progress}
      />
    </div>
  );
}
