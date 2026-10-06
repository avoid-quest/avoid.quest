import { runServerFn } from "@avoid.quest/error";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { workerMetadataCache } from "@/lib/metadata/edge-cache";
import { searchCachedRadioBrowser } from "@/lib/stations/directory-cache";
import { rateLimitMiddleware } from "./middleware";
import { validateServerInput } from "./server-input";

export const radioBrowserSearch = createServerFn({ method: "POST" })
  .middleware([rateLimitMiddleware("radio-browser-search")])
  .validator(
    validateServerInput(
      z.object({
        limit: z.number().int().min(1).max(100),
        query: z.string().trim().min(1).max(200),
      })
    )
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
          workerMetadataCache,
          data.query,
          data.limit
        ),
      }),
    })
  );
