import { Button } from "@avoid.quest/ui/components/button";
import { Input } from "@avoid.quest/ui/components/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@avoid.quest/ui/components/select";
import { Loader2Icon, SearchIcon } from "lucide-react";
import { useState } from "react";
import type { Radio } from "@/lib/audio";
import { useExternalSearch } from "@/lib/hooks/use-external-search";
import type { SearchPlatform } from "@/lib/search-types";
import { useSearchResultsStore } from "./search-results-store";

type SearchInputProps = {
  platform: SearchPlatform;
  onPlatformChange: (platform: SearchPlatform) => void;
  bandcampFilter: "" | "t" | "a";
  onBandcampFilterChange: (filter: "" | "t" | "a") => void;
  youtubeFilter: "songs" | "videos";
  onYoutubeFilterChange: (filter: "songs" | "videos") => void;
  onLoad: (radio: Radio) => void;
};

const PLATFORM_HINTS: Record<SearchPlatform, string> = {
  all: "Tracks from all platforms",
  bandcamp: "Tracks & albums from independent artists",
  soundcloud: "Tracks, mixes & DJ sets",
  youtube: "Music videos & audio",
};

export function SearchInput({
  platform,
  onPlatformChange,
  bandcampFilter,
  onBandcampFilterChange,
  youtubeFilter,
  onYoutubeFilterChange,
}: SearchInputProps) {
  const [query, setQuery] = useState("");
  const { mutate: search, isPending } = useExternalSearch();
  const setResults = useSearchResultsStore((s) => s.setResults);
  const setError = useSearchResultsStore((s) => s.setError);
  const clearResults = useSearchResultsStore((s) => s.clearResults);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) {
      return;
    }
    clearResults();
    search(
      {
        query: query.trim(),
        platform,
        bandcampFilter: platform === "bandcamp" ? bandcampFilter : undefined,
        youtubeFilter: platform === "youtube" ? youtubeFilter : undefined,
      },
      {
        onSuccess: (results) => {
          setResults(results);
        },
        onError: (error) => {
          setError(error.message);
        },
      }
    );
  };

  return (
    <form className="flex flex-col gap-2" onSubmit={handleSubmit}>
      <div className="flex gap-2">
        <Select
          onValueChange={(v) => onPlatformChange(v as SearchPlatform)}
          value={platform}
        >
          <SelectTrigger className="h-8 w-[120px] shrink-0 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel className="text-[10px]">Search Platform</SelectLabel>
              <SelectItem value="all">All Platforms</SelectItem>
            </SelectGroup>
            <SelectGroup>
              <SelectLabel className="text-[10px]">Individual</SelectLabel>
              <SelectItem value="bandcamp">
                <span className="flex items-center gap-1.5">
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: "#629aa0" }}
                  />
                  Bandcamp
                </span>
              </SelectItem>
              <SelectItem value="soundcloud">
                <span className="flex items-center gap-1.5">
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: "#ff7700" }}
                  />
                  SoundCloud
                </span>
              </SelectItem>
              <SelectItem value="youtube">
                <span className="flex items-center gap-1.5">
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: "#ff0000" }}
                  />
                  YouTube
                </span>
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <div className="relative flex-1">
          <SearchIcon className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-8 pl-8 text-xs"
            disabled={isPending}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tracks, albums..."
            value={query}
          />
        </div>

        <Button
          className="h-8 shrink-0 px-3"
          disabled={isPending || !query.trim()}
          size="sm"
          type="submit"
        >
          {isPending ? (
            <Loader2Icon className="size-3 animate-spin" />
          ) : (
            <SearchIcon className="size-3" />
          )}
        </Button>
      </div>

      {/* Platform hint */}
      <p className="text-[10px] text-muted-foreground/70">
        {PLATFORM_HINTS[platform]}
      </p>

      {/* Platform-specific filters */}
      {platform === "bandcamp" && (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">Type:</span>
          <Select
            onValueChange={(v) =>
              onBandcampFilterChange(v === "all" ? "" : (v as "t" | "a"))
            }
            value={bandcampFilter === "" ? "all" : bandcampFilter}
          >
            <SelectTrigger className="h-6 w-[90px] text-xs">
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
          <span className="text-muted-foreground text-xs">Type:</span>
          <Select
            onValueChange={(v) =>
              onYoutubeFilterChange(v as "songs" | "videos")
            }
            value={youtubeFilter}
          >
            <SelectTrigger className="h-6 w-[90px] text-xs">
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
