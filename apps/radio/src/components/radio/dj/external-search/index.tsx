import type {
  SearchPlatform,
  UnifiedSearchResult,
} from "@avoid.quest/platforms";
import { useEffect, useState } from "react";
import type { Radio } from "@/lib/audio";
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
  const [platform, setPlatform] = useState<SearchPlatform>(
    initialPlatform ?? "all"
  );
  const [bandcampFilter, setBandcampFilter] = useState<"" | "t" | "a">("t");
  const [youtubeFilter, setYoutubeFilter] = useState<"songs" | "videos">(
    "songs"
  );
  const [results, setResults] = useState<UnifiedSearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const isLocked = initialPlatform !== undefined && initialPlatform !== "all";

  const clearResults = () => {
    setResults([]);
    setError(null);
  };

  useEffect(() => {
    setPlatform(initialPlatform ?? "all");
    setResults([]);
    setError(null);
  }, [initialPlatform]);

  const handlePlatformChange = (nextPlatform: SearchPlatform) => {
    clearResults();
    setPlatform(nextPlatform);
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
          setError(message);
          setResults([]);
        }}
        onPlatformChange={handlePlatformChange}
        onResults={(nextResults) => {
          setResults(nextResults);
          setError(null);
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
