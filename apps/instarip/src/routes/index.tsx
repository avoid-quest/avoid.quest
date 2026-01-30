import { createFileRoute } from "@tanstack/react-router";
import { PostGrid } from "@/components/feed/post-grid";
import { useRecentPosts } from "@/lib/hooks/use-posts";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const posts = useRecentPosts(40);

  return (
    <div className="container py-6">
      <h1 className="mb-6 font-bold text-2xl">Recent Posts</h1>
      <PostGrid isLoading={posts === undefined} posts={posts} />
    </div>
  );
}
