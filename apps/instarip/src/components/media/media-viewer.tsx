"use client";

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@avoid.quest/ui/components/carousel";
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
            "block w-full cursor-pointer overflow-hidden rounded-lg",
            className
          )}
          onClick={() => openLightbox(0)}
          type="button"
        >
          {isVideo ? (
            // biome-ignore lint/a11y/useMediaCaption: User-generated content
            <video
              className="aspect-square w-full bg-black object-contain"
              controls
              onClick={(e) => e.stopPropagation()}
              poster={thumbnailUrl || displayUrl}
              src={videoUrl}
            />
          ) : (
            <img
              alt=""
              className="aspect-square w-full bg-muted object-contain"
              height={600}
              src={displayUrl}
              width={600}
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
                className="block w-full cursor-pointer overflow-hidden rounded-lg"
                onClick={() => openLightbox(index)}
                type="button"
              >
                {item.type === "video" ? (
                  // biome-ignore lint/a11y/useMediaCaption: User-generated content
                  <video
                    className="aspect-square w-full bg-black object-contain"
                    controls
                    onClick={(e) => e.stopPropagation()}
                    src={item.url}
                  />
                ) : (
                  <img
                    alt=""
                    className="aspect-square w-full bg-muted object-contain"
                    height={600}
                    src={item.url}
                    width={600}
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
