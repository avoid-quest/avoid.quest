// Import directly from search modules to avoid pulling in cheerio (not compatible with CF Workers)
import {
  type BandcampSearchFilter,
  type BandcampSearchResult,
  searchBandcamp,
} from "@avoid.quest/bandcamp/search";
import { fetchClientID } from "@avoid.quest/soundcloud/fetch-client";
import {
  type SoundCloudSearchResult,
  searchSoundCloud,
} from "@avoid.quest/soundcloud/search";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { rateLimitMiddleware } from "./middleware";

// ============================================
// Bandcamp Search
// ============================================

const BandcampSearchSchema = z.object({
  query: z.string().min(1, "Search query is required").max(200),
  filter: z.enum(["", "t", "a", "b"]).optional().default(""),
});

export type BandcampSearchResponse =
  | { success: true; results: BandcampSearchResult[] }
  | { success: false; error: string };

export const bandcampSearch = createServerFn({ method: "POST" })
  .middleware([rateLimitMiddleware("bandcamp-search")])
  .inputValidator(BandcampSearchSchema)
  .handler(async ({ data }): Promise<BandcampSearchResponse> => {
    try {
      const results = await searchBandcamp(
        data.query,
        data.filter as BandcampSearchFilter
      );
      return { success: true, results };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Search failed";
      return { success: false, error: errorMessage };
    }
  });

// ============================================
// SoundCloud Search
// ============================================

const SoundCloudSearchSchema = z.object({
  query: z.string().min(1, "Search query is required").max(200),
});

export type SoundCloudSearchResponse =
  | { success: true; results: SoundCloudSearchResult[] }
  | { success: false; error: string };

// Cache client ID on server side
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
  .inputValidator(SoundCloudSearchSchema)
  .handler(async ({ data }): Promise<SoundCloudSearchResponse> => {
    try {
      const clientId = await getSoundCloudClientId();
      const results = await searchSoundCloud(data.query, clientId);
      return { success: true, results };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Search failed";
      return { success: false, error: errorMessage };
    }
  });
