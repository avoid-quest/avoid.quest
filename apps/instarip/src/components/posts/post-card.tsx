import type { MediaItem, Post } from "@/lib/types";
import MediaCard from "./media-card";

type PostCardProps = {
  post: Post;
  mediaItems?: MediaItem[];
  username?: string;
};

export default function PostCard({
  post,
  mediaItems,
  username,
}: PostCardProps) {
  return <MediaCard mediaItems={mediaItems} post={post} username={username} />;
}
