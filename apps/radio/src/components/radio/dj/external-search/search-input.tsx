// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
import type {
  SearchPlatform,
  UnifiedSearchResult,
} from "@avoid.quest/platforms";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@avoid.quest/ui/components/select";
import { useLayoutEffect, useRef, useState } from "react";
import { getPlatformSourceColor } from "@/lib/dj-library-sources";
import { useExternalSearch } from "@/lib/hooks/use-external-search";
import { SearchField } from "../../search-field";
import { createSearchRequestGuard } from "./search-request-guard";

type SearchInputProps = {
  platform: SearchPlatform;
  onPlatformChange: (platform: SearchPlatform) => void;
  bandcampFilter: "" | "t" | "a";
  onBandcampFilterChange: (filter: "" | "t" | "a") => void;
  onClearResults: () => void;
  onError: (message: string) => void;
  onResults: (results: UnifiedSearchResult[]) => void;
  youtubeFilter: "songs" | "videos";
  onYoutubeFilterChange: (filter: "songs" | "videos") => void;
  searchContextKey: string;
  locked?: boolean;
  /**
   * Whether the platform select (or the locked platform's badge) shows.
   * Off where the caller picks the platform itself, e.g. Node's chips.
   */
  showPlatform?: boolean;
  /** Return true when the query was handled as a direct link. */
  onDirectLink?: (url: string) => boolean;
};

const PLATFORM_HINTS: Record<SearchPlatform, string> = {
  all: "Tracks from all platforms",
  bandcamp: "Tracks & albums from independent artists",
  mixcloud: "DJ mixes, radio shows & podcasts",
  radiogarden: "40,000+ radio stations worldwide",
  soundcloud: "Tracks, mixes & DJ sets",
  youtube: "Music videos & audio",
};

const PLATFORM_LABELS: Record<SearchPlatform, string> = {
  all: "All platforms",
  bandcamp: "Bandcamp",
  mixcloud: "Mixcloud",
  radiogarden: "Radio Garden",
  soundcloud: "SoundCloud",
  youtube: "YouTube",
};

const PLATFORM_OPTIONS = [
  "bandcamp",
  "mixcloud",
  "radiogarden",
  "soundcloud",
  "youtube",
] as const satisfies SearchPlatform[];

function PlatformDot({ platform }: { platform: SearchPlatform }) {
  return (
    <span
      className="size-2 shrink-0 rounded-full"
      style={{
        backgroundColor: getPlatformSourceColor(
          platform === "all" ? "external" : platform
        ),
      }}
    />
  );
}

export function SearchInput({
  platform,
  onPlatformChange,
  bandcampFilter,
  onBandcampFilterChange,
  onClearResults,
  onError,
  onResults,
  youtubeFilter,
  onYoutubeFilterChange,
  searchContextKey,
  locked,
  showPlatform = true,
  onDirectLink,
}: SearchInputProps) {
  const [query, setQuery] = useState("");
  const { mutate: search, isPending, reset } = useExternalSearch();
  const requestGuard = useRef(createSearchRequestGuard()).current;

  useLayoutEffect(() => {
    requestGuard.setContext(searchContextKey);
    reset();
  }, [requestGuard, reset, searchContextKey]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (isPending || !query.trim()) {
      return;
    }
    if (onDirectLink?.(query.trim())) {
      setQuery("");
      return;
    }
    onClearResults();
    const isCurrentRequest = requestGuard.begin(searchContextKey);
    search(
      {
        bandcampFilter: platform === "bandcamp" ? bandcampFilter : undefined,
        platform,
        query: query.trim(),
        youtubeFilter: platform === "youtube" ? youtubeFilter : undefined,
      },
      {
        onError: (error) => {
          if (isCurrentRequest()) {
            onError(error.message);
          }
        },
        onSuccess: (results) => {
          if (isCurrentRequest()) {
            onResults(results);
          }
        },
      }
    );
  };
  const handlePlatformChange = (value: string) =>
    onPlatformChange(value as SearchPlatform);
  const handleQueryChange = (event: React.ChangeEvent<HTMLInputElement>) =>
    setQuery(event.target.value);
  const handleBandcampFilterChange = (value: string) =>
    onBandcampFilterChange(value === "all" ? "" : (value as "t" | "a"));
  const handleYoutubeFilterChange = (value: string) =>
    onYoutubeFilterChange(value as "songs" | "videos");

  const platformControl = locked ? (
    <div className="flex h-8 w-[120px] shrink-0 items-center gap-1.5 rounded-md border border-input px-3 text-xs dark:bg-input/30">
      <PlatformDot platform={platform} />
      <span className="truncate">{PLATFORM_LABELS[platform]}</span>
    </div>
  ) : (
    <Select onValueChange={handlePlatformChange} value={platform}>
      <SelectTrigger
        aria-label="Platform"
        className="w-[120px] shrink-0 text-xs"
        size="sm"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Search</SelectLabel>
          <SelectItem value="all">All platforms</SelectItem>
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>One platform</SelectLabel>
          {PLATFORM_OPTIONS.map((option) => (
            <SelectItem key={option} value={option}>
              <span className="flex items-center gap-1.5">
                <PlatformDot platform={option} />
                {PLATFORM_LABELS[option]}
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );

  return (
    <form className="flex flex-col gap-2" onSubmit={handleSubmit}>
      <div className="flex gap-2">
        {showPlatform ? platformControl : null}

        <SearchField
          aria-label="Search or paste a link"
          className="min-w-0 flex-1"
          isSearching={isPending}
          maxLength={2048}
          onChange={handleQueryChange}
          placeholder="Search, or paste a link"
          readOnly={isPending}
          value={query}
        />
      </div>

      {/* Platform hint */}
      <p className="text-muted-foreground text-xs">
        {PLATFORM_HINTS[platform]}
      </p>

      {/* Platform-specific filters */}
      {platform === "bandcamp" && (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">Type</span>
          <Select
            onValueChange={handleBandcampFilterChange}
            value={bandcampFilter === "" ? "all" : bandcampFilter}
          >
            <SelectTrigger
              aria-label="Result type"
              className="w-[90px]"
              size="xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="t">Tracks</SelectItem>
              <SelectItem value="a">Albums</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {platform === "youtube" && (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">Type</span>
          <Select
            onValueChange={handleYoutubeFilterChange}
            value={youtubeFilter}
          >
            <SelectTrigger
              aria-label="Result type"
              className="w-[90px]"
              size="xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="songs">Songs</SelectItem>
              <SelectItem value="videos">Videos</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </form>
  );
}
