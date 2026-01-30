import { Card, CardContent } from "@avoid.quest/ui/components/card";
import { Skeleton } from "@avoid.quest/ui/components/skeleton";
import { Link } from "@tanstack/react-router";
import {
  ImageIcon,
  ImagesIcon,
  MapPinIcon,
  UsersIcon,
  VideoIcon,
} from "lucide-react";
import { useState } from "react";
import { getPostImageUrl } from "@/lib/utils/media";

type PostCardProps = {
  post: {
    _id: string;
    shortcode: string;
    display_url: string;
    thumbnail_url?: string;
    proxyImageId?: string;
    caption: string;
    is_video: boolean;
    media_type: "image" | "video" | "carousel";
    timestamp: number;
    location?: {
      ig_id: string;
      name: string;
      slug: string;
    };
    collaborators?: string[];
  };
};

export function PostCard({ post }: PostCardProps) {
  const imageUrl = getPostImageUrl(post);
  const [isLoaded, setIsLoaded] = useState(false);

  const MediaTypeIcon = {
    image: ImageIcon,
    video: VideoIcon,
    carousel: ImagesIcon,
  }[post.media_type];

  return (
    <Link params={{ shortcode: post.shortcode }} to="/p/$shortcode">
      <Card className="group overflow-hidden transition-all hover:ring-2 hover:ring-primary/50">
        <CardContent className="relative p-0">
          {/* Skeleton while loading */}
          {!isLoaded && (
            <Skeleton className="absolute inset-0 rounded-none" />
          )}

          <img
            alt={post.caption.slice(0, 100)}
            className="w-full object-cover transition-transform group-hover:scale-105"
            loading="lazy"
            onLoad={() => setIsLoaded(true)}
            src={imageUrl}
            style={{ aspectRatio: "1 / 1" }}
          />

          {/* Media type indicator - always visible */}
          <div className="absolute top-2 right-2 rounded-full bg-black/60 p-1.5">
            <MediaTypeIcon className="size-4 text-white" />
          </div>

          {/* Hover overlay with all info */}
          <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/80 via-black/20 to-transparent p-3 opacity-0 transition-opacity group-hover:opacity-100">
            {/* Caption */}
            <p className="line-clamp-3 text-sm text-white">
              {post.caption || "No caption"}
            </p>

            {/* Location and collaborators */}
            {(post.location ||
              (post.collaborators && post.collaborators.length > 0)) && (
              <div className="mt-2 flex flex-wrap gap-2 text-white/80 text-xs">
                {post.location && (
                  <span className="flex items-center gap-1">
                    <MapPinIcon className="size-3" />
                    <span className="max-w-[120px] truncate">
                      {post.location.name}
                    </span>
                  </span>
                )}
                {post.collaborators && post.collaborators.length > 0 && (
                  <span className="flex items-center gap-1">
                    <UsersIcon className="size-3" />
                    {post.collaborators.length > 2
                      ? `${post.collaborators.length} collabs`
                      : post.collaborators.map((c) => `@${c}`).join(", ")}
                  </span>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export function PostCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <Skeleton className="aspect-square w-full" />
      </CardContent>
    </Card>
  );
}
