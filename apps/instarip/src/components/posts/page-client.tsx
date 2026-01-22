"use client";

import { api } from "@avoid.quest/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import PostCard from "./post-card";

export default function PageClient() {
  const posts = useQuery(api.posts.getPosts, { limit: 50 });
  return (
    <main className="flex flex-wrap items-center justify-center gap-4 p-24">
      {posts?.map((post) => (
        <PostCard key={post._id} post={post} />
      ))}
    </main>
  );
}
