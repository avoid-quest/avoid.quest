import { fetchPins, PinterestError } from "@avoid.quest/pinterest";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useUsername } from "./use-settings";

export function usePins() {
  const username = useUsername();

  return useInfiniteQuery({
    queryKey: ["pins", username],
    queryFn: ({ pageParam }) => fetchPins({ username, bookmark: pageParam }),
    initialPageParam: "",
    getNextPageParam: (lastPage) => lastPage.nextBookmark,
    enabled: Boolean(username),
    staleTime: 5 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: (failureCount, error) => {
      // Don't retry on 404 (user not found)
      if (error instanceof PinterestError && error.status === 404) {
        return false;
      }
      return failureCount < 3;
    },
  });
}

/**
 * Invalidate pins when username changes
 */
export function useInvalidatePins() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["pins"] });
}
