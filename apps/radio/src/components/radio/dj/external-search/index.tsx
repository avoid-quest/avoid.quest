// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers

import { Button } from "@avoid.quest/ui/components/button";
import { cn } from "@avoid.quest/ui/lib/utils";
import { useEffect, useRef, useState } from "react";
import type { Radio } from "@/lib/audio";
import { detectPlatformFromUrl } from "@/lib/external-url/detect";
import { useDjTrackLoad } from "@/lib/hooks/use-dj-track-load";
import { loadStreamStation } from "@/lib/node-source-loaders";
import type {
  SourceSearchPlatform as SearchPlatform,
  SourceSearchResult as UnifiedSearchResult,
} from "@/lib/source-search-workflow";
import { SearchInput } from "./search-input";
import { SearchResults } from "./search-results";

type ExternalSearchProps = {
  mode?: "dj" | "node";
  radios?: readonly Radio[];
  children?: React.ReactNode;
  onLoad: (radio: Radio) => void;
  onPlatformChange?: (platform: SearchPlatform) => void;
  onSearchChange?: () => () => boolean;
  onCancel?: () => void;
  initialPlatform?: SearchPlatform;
  /**
   * Whether the search shows its own platform select. Off where the caller
   * picks the platform with its own control, e.g. Node's Track chips.
   */
  showPlatform?: boolean;
  /**
   * Optional handoff for direct station links. Otherwise station intake
   * validates and loads the link through the shared search surface.
   */
  onOtherLink?: (url: string) => void;
};

type ExternalSearchContentProps = Omit<
  ExternalSearchProps,
  "initialPlatform"
> & {
  presetPlatform?: SearchPlatform;
};

const HTTP_LINK = /^https?:\/\/\S+$/i;

function ExternalSearchContent({
  mode,
  children,
  radios,
  onLoad,
  onCancel,
  presetPlatform,
  showPlatform,
  onOtherLink,
  onPlatformChange,
  onSearchChange,
}: ExternalSearchContentProps) {
  const [selectedPlatform, setSelectedPlatform] = useState<SearchPlatform>(
    presetPlatform ?? "all"
  );
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<UnifiedSearchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [bandcampFilter, setBandcampFilter] = useState<"" | "t" | "a">("t");
  const [youtubeFilter, setYoutubeFilter] = useState<"songs" | "videos">(
    "songs"
  );
  const platform = selectedPlatform;
  // Links and results resolve independently; only the latest pick may load,
  // and a new search or filter drops a pending one.
  const latestPick = useRef<"link" | "result" | "stream" | null>(null);
  const streamGeneration = useRef(0);
  const sourceRequest = useRef<(() => boolean) | undefined>(undefined);
  const isCurrentPick = () => sourceRequest.current?.() ?? true;
  const [isLoadingStream, setIsLoadingStream] = useState(false);

  useEffect(
    () => () => {
      latestPick.current = null;
      streamGeneration.current += 1;
    },
    []
  );

  const clearResults = () => {
    sourceRequest.current = onSearchChange?.();
    latestPick.current = null;
    streamGeneration.current += 1;
    setIsLoadingStream(false);
    setError(null);
    setResults([]);
    setHasSearched(false);
    setIsSearching(false);
  };

  const handlePlatformChange = (nextPlatform: SearchPlatform) => {
    clearResults();
    setSelectedPlatform(nextPlatform);
    onPlatformChange?.(nextPlatform);
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
    mode,
    onError: (message) => {
      if (latestPick.current === "link" && isCurrentPick()) {
        setError(message);
      }
    },
    onLoad: (radio) => {
      if (latestPick.current === "link" && isCurrentPick()) {
        onLoad(radio);
      }
    },
  });
  const handleDirectLink = (value: string) => {
    if (!detectPlatformFromUrl(value)) {
      if (HTTP_LINK.test(value)) {
        clearResults();
        if (onOtherLink) {
          onOtherLink(value);
        } else {
          latestPick.current = "stream";
          const generation = streamGeneration.current;
          setIsLoadingStream(true);
          loadStreamStation(value)
            .then((loaded) => {
              if (
                !isCurrentPick() ||
                latestPick.current !== "stream" ||
                generation !== streamGeneration.current
              ) {
                return;
              }
              setIsLoadingStream(false);
              if ("error" in loaded) {
                setError(loaded.error);
              } else {
                onLoad(loaded.radio);
              }
            })
            .catch((cause: unknown) => {
              if (
                !isCurrentPick() ||
                latestPick.current !== "stream" ||
                generation !== streamGeneration.current
              ) {
                return;
              }
              setIsLoadingStream(false);
              setError(
                cause instanceof Error
                  ? cause.message
                  : "Couldn’t load this stream"
              );
            });
        }
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
    sourceRequest.current = onSearchChange?.();
    latestPick.current = "result";
  };
  const handleResultLoad = (radio: Radio) => {
    if (latestPick.current === "result" && isCurrentPick()) {
      onLoad(radio);
    }
  };

  const searchContextKey = [
    presetPlatform ?? "unlocked",
    platform,
    bandcampFilter,
    youtubeFilter,
  ].join(":");

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-3 overflow-hidden py-2",
        mode === "node" && results.length > 0 && "h-80 flex-none"
      )}
    >
      <SearchInput
        bandcampFilter={bandcampFilter}
        locked={false}
        onBandcampFilterChange={handleBandcampFilterChange}
        onClearResults={clearResults}
        onDirectLink={handleDirectLink}
        onError={handleError}
        onPlatformChange={handlePlatformChange}
        onResults={handleResults}
        onSearchingChange={setIsSearching}
        onYoutubeFilterChange={handleYoutubeFilterChange}
        platform={platform}
        radios={radios}
        searchContextKey={searchContextKey}
        showPlatform={showPlatform}
        youtubeFilter={youtubeFilter}
      />

      {!(hasSearched || isSearching || error || results.length) && children ? (
        children
      ) : (
        <SearchResults
          error={error}
          isCurrentPick={isCurrentPick}
          mode={mode}
          onLoad={handleResultLoad}
          onPick={handleResultPick}
          results={results}
          showEmpty={hasSearched && !isSearching}
        />
      )}

      <div className="flex shrink-0 items-center justify-between gap-2 border-border/50 border-t pt-2 text-muted-foreground text-xs">
        <span>
          {isLoadingLink || isLoadingStream
            ? "Loading link…"
            : "Paste Spotify links or direct audio URLs too."}
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
  const presetPlatform =
    props.initialPlatform && props.initialPlatform !== "all"
      ? props.initialPlatform
      : undefined;

  return (
    <ExternalSearchContent
      key={presetPlatform ?? "unlocked"}
      mode={props.mode}
      onCancel={props.onCancel}
      onLoad={props.onLoad}
      onOtherLink={props.onOtherLink}
      onPlatformChange={props.onPlatformChange}
      onSearchChange={props.onSearchChange}
      presetPlatform={presetPlatform}
      radios={props.radios}
      showPlatform={props.showPlatform}
    >
      {props.children}
    </ExternalSearchContent>
  );
}
