import { useQuery } from "convex/react";
import { api } from "@/lib/convex";

/**
 * Hook for media items by post ID
 */
export function useMediaByPostId(postId: string) {
  return useQuery(api.api.media.getByPostId, { postId });
}
