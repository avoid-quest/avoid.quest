"use client";

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@avoid.quest/ui/components/carousel";
import { Skeleton } from "@avoid.quest/ui/components/skeleton";
import { cn } from "@avoid.quest/ui/lib/utils";
import { useState } from "react";
import { Lightbox } from "./lightbox";

type MediaItem = {
  url: string;
  type: "image" | "video";
  width?: number;
  height?: number;
};

type MediaViewerProps = {
  items: MediaItem[];
  displayUrl: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  isVideo: boolean;
  mediaType: "image" | "video" | "carousel";
  className?: string;
};

export function MediaViewer({
  items,
  displayUrl,
  videoUrl,
  thumbnailUrl,
  isVideo,
  mediaType,
  className,
}: MediaViewerProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);

  // Build media items from props if not provided
  const buildDefaultItems = (): MediaItem[] => {
    if (isVideo) {
      return [{ url: videoUrl || displayUrl, type: "video" as const }];
    }
    return [{ url: displayUrl, type: "image" as const }];
  };

  const mediaItems: MediaItem[] =
    items.length > 0 ? items : buildDefaultItems();

  const openLightbox = (index: number) => {
    setLightboxIndex(index);
    setLightboxOpen(true);
  };

  // Single image/video
  if (mediaType !== "carousel" || mediaItems.length === 1) {
    return (
      <>
        <button
          className={cn(
            "relative block w-full cursor-pointer overflow-hidden rounded-lg bg-muted",
            className
          )}
          onClick={() => openLightbox(0)}
          type="button"
        >
          {/* Loading skeleton */}
          {!(isLoaded || isVideo) && (
            <Skeleton className="absolute inset-0 rounded-lg" />
          )}

          {isVideo ? (
            // biome-ignore lint/a11y/useMediaCaption: User-generated content
            <video
              className="w-full bg-black"
              controls
              onClick={(e) => e.stopPropagation()}
              poster={thumbnailUrl || displayUrl}
              src={videoUrl}
            />
          ) : (
            // biome-ignore lint/a11y/noNoninteractiveElementInteractions: onLoad is for loading state
            <img
              alt=""
              className="w-full bg-muted"
              height={400}
              onLoad={() => setIsLoaded(true)}
              src={displayUrl}
              width={400}
            />
          )}
        </button>

        <Lightbox
          initialIndex={0}
          items={mediaItems}
          onOpenChange={setLightboxOpen}
          open={lightboxOpen}
        />
      </>
    );
  }

  // Carousel
  return (
    <>
      <Carousel className={cn("w-full", className)}>
        <CarouselContent>
          {mediaItems.map((item, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: Carousel items are static
            <CarouselItem key={index}>
              <button
                className="relative block w-full cursor-pointer overflow-hidden rounded-lg bg-muted"
                onClick={() => openLightbox(index)}
                type="button"
              >
                {item.type === "video" ? (
                  // biome-ignore lint/a11y/useMediaCaption: User-generated content
                  <video
                    className="w-full bg-black"
                    controls
                    onClick={(e) => e.stopPropagation()}
                    src={item.url}
                  />
                ) : (
                  <img
                    alt=""
                    className="w-full bg-muted"
                    height={400}
                    src={item.url}
                    width={400}
                  />
                )}
              </button>
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious className="left-2" />
        <CarouselNext className="right-2" />
      </Carousel>

      <Lightbox
        initialIndex={lightboxIndex}
        items={mediaItems}
        onOpenChange={setLightboxOpen}
        open={lightboxOpen}
      />
    </>
  );
}
