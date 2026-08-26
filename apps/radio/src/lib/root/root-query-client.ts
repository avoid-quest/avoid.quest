import { QueryClient } from "@tanstack/react-query";

export function createRootQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: 5 * 60 * 1000,
        staleTime: 60 * 1000,
      },
    },
  });
}
