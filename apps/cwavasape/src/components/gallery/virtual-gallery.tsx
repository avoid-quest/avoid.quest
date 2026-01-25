import { Spinner } from "@avoid.quest/ui/components/spinner";
import {
  defaultRangeExtractor,
  type Range,
  useVirtualizer,
  type Virtualizer,
} from "@tanstack/react-virtual";
import { useCallback, useMemo, useRef } from "react";
import { usePins } from "@/lib/hooks/use-pins";
import { useImageSize } from "@/lib/hooks/use-settings";
import { PinImage } from "./pin-image";

const OVERSCAN_COUNT = 5;

export function VirtualGallery() {
  const parentRef = useRef<HTMLDivElement>(null);
  const activeStickyIndexRef = useRef(0);
  const imageSize = useImageSize();

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

  const allPins = useMemo(
    () => data?.pages.flatMap((page) => page.pins) ?? [],
    [data?.pages]
  );

  const itemHeight = typeof window !== "undefined" ? window.innerHeight : 800;

  const virtualizer = useVirtualizer({
    count: allPins.length || 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => itemHeight,
    overscan: OVERSCAN_COUNT,
    rangeExtractor: useCallback(
      (range: Range) => {
        const scrollTop = parentRef.current?.scrollTop ?? 0;
        const currentIndex = Math.floor(scrollTop / itemHeight);
        activeStickyIndexRef.current = currentIndex;

        const extendedRange = {
          ...range,
          startIndex: Math.max(0, currentIndex - OVERSCAN_COUNT),
          endIndex: Math.min(
            currentIndex + OVERSCAN_COUNT * 2,
            range.count - 1
          ),
        };

        const visibleRange = defaultRangeExtractor(extendedRange);
        return [
          ...new Set([activeStickyIndexRef.current, ...visibleRange]),
        ].sort((a, b) => a - b);
      },
      [itemHeight]
    ),
    onChange: useCallback(
      (instance: Virtualizer<HTMLDivElement, HTMLDivElement>) => {
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
      [allPins.length, hasNextPage, isFetchingNextPage, fetchNextPage]
    ),
  });

  const isActiveSticky = useCallback(
    (index: number) => activeStickyIndexRef.current === index,
    []
  );

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
                <PinImage
                  imageSize={imageSize}
                  index={virtualItem.index}
                  pin={pin}
                />
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
    </div>
  );
}
