// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
import type {
  SearchPlatform,
  UnifiedSearchResult,
} from "@avoid.quest/platforms";
import { Button } from "@avoid.quest/ui/components/button";
import { useRef, useState } from "react";
import type { Radio } from "@/lib/audio";
import { detectPlatformFromUrl } from "@/lib/external-url/detect";
import { useDjTrackLoad } from "@/lib/hooks/use-dj-track-load";
import { SearchInput } from "./search-input";
import { SearchResults } from "./search-results";

type ExternalSearchProps = {
  onLoad: (radio: Radio) => void;
  onCancel?: () => void;
  initialPlatform?: SearchPlatform;
  /**
   * Whether the search shows its own platform select. Off where the caller
   * picks the platform with its own control, e.g. Node's Track chips.
   */
  showPlatform?: boolean;
  /**
   * An http(s) link that is no platform or audio link, e.g. a radio
   * stream; without it such a link is searched for.
   */
  onOtherLink?: (url: string) => void;
};

type ExternalSearchContentProps = Omit<
  ExternalSearchProps,
  "initialPlatform"
> & {
  lockedPlatform?: SearchPlatform;
};

const HTTP_LINK = /^https?:\/\/\S+$/i;

function ExternalSearchContent({
  onLoad,
  onCancel,
  lockedPlatform,
  showPlatform,
  onOtherLink,
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
  // Links and results resolve independently; only the latest pick may load,
  // and a new search or filter drops a pending one.
  const latestPick = useRef<"link" | "result" | null>(null);

  const clearResults = () => {
    latestPick.current = null;
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
    onError: (message) => {
      if (latestPick.current === "link") {
        setError(message);
      }
    },
    onLoad: (radio) => {
      if (latestPick.current === "link") {
        onLoad(radio);
      }
    },
  });
  const handleDirectLink = (value: string) => {
    if (!detectPlatformFromUrl(value)) {
      if (onOtherLink && HTTP_LINK.test(value)) {
        clearResults();
        latestPick.current = null;
        onOtherLink(value);
        return true;
      }
      return false;
    }
    clearResults();
    latestPick.current = "link";
    loadLink(value);
    return true;
  };
  const handleResultPick = () => {
    latestPick.current = "result";
  };
  const handleResultLoad = (radio: Radio) => {
    if (latestPick.current === "result") {
      onLoad(radio);
    }
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
        showPlatform={showPlatform}
        youtubeFilter={youtubeFilter}
      />

      <SearchResults
        error={error}
        onLoad={handleResultLoad}
        onPick={handleResultPick}
        results={results}
        showEmpty={hasSearched}
      />

      <div className="flex items-center justify-between gap-2 border-border/50 border-t pt-2 text-muted-foreground text-xs">
        <span>
          {isLoadingLink
            ? "Loading link…"
            : "Spotify, radio shows and audio links work too."}
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
      onOtherLink={props.onOtherLink}
      showPlatform={props.showPlatform}
    />
  );
}
