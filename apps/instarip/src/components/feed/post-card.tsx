import { Card, CardContent } from "@avoid.quest/ui/components/card";
import { Link } from "@tanstack/react-router";
import {
  ImageIcon,
  ImagesIcon,
  MapPinIcon,
  UsersIcon,
  VideoIcon,
} from "lucide-react";
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

  const MediaTypeIcon = {
    image: ImageIcon,
    video: VideoIcon,
    carousel: ImagesIcon,
  }[post.media_type];

  return (
    <Link params={{ shortcode: post.shortcode }} to="/p/$shortcode">
      <Card className="group overflow-hidden transition-all hover:ring-2 hover:ring-primary/50">
        <CardContent className="relative aspect-square p-0">
          <img
            alt={post.caption.slice(0, 100)}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
            height={300}
            loading="lazy"
            src={imageUrl}
            width={300}
          />

          {/* Media type indicator */}
          <div className="absolute top-2 right-2 rounded-full bg-black/60 p-1.5">
            <MediaTypeIcon className="size-4 text-white" />
          </div>

          {/* Location indicator */}
          {post.location && (
            <div className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1">
              <MapPinIcon className="size-3 text-white" />
              <span className="max-w-[100px] truncate text-white text-xs">
                {post.location.name}
              </span>
            </div>
          )}

          {/* Collaborators indicator */}
          {post.collaborators && post.collaborators.length > 0 && (
            <div className="absolute top-2 left-2 mt-7 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1">
              <UsersIcon className="size-3 text-white" />
              <span className="text-white text-xs">
                {post.collaborators.length}
              </span>
            </div>
          )}

          {/* Caption preview on hover */}
          <div className="absolute inset-x-0 bottom-0 translate-y-full bg-gradient-to-t from-black/80 to-transparent p-3 transition-transform group-hover:translate-y-0">
            <p className="line-clamp-2 text-sm text-white">
              {post.caption || "No caption"}
            </p>
            {/* Location and collaborators in hover state */}
            {(post.location ||
              (post.collaborators && post.collaborators.length > 0)) && (
              <div className="mt-1 flex flex-wrap gap-2 text-white/80 text-xs">
                {post.location && (
                  <span className="flex items-center gap-1">
                    <MapPinIcon className="size-3" />
                    {post.location.name}
                  </span>
                )}
                {post.collaborators && post.collaborators.length > 0 && (
                  <span className="flex items-center gap-1">
                    <UsersIcon className="size-3" />
                    {post.collaborators.map((c) => `@${c}`).join(", ")}
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
