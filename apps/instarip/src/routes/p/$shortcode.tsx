import { Button } from "@avoid.quest/ui/components/button";
import { Skeleton } from "@avoid.quest/ui/components/skeleton";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  CalendarIcon,
  DownloadIcon,
  ExternalLinkIcon,
  ImageIcon,
  ImagesIcon,
  VideoIcon,
} from "lucide-react";
import { MediaViewer } from "@/components/media/media-viewer";
import { useMediaByPostId } from "@/lib/hooks/use-media";
import { usePostByShortcode } from "@/lib/hooks/use-posts";

export const Route = createFileRoute("/p/$shortcode")({
  component: PostDetailPage,
});

function PostDetailPage() {
  const { shortcode } = Route.useParams();
  const post = usePostByShortcode(shortcode);
  const mediaItems = useMediaByPostId(post?._id ?? "");

  if (post === undefined) {
    return <PostDetailSkeleton />;
  }

  if (post === null) {
    return (
      <div className="container flex flex-col items-center justify-center py-12">
        <h1 className="mb-4 font-bold text-2xl">Post not found</h1>
        <p className="mb-6 text-muted-foreground">
          The post you're looking for doesn't exist.
        </p>
        <Link to="/">
          <Button>
            <ArrowLeftIcon className="mr-2 size-4" />
            Go back
          </Button>
        </Link>
      </div>
    );
  }

  const MediaTypeIcon = {
    image: ImageIcon,
    video: VideoIcon,
    carousel: ImagesIcon,
  }[post.media_type];

  const formattedDate = new Date(post.timestamp).toLocaleDateString("it-IT", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Build media items for the viewer
  const viewerItems = (mediaItems ?? [])
    .filter((item) => item.type === "image" || item.type === "video")
    .map((item) => ({
      // For now, use display_url since we don't store URLs in media_items
      url:
        item.type === "video"
          ? (post.video_url ?? post.display_url)
          : post.display_url,
      type: item.type as "image" | "video",
      width: item.width,
      height: item.height,
    }));

  return (
    <div className="container max-w-5xl py-6">
      {/* Back button */}
      <Link className="mb-4 inline-block" to="/">
        <Button size="sm" variant="ghost">
          <ArrowLeftIcon className="mr-2 size-4" />
          Back
        </Button>
      </Link>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Media */}
        <MediaViewer
          className="aspect-square"
          displayUrl={post.display_url}
          isVideo={post.is_video}
          items={viewerItems}
          mediaType={post.media_type}
          thumbnailUrl={post.thumbnail_url}
          videoUrl={post.video_url}
        />

        {/* Details */}
        <div className="space-y-4">
          {/* Meta info */}
          <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
            <div className="flex items-center gap-1">
              <MediaTypeIcon className="size-4" />
              <span className="capitalize">{post.media_type}</span>
            </div>
            <span>•</span>
            <div className="flex items-center gap-1">
              <CalendarIcon className="size-4" />
              <span>{formattedDate}</span>
            </div>
          </div>

          {/* Caption */}
          <div className="prose dark:prose-invert max-w-none">
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {post.caption || "No caption"}
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2 pt-4">
            <a href={post.url} rel="noopener noreferrer" target="_blank">
              <Button size="sm" variant="outline">
                <ExternalLinkIcon className="mr-2 size-4" />
                View on Instagram
              </Button>
            </a>
            <Button
              onClick={() => {
                const url = post.is_video ? post.video_url : post.display_url;
                if (url) {
                  window.open(url, "_blank");
                }
              }}
              size="sm"
              variant="outline"
            >
              <DownloadIcon className="mr-2 size-4" />
              Download
            </Button>
          </div>

          {/* Users */}
          {post.users && post.users.length > 0 && (
            <div className="border-t pt-4">
              <p className="text-muted-foreground text-sm">
                From {post.users.length} user{post.users.length > 1 ? "s" : ""}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PostDetailSkeleton() {
  return (
    <div className="container max-w-5xl py-6">
      <Skeleton className="mb-4 h-10 w-24" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="aspect-square w-full rounded-lg" />
        <div className="space-y-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-10 w-32" />
        </div>
      </div>
    </div>
  );
}
