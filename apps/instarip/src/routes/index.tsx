import { createFileRoute } from "@tanstack/react-router";
import { Filters } from "@/components/feed/filters";
import { PostGrid } from "@/components/feed/post-grid";
import { useFilteredPosts, useHasActiveFilters } from "@/lib/hooks/use-filters";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const { results, isLoading, isSearchMode } = useFilteredPosts(100);
  const hasFilters = useHasActiveFilters();

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
    </div>
  );
}
