import { useQuery } from "convex/react";
import { api } from "@/lib/convex";

/**
 * Hook for posts (limit-based, no pagination)
 * Convex components don't support pagination
 */
export function usePosts(limit = 50) {
  return useQuery(api.api.posts.getPosts, { limit });
}

/**
 * Hook for recent posts (alias for usePosts)
 */
export function useRecentPosts(limit = 50) {
  return useQuery(api.api.posts.getPosts, { limit });
}

/**
 * Hook for single post by shortcode
 */
export function usePostByShortcode(shortcode: string) {
  return useQuery(api.api.posts.getByShortcode, { shortcode });
}

/**
 * Hook for single post by ID
 */
export function usePostById(id: string) {
  // biome-ignore lint/suspicious/noExplicitAny: Dynamic ID type from Convex
  return useQuery(api.api.posts.getById, { id } as any);
}

/**
 * Hook for posts by user ID
 */
export function usePostsByUserId(userId: string | undefined, limit = 50) {
  return useQuery(
    api.api.posts.getByUserId,
    userId ? { userId, limit } : "skip"
  );
}
