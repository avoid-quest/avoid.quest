"use client";

import { api } from "@workspace/backend/convex/_generated/api";
import type { Doc } from "@workspace/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import MediaCard from "./media-card";

type PostCardProps = {
  post: Doc<"posts">;
  mediaItems?: Doc<"media_items">[];
};

export default function PostCard({ post }: PostCardProps) {
  const mediaItemsQuery = useQuery(api.media_items.getMediaItemsByPostId, {
    postId: post._id,
  });
  return <MediaCard mediaItems={mediaItemsQuery} post={post} />;
}
