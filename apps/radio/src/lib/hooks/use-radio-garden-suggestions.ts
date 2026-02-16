import type { RadioGardenSearchResult } from "@avoid.quest/platforms";
import { useQuery } from "@tanstack/react-query";
import { radioGardenSuggestions } from "@/utils/radio-garden.functions";

export function useRadioGardenSuggestions(enabled: boolean) {
  return useQuery({
    queryKey: ["radio-garden-suggestions"],
    queryFn: async (): Promise<RadioGardenSearchResult[]> => {
      const response = await radioGardenSuggestions();
      if (!response.ok) {
        throw new Error(response.error.message);
      }
      return response.data.results;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    enabled,
  });
}
