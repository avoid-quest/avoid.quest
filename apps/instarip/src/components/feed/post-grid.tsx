import { PostCard, PostCardSkeleton } from "./post-card";

type Post = {
  _id: string;
  shortcode: string;
  display_url: string;
  thumbnail_url?: string;
  proxyImageId?: string;
  proxyVideoId?: string;
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

type PostGridProps = {
  posts: Post[] | undefined;
  isLoading?: boolean;
};

const SKELETON_COUNT = 20;

export function PostGrid({ posts, isLoading }: PostGridProps) {
  if (isLoading) {
    return <PostGridSkeleton count={SKELETON_COUNT} />;
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

export function PostGridSkeleton({
  count = SKELETON_COUNT,
}: {
  count?: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {Array.from({ length: count }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: Static skeleton loading state
        <PostCardSkeleton key={i} />
      ))}
    </div>
  );
}
