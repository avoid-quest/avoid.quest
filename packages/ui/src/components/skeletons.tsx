import { Card, CardContent, CardHeader } from "@avoid.quest/ui/components/card";
import { Skeleton } from "@avoid.quest/ui/components/skeleton";

/**
 * Unified skeleton for all post cards (image, video, carousel)
 */
export function PostCardSkeleton() {
  return (
    <Card className="min-h-[400px] min-w-[300px]">
      <CardHeader className="flex flex-row items-center gap-3 p-3 pb-2">
        <Skeleton className="h-8 w-8 rounded-full" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="mt-1 h-3 w-16" />
        </div>
        <Skeleton className="h-5 w-12" />
      </CardHeader>
      <CardContent className="p-0">
        <Skeleton className="aspect-square w-full" />
      </CardContent>
      <CardContent className="p-3 pt-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="mt-1 h-4 w-3/4" />
      </CardContent>
    </Card>
  );
}

/**
 * Skeleton for posts grid layout
 */
export function PostsGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: shadcn
        <PostCardSkeleton key={`post-card-skeleton-${index}`} />
      ))}
    </div>
  );
}

/**
 * Skeleton for individual post page layout
 */
export function PostPageSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 overflow-hidden lg:grid-cols-3">
      {/* Media Content - 2/3 width */}
      <div className="lg:col-span-2">
        <Skeleton className="h-full max-h-[calc(100vh-10rem)] w-full rounded-lg" />
      </div>

      {/* Caption and Actions - 1/3 width */}
      <div className="flex flex-col justify-start">
        <div className="sticky top-24 space-y-6">
          {/* Caption Skeleton */}
          <div className="rounded-lg border bg-card p-4">
            <Skeleton className="mb-3 h-4 w-16" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="mt-2 h-4 w-3/4" />
            <Skeleton className="mt-2 h-4 w-1/2" />
          </div>

          {/* Action Buttons Skeleton */}
          <div className="space-y-3">
            <Skeleton className="h-4 w-16" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Skeleton for pagination controls
 */
export function PaginationSkeleton() {
  return (
    <div className="flex justify-center gap-2">
      <Skeleton className="h-8 w-8" />
      <Skeleton className="h-8 w-8" />
      <Skeleton className="h-8 w-8" />
      <Skeleton className="h-8 w-8" />
      <Skeleton className="h-8 w-8" />
    </div>
  );
}
