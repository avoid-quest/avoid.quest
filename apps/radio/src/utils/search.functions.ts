// Import directly from search modules to avoid pulling in cheerio (not compatible with CF Workers)
import { type AppResult, runServerFn } from "@avoid.quest/error";
import {
  type BandcampSearchResult,
  searchBandcamp,
} from "@avoid.quest/platforms/bandcamp/search";
import { fetchClientID } from "@avoid.quest/platforms/soundcloud/fetch-client";
import {
  type SoundCloudSearchResult,
  searchSoundCloud,
} from "@avoid.quest/platforms/soundcloud/search";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { rateLimitMiddleware } from "./middleware";

const BandcampSearchSchema = z.object({
  filter: z.enum(["", "t", "a", "b"]).optional().default(""),
  query: z.string().min(1, "Search query is required").max(200),
});

export type BandcampSearchResponse = AppResult<{
  results: BandcampSearchResult[];
}>;

export const bandcampSearch = createServerFn({ method: "POST" })
  .middleware([rateLimitMiddleware("bandcamp-search")])
  .validator(BandcampSearchSchema)
  .handler(
    ({ data }): Promise<BandcampSearchResponse> =>
      runServerFn({
        fallback: {
          category: "dependency",
          code: "BANDCAMP_SEARCH_FAILED",
          expected: false,
          safeMessage: "Search failed",
          status: 500,
        },
        operation: "bandcampSearch",
        run: async () => {
          const results = await searchBandcamp(data.query, data.filter);
          return { results };
        },
      })
  );

const SoundCloudSearchSchema = z.object({
  query: z.string().min(1, "Search query is required").max(200),
});

export type SoundCloudSearchResponse = AppResult<{
  results: SoundCloudSearchResult[];
}>;

let soundcloudClientId: string | null = null;
let clientIdPromise: Promise<string> | null = null;

function getSoundCloudClientId(): Promise<string> {
  if (soundcloudClientId) {
    return Promise.resolve(soundcloudClientId);
  }
  if (!clientIdPromise) {
    clientIdPromise = fetchClientID()
      .then((id) => {
        soundcloudClientId = id;
        return id;
      })
      .catch((error) => {
        clientIdPromise = null;
        throw error;
      });
  }
  return clientIdPromise;
}

export const soundcloudSearch = createServerFn({ method: "POST" })
  .middleware([rateLimitMiddleware("soundcloud-search")])
  .validator(SoundCloudSearchSchema)
  .handler(
    ({ data }): Promise<SoundCloudSearchResponse> =>
      runServerFn({
        fallback: {
          category: "dependency",
          code: "SOUNDCLOUD_SEARCH_FAILED",
          expected: false,
          safeMessage: "Search failed",
          status: 500,
        },
        operation: "soundcloudSearch",
        run: async () => {
          const clientId = await getSoundCloudClientId();
          const results = await searchSoundCloud(data.query, clientId);
          return { results };
        },
      })
  );
