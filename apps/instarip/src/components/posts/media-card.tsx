"use client";

import { api } from "@workspace/backend/convex/_generated/api";
import type { Doc } from "@workspace/backend/convex/_generated/dataModel";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardHeader } from "@workspace/ui/components/card";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@workspace/ui/components/carousel";
import { cn } from "@workspace/ui/lib/utils";
import { useQuery } from "convex/react";
import { PlayIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { formatCompactDate } from "@/lib/date-utils";
import UserLink from "../user-link";

type MediaCardProps = {
  className?: string;
  post: Doc<"posts">;
  mediaItems?: Doc<"media_items">[];
  isViewer?: boolean;
};

export default function MediaCard({
  className,
  post,
  mediaItems,
  isViewer = false,
}: MediaCardProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasError, setHasError] = useState(false);
  const users = useQuery(api.users.getUsersByIds, { ids: post.users });
  const videoUrl = post.video_url;
  const thumbnailUrl = post.thumbnail_url || post.display_url;
  const isVideo = post.is_video || post.media_type === "video";
  const isCarousel = post.media_type === "carousel";

  // Create media array for carousels
  const mediaArray =
    mediaItems && mediaItems.length > 0
      ? mediaItems
          .map((item) => ({ url: item.url, type: item.type }))
          .filter((item) => item.url)
      : [
          ...(post.display_url
            ? [{ url: post.display_url, type: "image" as const }]
            : []),
          ...(post.thumbnail_url
            ? [{ url: post.thumbnail_url, type: "thumbnail" as const }]
            : []),
        ];

  const hasMultiple = mediaArray.length > 1;

  // Video controls
  const togglePlay = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsPlaying(!isPlaying);
  };

  // Render carousel item
  const renderCarouselItem = (
    media: { url: string | null; type: string | null },
    index: number
  ) => (
    <CarouselItem key={`${media.url}-${index}`}>
      {isViewer ? (
        <div className="relative overflow-hidden">
          <ImageComponent isViewer src={media.url || ""} />
        </div>
      ) : (
        <Link className="block" href={`/p/${post.shortcode}`}>
          <div className="relative overflow-hidden">
            <ImageComponent isViewer src={media.url || ""} />
          </div>
        </Link>
      )}
    </CarouselItem>
  );

  // Render carousel content
  const renderCarousel = () => (
    <div className={cn("relative w-min min-w-[300px]", className)}>
      <Carousel opts={{ align: "start", loop: true }}>
        <CarouselContent>
          {mediaArray.map((media, index) =>
            media.url ? renderCarouselItem(media, index) : null
          )}
        </CarouselContent>
        {hasMultiple && (
          <>
            <CarouselPrevious
              className="left-2 transition-transform hover:scale-110"
              variant="secondary"
            />
            <CarouselNext
              className="right-2 transition-transform hover:scale-110"
              variant="secondary"
            />
          </>
        )}
      </Carousel>
    </div>
  );

  // Render video element
  const renderVideoElement = () => {
    if (isPlaying && !hasError && videoUrl) {
      return (
        <video
          autoPlay
          className="h-auto w-full object-contain"
          controls
          onEnded={() => setIsPlaying(false)}
          onError={() => setHasError(true)}
        >
          <source src={videoUrl} type="video/mp4" />
          <track kind="captions" label="English" srcLang="en" />
          Your browser does not support the video tag.
        </video>
      );
    }

    return (
      <ImageComponent
        alt={"Video Thumbnail"}
        className="min-h-[400px] min-w-[200px]"
        isViewer={isViewer}
        onError={() => setHasError(true)}
        src={thumbnailUrl || ""}
      />
    );
  };

  // Render video controls
  const renderVideoControls = () => {
    const hasVideo = Boolean(videoUrl);
    const isNotPlaying = !isPlaying;
    const hasNoError = !hasError;
    const canShowPlayButton = isNotPlaying && hasNoError && hasVideo;

    if (canShowPlayButton) {
      return (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 transition-opacity hover:bg-black/30">
          <Button
            className="rounded-full p-3 shadow-lg transition-transform hover:scale-110"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              togglePlay(e);
            }}
            size="icon"
            variant="secondary"
          >
            <PlayIcon className="h-6 w-6" />
          </Button>
        </div>
      );
    }

    return null;
  };

  // Render video content
  const renderVideo = () => {
    const content = (
      <div
        className={cn(
          "relative h-full max-h-[calc(100vh-10rem)] w-full overflow-hidden",
          className
        )}
      >
        {renderVideoElement()}
        {renderVideoControls()}
      </div>
    );

    if (isViewer) {
      return content;
    }

    return (
      <Link className="group relative block" href={`/p/${post.shortcode}`}>
        {content}
      </Link>
    );
  };

  // Render single image
  const renderImage = () => {
    if (!post.display_url) {
      return null;
    }

    const imageElement = (
      <ImageComponent
        className={cn(!isViewer && "max-w-[300px]")}
        isViewer={isViewer}
        src={post.display_url}
      />
    );

    if (isViewer) {
      return (
        <div className={cn("relative w-full overflow-hidden", className)}>
          {imageElement}
        </div>
      );
    }

    return (
      <Link className="block" href={`/p/${post.shortcode}`}>
        <div className={cn("relative w-full overflow-hidden", className)}>
          {imageElement}
        </div>
      </Link>
    );
  };

  // Render media content
  const renderMedia = () => {
    if (isCarousel) {
      return renderCarousel();
    }

    if (isVideo) {
      return renderVideo();
    }

    return renderImage();
  };

  // For viewers, just return the media content
  if (isViewer) {
    return renderMedia();
  }

  // For cards, return the full card structure
  return (
    <Card
      className={cn(
        "gap-0 py-0 transition-all duration-200 hover:shadow-md hover:ring-1 hover:ring-ring/10",
        className
      )}
    >
      {/* User Header */}
      <CardHeader className="mb-2 flex flex-row items-center p-2">
        <div className="flex flex-col items-start gap-1">
          {users?.map((user) => (
            <UserLink key={user?._id} username={user?.username || ""} />
          ))}
          <p className="ml-2 text-start text-muted-foreground text-xs">
            {formatCompactDate(post.timestamp)}
          </p>
        </div>
      </CardHeader>

      {/* Media Content */}
      <CardContent className="p-0">{renderMedia()}</CardContent>
    </Card>
  );
}

const DEFAULT_HEIGHT = 300;
const DEFAULT_WIDTH = 300;
const VIEWER_HEIGHT = 1000;
const VIEWER_WIDTH = 1000;

const QUALITY_HIGH = 90;
const QUALITY_LOW = 60;

function ImageComponent({
  src,
  alt = "Post Image",
  className,
  onError,
  isViewer = false,
  height = isViewer ? VIEWER_HEIGHT : DEFAULT_HEIGHT,
  width = isViewer ? VIEWER_WIDTH : DEFAULT_WIDTH,
}: {
  src: string;
  alt?: string;
  className?: string;
  onError?: () => void;
  isViewer?: boolean;
  height?: number;
  width?: number;
}) {
  return (
    <Image
      alt={alt}
      className={cn(
        "h-auto max-h-[calc(100vh-10rem)] w-full object-contain",
        className
      )}
      height={height}
      loading="lazy"
      onError={onError}
      quality={isViewer ? QUALITY_HIGH : QUALITY_LOW}
      src={src}
      width={width}
    />
  );
}
