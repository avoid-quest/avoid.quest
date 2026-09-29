// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
import type {
  SearchPlatform,
  UnifiedSearchResult,
} from "@avoid.quest/platforms";
import { Button } from "@avoid.quest/ui/components/button";
import { useState } from "react";
import type { Radio } from "@/lib/audio";
import { detectPlatformFromUrl } from "@/lib/external-url/detect";
import { useDjTrackLoad } from "@/lib/hooks/use-dj-track-load";
import { SearchInput } from "./search-input";
import { SearchResults } from "./search-results";

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
  const [hasSearched, setHasSearched] = useState(false);
  const [bandcampFilter, setBandcampFilter] = useState<"" | "t" | "a">("t");
  const [youtubeFilter, setYoutubeFilter] = useState<"songs" | "videos">(
    "songs"
  );
  const platform = lockedPlatform ?? selectedPlatform;

  const clearResults = () => {
    setError(null);
    setResults([]);
    setHasSearched(false);
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
    setHasSearched(true);
  };

  const { mutate: loadLink, isPending: isLoadingLink } = useDjTrackLoad({
    onError: (message) => setError(message),
    onLoad: (radio) => onLoad(radio),
  });
  const handleDirectLink = (value: string) => {
    if (!detectPlatformFromUrl(value)) {
      return false;
    }
    clearResults();
    loadLink(value);
    return true;
  };

  const searchContextKey = [
    lockedPlatform ?? "unlocked",
    platform,
    bandcampFilter,
    youtubeFilter,
  ].join(":");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden py-2">
      <SearchInput
        bandcampFilter={bandcampFilter}
        locked={lockedPlatform !== undefined}
        onBandcampFilterChange={handleBandcampFilterChange}
        onClearResults={clearResults}
        onDirectLink={handleDirectLink}
        onError={handleError}
        onPlatformChange={handlePlatformChange}
        onResults={handleResults}
        onYoutubeFilterChange={handleYoutubeFilterChange}
        platform={platform}
        searchContextKey={searchContextKey}
        youtubeFilter={youtubeFilter}
      />

      <SearchResults
        error={error}
        onLoad={onLoad}
        results={results}
        showEmpty={hasSearched}
      />

      <div className="flex items-center justify-between gap-2 border-border/50 border-t pt-2 text-muted-foreground text-xs">
        <span>
          {isLoadingLink
            ? "Loading link…"
            : "Bandcamp, SoundCloud, YouTube and audio links work too."}
        </span>
        {onCancel ? (
          <Button
            className="h-7 text-xs"
            onClick={onCancel}
            size="sm"
            variant="ghost"
          >
            Cancel
          </Button>
        ) : null}
      </div>
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
