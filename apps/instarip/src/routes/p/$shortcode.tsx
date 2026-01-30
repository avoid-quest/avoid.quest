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
  MapPinIcon,
  UsersIcon,
  VideoIcon,
} from "lucide-react";
import { MediaViewer } from "@/components/media/media-viewer";
import { useMediaByPostId } from "@/lib/hooks/use-media";
import { usePostByShortcode } from "@/lib/hooks/use-posts";
import {
  getMediaProxyUrl,
  getPostImageUrl,
  getPostVideoUrl,
} from "@/lib/utils/media";

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

  const mediaTypeIcons: Record<string, typeof ImageIcon> = {
    image: ImageIcon,
    video: VideoIcon,
    carousel: ImagesIcon,
  };
  const MediaTypeIcon = mediaTypeIcons[post.media_type] ?? ImageIcon;

  const formattedDate = new Date(post.timestamp).toLocaleDateString("it-IT", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Get proxy URLs for consistent loading
  const imageUrl = getPostImageUrl(post);
  const videoUrl = getPostVideoUrl(post);

  // Build media items for the viewer using proxy URLs
  type MediaItemType = {
    _id: string;
    type: string;
    width?: number;
    height?: number;
  };
  const viewerItems = (mediaItems ?? [])
    .filter(
      (item: MediaItemType) => item.type === "image" || item.type === "video"
    )
    .map((item: MediaItemType) => ({
      url: getMediaProxyUrl(item._id),
      type: item.type as "image" | "video",
      width: item.width,
      height: item.height,
    }));

  const handleDownload = async () => {
    const url = post.is_video ? videoUrl : imageUrl;
    if (!url) return;

    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `${post.shortcode}.${post.is_video ? "mp4" : "jpg"}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      // Fallback: open in new tab
      window.open(url, "_blank");
    }
  };

  return (
    <div className="container max-w-6xl py-6">
      {/* Back button */}
      <Link className="mb-4 inline-block" to="/">
        <Button size="sm" variant="ghost">
          <ArrowLeftIcon className="mr-2 size-4" />
          Back
        </Button>
      </Link>

      <div className="grid gap-8 lg:grid-cols-[1fr,400px]">
        {/* Media - takes more space now */}
        <div className="flex items-start justify-center">
          <MediaViewer
            className="w-full max-w-3xl"
            displayUrl={imageUrl}
            isVideo={post.is_video}
            items={viewerItems}
            mediaType={post.media_type}
            thumbnailUrl={imageUrl}
            videoUrl={videoUrl}
          />
        </div>

        {/* Details sidebar */}
        <div className="space-y-4">
          {/* Meta info */}
          <div className="flex flex-wrap items-center gap-3 text-muted-foreground text-sm">
            <div className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-1">
              <MediaTypeIcon className="size-4" />
              <span className="capitalize">{post.media_type}</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-1">
              <CalendarIcon className="size-4" />
              <span>{formattedDate}</span>
            </div>
          </div>

          {/* Location */}
          {post.location && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <MapPinIcon className="size-4" />
              <span>{post.location.name}</span>
            </div>
          )}

          {/* Collaborators */}
          {post.collaborators && post.collaborators.length > 0 && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <UsersIcon className="size-4" />
              <span>{post.collaborators.map((c) => `@${c}`).join(", ")}</span>
            </div>
          )}

          {/* Caption */}
          <div className="rounded-lg border bg-card p-4">
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {post.caption || "No caption"}
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2 pt-2">
            <a href={post.url} rel="noopener noreferrer" target="_blank">
              <Button size="sm" variant="outline">
                <ExternalLinkIcon className="mr-2 size-4" />
                View on Instagram
              </Button>
            </a>
            <Button onClick={handleDownload} size="sm" variant="outline">
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
    <div className="container max-w-6xl py-6">
      <Skeleton className="mb-4 h-10 w-24" />
      <div className="grid gap-8 lg:grid-cols-[1fr,400px]">
        <Skeleton className="aspect-square max-w-3xl rounded-lg" />
        <div className="space-y-4">
          <div className="flex gap-2">
            <Skeleton className="h-8 w-24 rounded-full" />
            <Skeleton className="h-8 w-32 rounded-full" />
          </div>
          <Skeleton className="h-40 w-full rounded-lg" />
          <div className="flex gap-2">
            <Skeleton className="h-9 w-36" />
            <Skeleton className="h-9 w-28" />
          </div>
        </div>
      </div>
    </div>
  );
}
