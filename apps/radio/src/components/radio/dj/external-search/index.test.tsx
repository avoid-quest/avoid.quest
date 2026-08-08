import { describe, expect, test } from "bun:test";
import type { UnifiedSearchResult } from "@avoid.quest/platforms";
import {
  createExternalSearchState,
  reduceExternalSearchState,
} from "./external-search-state";

const RESULT: UnifiedSearchResult = {
  artist: "Artist",
  id: "bc-1",
  platform: "bandcamp",
  title: "Bandcamp result",
  type: "track",
  url: "https://artist.bandcamp.com/track/example",
};

describe("external search state", () => {
  test("resets provider state and stale results when its locked provider changes", () => {
    const initial = createExternalSearchState("bandcamp");
    const withResults = reduceExternalSearchState(initial, {
      results: [RESULT],
      type: "results",
    });

    expect(withResults.results).toEqual([RESULT]);
    expect(
      reduceExternalSearchState(withResults, {
        initialPlatform: "soundcloud",
        type: "reset",
      })
    ).toEqual({
      error: null,
      platform: "soundcloud",
      results: [],
    });
  });
});
