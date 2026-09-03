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
  query: z.string().min(1, "Search query is required").max(200),
  filter: z.enum(["", "t", "a", "b"]).optional().default(""),
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
        operation: "bandcampSearch",
        fallback: {
          code: "BANDCAMP_SEARCH_FAILED",
          safeMessage: "Search failed",
          category: "dependency",
          expected: false,
          status: 500,
        },
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
        operation: "soundcloudSearch",
        fallback: {
          code: "SOUNDCLOUD_SEARCH_FAILED",
          safeMessage: "Search failed",
          category: "dependency",
          expected: false,
          status: 500,
        },
        run: async () => {
          const clientId = await getSoundCloudClientId();
          const results = await searchSoundCloud(data.query, clientId);
          return { results };
        },
      })
  );
