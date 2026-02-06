import { Button } from "@avoid.quest/ui/components/button";
import { Input } from "@avoid.quest/ui/components/input";
import { ScrollArea } from "@avoid.quest/ui/components/scroll-area";
import { Loader2Icon, PlayIcon, SearchIcon } from "lucide-react";
import { useState } from "react";
import type { Radio } from "@/lib/audio";
import { formatPlatformDuration } from "@/lib/external-url/utils";
import { usePlatformLoad } from "@/lib/hooks/use-platform-query";
import { useYouTubeSearch } from "@/lib/hooks/use-youtube-search";

type YouTubeSearchProps = {
  onLoad: (radio: Radio) => void;
};

export function YouTubeSearch({ onLoad }: YouTubeSearchProps) {
  const [query, setQuery] = useState("");
  const [loadingVideoId, setLoadingVideoId] = useState<string | null>(null);

  const {
    mutate: search,
    data: results,
    isPending: isSearching,
  } = useYouTubeSearch();

  const { mutate: loadItem, isPending: isLoadingItem } = usePlatformLoad({
    onSuccess: (radio) => {
      setLoadingVideoId(null);
      onLoad(radio);
    },
    onError: () => {
      setLoadingVideoId(null);
    },
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) {
      return;
    }
    search({ query: query.trim() });
  };

  const handleSelectResult = (videoId: string) => {
    setLoadingVideoId(videoId);
    loadItem(`https://youtube.com/watch?v=${videoId}`);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-muted-foreground">
        <SearchIcon className="size-4" />
        <span className="font-medium text-xs">Search YouTube Music</span>
      </div>

      <form className="flex gap-2" onSubmit={handleSearch}>
        <Input
          className="h-8 text-xs"
          disabled={isSearching}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search songs..."
          value={query}
        />
        <Button
          className="h-8 shrink-0 px-3"
          disabled={isSearching || !query.trim()}
          size="sm"
          type="submit"
        >
          {isSearching ? (
            <Loader2Icon className="size-3 animate-spin" />
          ) : (
            <SearchIcon className="size-3" />
          )}
        </Button>
      </form>

      {results && results.length > 0 && (
        <ScrollArea className="max-h-48">
          <div className="space-y-1">
            {results.map((result) => {
              const isLoading =
                isLoadingItem && loadingVideoId === result.videoId;
              return (
                <button
                  className="flex w-full items-center gap-2 rounded p-2 text-left transition-colors hover:bg-accent disabled:opacity-50"
                  disabled={isLoadingItem}
                  key={result.videoId}
                  onClick={() => handleSelectResult(result.videoId)}
                  type="button"
                >
                  {result.thumbnail && (
                    <img
                      alt=""
                      className="size-8 shrink-0 rounded object-cover"
                      height={32}
                      src={result.thumbnail}
                      width={32}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-xs">
                      {result.title}
                    </p>
                    <p className="truncate text-muted-foreground text-xs">
                      {result.author}
                      {result.duration
                        ? ` · ${formatPlatformDuration(result.duration)}`
                        : ""}
                    </p>
                  </div>
                  <div className="shrink-0">
                    {isLoading ? (
                      <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
                    ) : (
                      <PlayIcon className="size-4 text-muted-foreground" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      )}

      {results && results.length === 0 && (
        <p className="text-center text-muted-foreground text-xs">
          No results found
        </p>
      )}
    </div>
  );
}
