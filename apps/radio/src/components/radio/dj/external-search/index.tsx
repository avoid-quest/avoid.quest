import type { SearchPlatform } from "@avoid.quest/platforms";
import { useEffect, useReducer, useState } from "react";
import type { Radio } from "@/lib/audio";
import {
  createExternalSearchState,
  reduceExternalSearchState,
} from "./external-search-state";
import { SearchInput } from "./search-input";
import { SearchResults } from "./search-results";
import { UrlInput } from "./url-input";

type ExternalSearchProps = {
  onLoad: (radio: Radio) => void;
  onCancel?: () => void;
  initialPlatform?: SearchPlatform;
};

export function ExternalSearch({
  onLoad,
  onCancel,
  initialPlatform,
}: ExternalSearchProps) {
  const [{ error, platform, results }, dispatchSearchState] = useReducer(
    reduceExternalSearchState,
    initialPlatform,
    createExternalSearchState
  );
  const [bandcampFilter, setBandcampFilter] = useState<"" | "t" | "a">("t");
  const [youtubeFilter, setYoutubeFilter] = useState<"songs" | "videos">(
    "songs"
  );
  const isLocked = initialPlatform !== undefined && initialPlatform !== "all";

  const clearResults = () => {
    dispatchSearchState({ type: "clear" });
  };

  useEffect(() => {
    dispatchSearchState({ initialPlatform, type: "reset" });
  }, [initialPlatform]);

  const handlePlatformChange = (nextPlatform: SearchPlatform) => {
    dispatchSearchState({ platform: nextPlatform, type: "platform" });
  };

  const handleBandcampFilterChange = (filter: "" | "t" | "a") => {
    clearResults();
    setBandcampFilter(filter);
  };

  const handleYoutubeFilterChange = (filter: "songs" | "videos") => {
    clearResults();
    setYoutubeFilter(filter);
  };

  const searchContextKey = [
    initialPlatform ?? "unlocked",
    platform,
    bandcampFilter,
    youtubeFilter,
  ].join(":");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-2">
      <SearchInput
        bandcampFilter={bandcampFilter}
        locked={isLocked}
        onBandcampFilterChange={handleBandcampFilterChange}
        onClearResults={clearResults}
        onError={(message) => {
          dispatchSearchState({ error: message, type: "error" });
        }}
        onPlatformChange={handlePlatformChange}
        onResults={(nextResults) => {
          dispatchSearchState({ results: nextResults, type: "results" });
        }}
        onYoutubeFilterChange={handleYoutubeFilterChange}
        platform={platform}
        searchContextKey={searchContextKey}
        youtubeFilter={youtubeFilter}
      />

      <SearchResults error={error} onLoad={onLoad} results={results} />

      <UrlInput onCancel={onCancel} onLoad={onLoad} />
    </div>
  );
}
