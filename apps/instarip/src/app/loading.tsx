import {
  PaginationSkeleton,
  PostsGridSkeleton,
} from "@avoid.quest/ui/components/skeletons";

export default function Loading() {
  return (
    <>
      {/* Posts Grid Skeleton */}
      <PostsGridSkeleton count={12} />

      {/* Pagination Skeleton */}
      <div className="mt-12 flex justify-center">
        <PaginationSkeleton />
      </div>

      {/* Stats Skeleton */}
      <div className="mt-4 text-center">
        <div className="mx-auto h-4 w-32">
          <div className="h-full animate-pulse rounded bg-muted" />
        </div>
      </div>
    </>
  );
}
