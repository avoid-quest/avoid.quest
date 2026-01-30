import { Button } from "@avoid.quest/ui/components/button";
import { Card, CardContent } from "@avoid.quest/ui/components/card";
import { Skeleton } from "@avoid.quest/ui/components/skeleton";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  CalendarIcon,
  ImageIcon,
  ImagesIcon,
  VideoIcon,
} from "lucide-react";
import { usePostByShortcode } from "@/lib/hooks/use-posts";

export const Route = createFileRoute("/p/$shortcode")({
  component: PostDetailPage,
});

function PostDetailPage() {
  const { shortcode } = Route.useParams();
  const post = usePostByShortcode(shortcode);

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

  return (
    <div className="container py-6">
      {/* Back button */}
      <Link className="mb-4 inline-block" to="/">
        <Button size="sm" variant="ghost">
          <ArrowLeftIcon className="mr-2 size-4" />
          Back
        </Button>
      </Link>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Media */}
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            {post.is_video ? (
              // biome-ignore lint/a11y/useMediaCaption: User-generated content without captions
              <video
                className="aspect-square w-full object-contain"
                controls
                poster={post.thumbnail_url || post.display_url}
                src={post.video_url}
              />
            ) : (
              <img
                alt={post.caption.slice(0, 100)}
                className="aspect-square w-full object-contain"
                height={600}
                src={post.display_url}
                width={600}
              />
            )}
          </CardContent>
        </Card>

        {/* Details */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <MediaTypeIcon className="size-4" />
            <span className="capitalize">{post.media_type}</span>
            <span>•</span>
            <CalendarIcon className="size-4" />
            <span>{formattedDate}</span>
          </div>

          <div className="prose dark:prose-invert">
            <p className="whitespace-pre-wrap">
              {post.caption || "No caption"}
            </p>
          </div>

          <div className="flex gap-2">
            <a
              className="text-muted-foreground text-sm hover:text-primary"
              href={post.url}
              rel="noopener noreferrer"
              target="_blank"
            >
              View on Instagram →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function PostDetailSkeleton() {
  return (
    <div className="container py-6">
      <Skeleton className="mb-4 h-10 w-24" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="aspect-square w-full rounded-lg" />
        <div className="space-y-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    </div>
  );
}
