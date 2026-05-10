"use client";

import { Button } from "@avoid.quest/ui/components/button";
import { Dialog, DialogContent } from "@avoid.quest/ui/components/dialog";
import { cn } from "@avoid.quest/ui/lib/utils";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  TransformComponent,
  TransformWrapper,
  useControls,
} from "react-zoom-pan-pinch";

type MediaItem = {
  url: string;
  type: "image" | "video";
  width?: number;
  height?: number;
};

type LightboxProps = {
  items: MediaItem[];
  initialIndex?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// Zoom controls component
function ZoomControls() {
  const { zoomIn, zoomOut, resetTransform } = useControls();
  return (
    <div className="absolute top-4 left-4 z-50 flex gap-1">
      <Button
        className="text-white hover:bg-white/20"
        onClick={() => zoomIn()}
        size="icon"
        variant="ghost"
      >
        <ZoomInIcon className="size-5" />
      </Button>
      <Button
        className="text-white hover:bg-white/20"
        onClick={() => zoomOut()}
        size="icon"
        variant="ghost"
      >
        <ZoomOutIcon className="size-5" />
      </Button>
      <Button
        className="px-2 text-white text-xs hover:bg-white/20"
        onClick={() => resetTransform()}
        size="sm"
        variant="ghost"
      >
        Reset
      </Button>
    </div>
  );
}

export function Lightbox({
  items,
  initialIndex = 0,
  open,
  onOpenChange,
}: LightboxProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const touchStartX = useRef<number | null>(null);
  const touchEndX = useRef<number | null>(null);
  const isZoomed = useRef(false);

  // Reset index when opening
  useEffect(() => {
    if (open) {
      setCurrentIndex(initialIndex);
    }
  }, [open, initialIndex]);

  const currentItem = items[currentIndex];
  const hasMultiple = items.length > 1;

  const goToPrevious = useCallback(() => {
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : items.length - 1));
  }, [items.length]);

  const goToNext = useCallback(() => {
    setCurrentIndex((prev) => (prev < items.length - 1 ? prev + 1 : 0));
  }, [items.length]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowLeft":
          goToPrevious();
          break;
        case "ArrowRight":
          goToNext();
          break;
        case "Escape":
          onOpenChange(false);
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, goToPrevious, goToNext, onOpenChange]);

  // Touch swipe handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    touchEndX.current = e.touches[0].clientX;
  }, []);

  const handleTouchEnd = useCallback(() => {
    // Don't swipe if zoomed in
    if (isZoomed.current) {
      return;
    }

    if (!(touchStartX.current && touchEndX.current)) {
      return;
    }

    const diff = touchStartX.current - touchEndX.current;
    const minSwipeDistance = 50;

    if (Math.abs(diff) > minSwipeDistance) {
      if (diff > 0) {
        // Swipe left -> next
        goToNext();
      } else {
        // Swipe right -> previous
        goToPrevious();
      }
    }

    touchStartX.current = null;
    touchEndX.current = null;
  }, [goToNext, goToPrevious]);

  const handleDownload = async () => {
    if (!currentItem) {
      return;
    }

    try {
      const response = await fetch(currentItem.url);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `media-${currentIndex + 1}.${currentItem.type === "video" ? "mp4" : "jpg"}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Download failed:", error);
    }
  };

  if (!currentItem) {
    return null;
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="h-[95vh] max-h-[95vh] w-[95vw] max-w-[95vw] border-none bg-black/95 p-0"
        showCloseButton={false}
      >
        {/* Close button */}
        <Button
          className="absolute top-4 right-4 z-50 text-white hover:bg-white/20"
          onClick={() => onOpenChange(false)}
          size="icon"
          variant="ghost"
        >
          <XIcon className="size-6" />
        </Button>

        {/* Download button */}
        <Button
          className="absolute top-4 right-16 z-50 text-white hover:bg-white/20"
          onClick={handleDownload}
          size="icon"
          variant="ghost"
        >
          <DownloadIcon className="size-6" />
        </Button>

        {/* Navigation arrows */}
        {hasMultiple && (
          <>
            <Button
              className="absolute top-1/2 left-4 z-50 -translate-y-1/2 text-white hover:bg-white/20"
              onClick={goToPrevious}
              size="icon"
              variant="ghost"
            >
              <ChevronLeftIcon className="size-8" />
            </Button>
            <Button
              className="absolute top-1/2 right-4 z-50 -translate-y-1/2 text-white hover:bg-white/20"
              onClick={goToNext}
              size="icon"
              variant="ghost"
            >
              <ChevronRightIcon className="size-8" />
            </Button>
          </>
        )}

        {/* Media content with touch handlers */}
        <div
          className="flex h-full w-full flex-1 items-center justify-center"
          onTouchEnd={handleTouchEnd}
          onTouchMove={handleTouchMove}
          onTouchStart={handleTouchStart}
        >
          {currentItem.type === "video" ? (
            // biome-ignore lint/a11y/useMediaCaption: User-generated content
            <video
              autoPlay
              className="max-h-full max-w-full object-contain"
              controls
              key={currentItem.url}
              src={currentItem.url}
            />
          ) : (
            <TransformWrapper
              centerOnInit
              initialScale={1}
              key={currentItem.url}
              maxScale={5}
              minScale={0.5}
              onTransform={(_ref, state) => {
                isZoomed.current = state.scale > 1.05;
              }}
              wheel={{ step: 0.2 }}
            >
              <ZoomControls />
              <TransformComponent
                contentStyle={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                wrapperStyle={{
                  width: "100%",
                  height: "100%",
                }}
              >
                <img
                  alt=""
                  className="max-h-full max-w-full object-contain"
                  draggable={false}
                  height={currentItem.height ?? 800}
                  src={currentItem.url}
                  width={currentItem.width ?? 800}
                />
              </TransformComponent>
            </TransformWrapper>
          )}
        </div>

        {/* Indicator dots */}
        {hasMultiple && (
          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2">
            {items.map((_, index) => (
              <button
                className={cn(
                  "size-2 rounded-full transition-colors",
                  index === currentIndex ? "bg-white" : "bg-white/40"
                )}
                // biome-ignore lint/suspicious/noArrayIndexKey: Static indicator dots
                key={index}
                onClick={() => setCurrentIndex(index)}
                type="button"
              />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
