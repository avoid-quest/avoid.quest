import { Card, CardContent } from "@avoid.quest/ui/components/card";
import { Link } from "@tanstack/react-router";
import { ImageIcon, ImagesIcon, VideoIcon } from "lucide-react";
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

          {/* Caption preview on hover */}
          <div className="absolute inset-x-0 bottom-0 translate-y-full bg-gradient-to-t from-black/80 to-transparent p-3 transition-transform group-hover:translate-y-0">
            <p className="line-clamp-2 text-sm text-white">
              {post.caption || "No caption"}
            </p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
