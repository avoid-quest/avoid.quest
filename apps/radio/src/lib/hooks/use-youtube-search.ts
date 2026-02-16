import { useMutation } from "@tanstack/react-query";
import type { YouTubeSearchResult } from "@/lib/platform-types";
import { youtubeSearch } from "@/utils/youtube.functions";

export function useYouTubeSearch() {
  return useMutation({
    mutationFn: async ({
      query,
      filter,
    }: {
      query: string;
      filter?: "songs" | "videos";
    }): Promise<YouTubeSearchResult[]> => {
      const response = await youtubeSearch({ data: { query, filter } });
      if (!response.ok) {
        throw new Error(response.error.message);
      }
      return response.data.results;
    },
  });
}
