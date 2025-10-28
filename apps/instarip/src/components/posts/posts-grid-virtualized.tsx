"use client";

import { PostCardSkeleton } from "@workspace/ui/components/skeletons";
import { useCallback, useEffect, useRef, useState } from "react";
import PostCard from "@/components/posts/post-card";
import {
  getVirtualPostsWithMediaAction,
  getVirtualUserPostsWithMediaAction,
} from "@/lib/actions";
import type { MediaItem, Post } from "@/lib/types";

type PostWithMedia = Post & {
  mediaItems?: MediaItem[];
  username: string;
};

const ITEMS_PER_LOAD = 20; // Number of items to load per batch

type PostsGridVirtualizedProps = {
  userId?: number;
};

export default function PostsGridVirtualized({
  userId,
}: PostsGridVirtualizedProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [posts, setPosts] = useState<PostWithMedia[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  // Load initial data
  useEffect(() => {
    const loadInitialData = async () => {
      setIsLoading(true);
      try {
        const result = userId
          ? await getVirtualUserPostsWithMediaAction(userId, {
              offset: 0,
              limit: ITEMS_PER_LOAD,
            })
          : await getVirtualPostsWithMediaAction({
              offset: 0,
              limit: ITEMS_PER_LOAD,
            });

        // Ensure no duplicates in initial load
        const uniquePosts = result.data.filter(
          (post, index, self) =>
            self.findIndex((p) => p.int_id === post.int_id) === index
        );

        setPosts(uniquePosts);
        setHasMore(result.hasMore);
      } catch (error) {
        // Error handling - could be improved with proper error reporting
        process.stdout.write(`Failed to load initial posts: ${error}\n`);
      } finally {
        setIsLoading(false);
      }
    };

    loadInitialData();
  }, [userId]);

  // Load more data when needed
  const loadMore = useCallback(async () => {
    if (isLoading || !hasMore) {
      return;
    }

    setIsLoading(true);
    try {
      const result = userId
        ? await getVirtualUserPostsWithMediaAction(userId, {
            offset: posts.length,
            limit: ITEMS_PER_LOAD,
          })
        : await getVirtualPostsWithMediaAction({
            offset: posts.length,
            limit: ITEMS_PER_LOAD,
          });

      // Filter out any duplicate posts based on int_id
      const existingIds = new Set(posts.map((post) => post.int_id));
      const newPosts = result.data.filter(
        (post) => !existingIds.has(post.int_id)
      );

      setPosts((prev) => [...prev, ...newPosts]);
      setHasMore(result.hasMore);
    } catch (error) {
      // Error handling - could be improved with proper error reporting
      process.stdout.write(`Failed to load more posts: ${error}\n`);
    } finally {
      setIsLoading(false);
    }
  }, [posts.length, isLoading, hasMore, userId, posts]);

  // Intersection Observer for infinite scroll
  useEffect(() => {
    const container = containerRef.current;
    if (!(container && hasMore) || isLoading) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting) {
          loadMore();
        }
      },
      {
        root: null,
        rootMargin: "100px", // Load more when 100px away from bottom
        threshold: 0.1,
      }
    );

    // Create a sentinel element at the bottom
    const sentinel = document.createElement("div");
    sentinel.style.height = "1px";
    container.appendChild(sentinel);
    observer.observe(sentinel);

    return () => {
      observer.disconnect();
      if (container.contains(sentinel)) {
        container.removeChild(sentinel);
      }
    };
  }, [hasMore, isLoading, loadMore]);

  // Show skeleton grid for initial loading
  if (posts.length === 0 && isLoading) {
    return (
      <div className="w-full">
        <div className="flex flex-wrap items-start justify-center gap-4">
          {Array.from({ length: 12 }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton components don't have unique IDs
            <PostCardSkeleton key={`initial-skeleton-${index}`} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Posts Grid with Flex Wrap */}
      <div
        className="flex flex-wrap items-start justify-center gap-4"
        ref={containerRef}
      >
        {posts.map((post, index) => (
          <PostCard
            key={`${post.int_id}-${index}`}
            mediaItems={post.mediaItems}
            post={post}
            username={post.username}
          />
        ))}

        {/* Loading more posts - show skeleton cards */}
        {isLoading &&
          posts.length > 0 &&
          Array.from({ length: 3 }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton components don't have unique IDs
            <PostCardSkeleton key={`loading-skeleton-${index}`} />
          ))}
      </div>
    </div>
  );
}
