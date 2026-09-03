// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
import type {
  SearchPlatform,
  UnifiedSearchResult,
} from "@avoid.quest/platforms";
import { useState } from "react";
import type { Radio } from "@/lib/audio";
import { SearchInput } from "./search-input";
import { SearchResults } from "./search-results";
import { UrlInput } from "./url-input";

type ExternalSearchProps = {
  onLoad: (radio: Radio) => void;
  onCancel?: () => void;
  initialPlatform?: SearchPlatform;
};

type ExternalSearchContentProps = {
  onLoad: (radio: Radio) => void;
  onCancel?: () => void;
  lockedPlatform?: SearchPlatform;
};

function ExternalSearchContent({
  onLoad,
  onCancel,
  lockedPlatform,
}: ExternalSearchContentProps) {
  const [selectedPlatform, setSelectedPlatform] =
    useState<SearchPlatform>("all");
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<UnifiedSearchResult[]>([]);
  const [bandcampFilter, setBandcampFilter] = useState<"" | "t" | "a">("t");
  const [youtubeFilter, setYoutubeFilter] = useState<"songs" | "videos">(
    "songs"
  );
  const platform = lockedPlatform ?? selectedPlatform;

  const clearResults = () => {
    setError(null);
    setResults([]);
  };

  const handlePlatformChange = (nextPlatform: SearchPlatform) => {
    clearResults();
    setSelectedPlatform(nextPlatform);
  };

  const handleBandcampFilterChange = (filter: "" | "t" | "a") => {
    clearResults();
    setBandcampFilter(filter);
  };

  const handleYoutubeFilterChange = (filter: "songs" | "videos") => {
    clearResults();
    setYoutubeFilter(filter);
  };
  const handleError = (message: string) => {
    setError(message);
    setResults([]);
  };
  const handleResults = (nextResults: UnifiedSearchResult[]) => {
    setError(null);
    setResults(nextResults);
  };

  const searchContextKey = [
    lockedPlatform ?? "unlocked",
    platform,
    bandcampFilter,
    youtubeFilter,
  ].join(":");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-2">
      <SearchInput
        bandcampFilter={bandcampFilter}
        locked={lockedPlatform !== undefined}
        onBandcampFilterChange={handleBandcampFilterChange}
        onClearResults={clearResults}
        onError={handleError}
        onPlatformChange={handlePlatformChange}
        onResults={handleResults}
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

export function ExternalSearch(props: ExternalSearchProps) {
  const lockedPlatform =
    props.initialPlatform && props.initialPlatform !== "all"
      ? props.initialPlatform
      : undefined;

  return (
    <ExternalSearchContent
      key={lockedPlatform ?? "unlocked"}
      lockedPlatform={lockedPlatform}
      onCancel={props.onCancel}
      onLoad={props.onLoad}
    />
  );
}
