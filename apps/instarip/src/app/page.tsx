import { PostsGridSkeleton } from "@workspace/ui/components/skeletons";
import { Suspense } from "react";
import PostsGridVirtualized from "@/components/posts/posts-grid-virtualized";

export default function Home() {
  return (
    <Suspense fallback={<PostsGridSkeleton count={12} />}>
      <PostsGridVirtualized />
    </Suspense>
  );
}
