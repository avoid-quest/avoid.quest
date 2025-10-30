// import { PostsGridSkeleton } from "@workspace/ui/components/skeletons";
// import { Suspense } from "react";
// import PostsGridVirtualized from "@/components/posts/posts-grid-virtualized";

// export default function Home() {
//   return (
//     <Suspense fallback={<PostsGridSkeleton count={12} />}>
//       <PostsGridVirtualized />
//     </Suspense>
//   );
// }
"use client";

import { api } from "@workspace/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import PostCard from "@/components/posts/post-card";

export default function Home() {
  const posts = useQuery(api.posts.getPosts, { limit: 50 });
  return (
    <main className="flex flex-wrap items-center justify-center gap-4 p-24">
      {posts?.map((post) => (
        <PostCard key={post._id} post={post} username={post.users[0]} />
      ))}
    </main>
  );
}
