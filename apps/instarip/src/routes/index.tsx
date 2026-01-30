import { Skeleton } from "@avoid.quest/ui/components/skeleton";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useInView } from "react-intersection-observer";
import { Filters } from "@/components/feed/filters";
import { PostGrid } from "@/components/feed/post-grid";
import { useFilteredPosts, useHasActiveFilters } from "@/lib/hooks/use-filters";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const { results, isLoading, loadMore, status, isSearchMode } =
    useFilteredPosts(12);
  const hasFilters = useHasActiveFilters();
  const canLoadMore = status === "CanLoadMore";
  const isLoadingMore = status === "LoadingMore";

  // Auto-load when scrolling to bottom
  const { ref: loadMoreRef, inView } = useInView({
    threshold: 0,
    rootMargin: "200px", // Start loading 200px before reaching the element
  });

  useEffect(() => {
    if (inView && canLoadMore && !isLoadingMore) {
      loadMore(12);
    }
  }, [inView, canLoadMore, isLoadingMore, loadMore]);

  return (
    <div className="container py-6">
      <h1 className="mb-4 font-bold text-2xl">
        {hasFilters ? "Search Results" : "Recent Posts"}
      </h1>

      {/* Filters */}
      <div className="mb-6">
        <Filters />
      </div>

      {/* Results count */}
      {hasFilters && !isLoading && (
        <p className="mb-4 text-muted-foreground text-sm">
          {results.length} {results.length === 1 ? "post" : "posts"} found
          {isSearchMode && " (search results)"}
        </p>
      )}

      {/* Post grid */}
      <PostGrid isLoading={isLoading} posts={results} />

      {/* Infinite scroll trigger */}
      {canLoadMore && (
        <div className="mt-8 flex justify-center" ref={loadMoreRef}>
          <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton
                className="aspect-square rounded-lg"
                // biome-ignore lint/suspicious/noArrayIndexKey: Static skeleton
                key={`loader-${i}`}
              />
            ))}
          </div>
        </div>
      )}

      {/* Loading more indicator */}
      {isLoadingMore && (
        <div className="mt-4 flex justify-center">
          <p className="text-muted-foreground text-sm">Loading more...</p>
        </div>
      )}
    </div>
  );
}
