import { Skeleton } from "@avoid.quest/ui/components/skeleton";
import { PostCard } from "./post-card";

type Post = {
  _id: string;
  shortcode: string;
  display_url: string;
  thumbnail_url?: string;
  caption: string;
  is_video: boolean;
  media_type: "image" | "video" | "carousel";
  timestamp: number;
};

type PostGridProps = {
  posts: Post[] | undefined;
  isLoading?: boolean;
};

export function PostGrid({ posts, isLoading }: PostGridProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {Array.from({ length: 20 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Static skeleton loading state
          <Skeleton className="aspect-square rounded-lg" key={i} />
        ))}
      </div>
    );
  }

  if (!posts || posts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-lg text-muted-foreground">No posts found</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {posts.map((post) => (
        <PostCard key={post._id} post={post} />
      ))}
    </div>
  );
}
