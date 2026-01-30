import { Button } from "@avoid.quest/ui/components/button";
import { createFileRoute } from "@tanstack/react-router";
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

      {/* Load more button */}
      {canLoadMore && (
        <div className="mt-8 flex justify-center">
          <Button onClick={() => loadMore(12)} size="lg" variant="outline">
            Load more
          </Button>
        </div>
      )}

      {/* Loading more indicator */}
      {status === "LoadingMore" && (
        <div className="mt-8 flex justify-center">
          <p className="text-muted-foreground text-sm">Loading more...</p>
        </div>
      )}
    </div>
  );
}
