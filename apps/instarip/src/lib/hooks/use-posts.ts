import { usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/lib/convex";

/**
 * Hook for paginated posts
 */
export function usePaginatedPosts(pageSize = 20) {
  return usePaginatedQuery(
    api.api.posts.getPaginated,
    {},
    { initialNumItems: pageSize }
  );
}

/**
 * Hook for recent posts (simple limit-based)
 */
export function useRecentPosts(limit = 20) {
  return useQuery(api.api.posts.getRecent, { limit });
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
