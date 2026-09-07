import { runServerFn } from "@avoid.quest/error";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { metadataEdgeStore } from "@/lib/metadata/edge-store.server";
import { searchCachedRadioBrowser } from "@/lib/stations/directory-cache";
import { rateLimitMiddleware } from "./middleware";

export const radioBrowserSearch = createServerFn({ method: "POST" })
  .middleware([rateLimitMiddleware("radio-browser-search")])
  .validator(
    z.object({
      limit: z.number().int().min(1).max(100),
      query: z.string().trim().min(1).max(200),
    })
  )
  .handler(({ data }) =>
    runServerFn({
      fallback: {
        category: "dependency",
        code: "RADIO_BROWSER_SEARCH_FAILED",
        expected: false,
        safeMessage: "Search failed",
        status: 500,
      },
      operation: "radioBrowserSearch",
      run: async () => ({
        results: await searchCachedRadioBrowser(
          metadataEdgeStore,
          data.query,
          data.limit
        ),
      }),
    })
  );
