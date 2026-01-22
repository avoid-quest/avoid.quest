import { PostsGridSkeleton } from "@avoid.quest/ui/components/skeletons";

export default function Loading() {
  return (
    <div>
      {/* User Header Skeleton */}
      <div className="mb-4 flex items-center gap-3">
        <div className="h-8 w-8 animate-pulse rounded bg-muted" />
        <div className="h-8 w-32 animate-pulse rounded bg-muted" />
      </div>

      {/* Posts Grid Skeleton */}
      <PostsGridSkeleton count={8} />
    </div>
  );
}
