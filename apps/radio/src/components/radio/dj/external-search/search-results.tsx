import type { UnifiedSearchResult } from "@avoid.quest/platforms";
import { ScrollArea } from "@avoid.quest/ui/components/scroll-area";
import { Loader2Icon, MusicIcon, PlayIcon } from "lucide-react";
import { useState } from "react";
import type { Radio } from "@/lib/audio";
import { formatPlatformDuration } from "@/lib/external-url/utils";
import { usePlatformLoad } from "@/lib/hooks/use-platform-query";
import { useSearchResultsStore } from "./search-results-store";

type SearchResultsProps = {
  onLoad: (radio: Radio) => void;
};

const PLATFORM_COLORS = {
  bandcamp: "#629aa0",
  soundcloud: "#ff7700",
  youtube: "#ff0000",
};

const PLATFORM_LABELS = {
  bandcamp: "BC",
  soundcloud: "SC",
  youtube: "YT",
};

function ResultItem({
  result,
  onLoad,
  isDisabled,
  isLoading,
  onLoadStart,
}: {
  result: UnifiedSearchResult;
  onLoad: (radio: Radio) => void;
  isDisabled: boolean;
  isLoading: boolean;
  onLoadStart: () => void;
}) {
  const { mutate: loadItem, isPending } = usePlatformLoad({
    onSuccess: (radio) => {
      onLoad(radio);
    },
    onError: () => {
      // Error handled by mutation
    },
  });

  const handleClick = () => {
    onLoadStart();
    loadItem(result.url);
  };

  const platformColor = PLATFORM_COLORS[result.platform];
  const platformLabel = PLATFORM_LABELS[result.platform];
  const showLoading = isPending || isLoading;

  return (
    <button
      className="flex w-full items-center gap-2 rounded p-2 text-left transition-colors hover:bg-accent disabled:opacity-50"
      disabled={isDisabled}
      onClick={handleClick}
      type="button"
    >
      {/* Thumbnail */}
      <div className="relative size-10 shrink-0 overflow-hidden rounded bg-muted">
        {result.thumbnail ? (
          <img
            alt=""
            className="size-full object-cover"
            height={40}
            src={result.thumbnail}
            width={40}
          />
        ) : (
          <div className="flex size-full items-center justify-center">
            <MusicIcon className="size-4 text-muted-foreground" />
          </div>
        )}
        {/* Platform badge */}
        <div
          className="absolute bottom-0 left-0 px-1 font-bold text-[9px] text-white"
          style={{ backgroundColor: platformColor }}
        >
          {platformLabel}
        </div>
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-xs">{result.title}</p>
        <p className="truncate text-muted-foreground text-xs">
          {result.artist}
          {result.duration
            ? ` · ${formatPlatformDuration(result.duration)}`
            : ""}
          {result.type !== "track" && result.type !== "video" && (
            <span
              className="ml-1 rounded px-1 py-0.5 text-[10px]"
              style={{
                backgroundColor: `${platformColor}20`,
                color: platformColor,
              }}
            >
              {result.type}
            </span>
          )}
        </p>
      </div>

      {/* Action */}
      <div className="shrink-0">
        {showLoading ? (
          <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
        ) : (
          <PlayIcon className="size-4 text-muted-foreground" />
        )}
      </div>
    </button>
  );
}

export function SearchResults({ onLoad }: SearchResultsProps) {
  const results = useSearchResultsStore((s) => s.results);
  const error = useSearchResultsStore((s) => s.error);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-center text-destructive text-xs">{error}</p>
      </div>
    );
  }

  if (results.length === 0) {
    return null;
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-0.5 pr-3">
        {results.map((result) => (
          <ResultItem
            isDisabled={loadingId !== null}
            isLoading={loadingId === result.id}
            key={result.id}
            onLoad={onLoad}
            onLoadStart={() => setLoadingId(result.id)}
            result={result}
          />
        ))}
      </div>
    </ScrollArea>
  );
}
