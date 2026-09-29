// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
import type { UnifiedSearchResult } from "@avoid.quest/platforms";
import { ScrollArea } from "@avoid.quest/ui/components/scroll-area";
import { Spinner } from "@avoid.quest/ui/components/spinner";
import { cn } from "@avoid.quest/ui/lib/utils";
import { MusicIcon, PlayIcon } from "lucide-react";
import { useState } from "react";
import type { Radio } from "@/lib/audio";
import { getPlatformSourceColor } from "@/lib/dj-library-sources";
import { formatPlatformDuration } from "@/lib/external-url/utils";
import { useDjTrackLoad } from "@/lib/hooks/use-dj-track-load";
import { EmptyHint } from "../../empty-hint";
import { InlineError } from "../../inline-error";
import {
  StationRowSubtitle,
  StationRowText,
  stationRowButtonOnlyClassName,
} from "../../station-row";

type SearchResultsProps = {
  error: string | null;
  onLoad: (radio: Radio) => void;
  results: UnifiedSearchResult[];
  showEmpty?: boolean;
};

const PLATFORM_LABELS = {
  bandcamp: "BC",
  radiogarden: "RG",
  soundcloud: "SC",
  youtube: "YT",
};

function ResultItem({
  result,
  onLoad,
  onError,
  isDisabled,
  isLoading,
  onLoadingChange,
}: {
  result: UnifiedSearchResult;
  onLoad: (radio: Radio) => void;
  onError: (message: string) => void;
  isDisabled: boolean;
  isLoading: boolean;
  onLoadingChange: (loading: boolean) => void;
}) {
  const { mutate: loadItem, isPending } = useDjTrackLoad({
    onError,
    onLoad: (radio) => {
      onError("");
      onLoad(radio);
    },
    onSettled: () => onLoadingChange(false),
  });

  const handleClick = () => {
    onError("");
    onLoadingChange(true);
    loadItem(result.url);
  };

  const platformColor = getPlatformSourceColor(result.platform);
  const platformLabel = PLATFORM_LABELS[result.platform];
  const showLoading = isPending || isLoading;

  return (
    <button
      className={cn(stationRowButtonOnlyClassName, "disabled:opacity-50")}
      disabled={isDisabled}
      onClick={handleClick}
      type="button"
    >
      <div className="relative size-10 shrink-0 overflow-hidden rounded-sm border border-border/70 bg-muted">
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
        <div
          className="absolute bottom-0 left-0 px-1 font-bold font-mono text-[9px] text-white"
          style={{ backgroundColor: platformColor }}
        >
          {platformLabel}
        </div>
      </div>

      <StationRowText title={result.title}>
        <StationRowSubtitle>
          {[
            result.artist,
            result.duration ? formatPlatformDuration(result.duration) : null,
            result.type === "track" || result.type === "video"
              ? null
              : result.type,
          ]
            .filter(Boolean)
            .join(" · ")}
        </StationRowSubtitle>
      </StationRowText>

      {showLoading ? (
        <Spinner className="size-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <PlayIcon className="size-3.5 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" />
      )}
    </button>
  );
}

function ManagedResultItem({
  result,
  loadingId,
  onLoad,
  onError,
  onLoadingIdChange,
}: {
  result: UnifiedSearchResult;
  loadingId: string | null;
  onLoad: (radio: Radio) => void;
  onError: (message: string) => void;
  onLoadingIdChange: (id: string | null) => void;
}) {
  const handleLoadingChange = (loading: boolean) =>
    onLoadingIdChange(loading ? result.id : null);

  return (
    <ResultItem
      isDisabled={loadingId !== null}
      isLoading={loadingId === result.id}
      onError={onError}
      onLoad={onLoad}
      onLoadingChange={handleLoadingChange}
      result={result}
    />
  );
}

export function SearchResults({
  error,
  onLoad,
  results,
  showEmpty = false,
}: SearchResultsProps) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  if (error) {
    return <InlineError>{error}</InlineError>;
  }

  if (results.length === 0) {
    return showEmpty ? (
      <EmptyHint>Nothing found. Try another search or platform.</EmptyHint>
    ) : null;
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-2">
        {!!loadError?.trim() && <InlineError>{loadError}</InlineError>}

        <div className="flex w-0 min-w-full flex-col gap-1">
          {results.map((result) => (
            <ManagedResultItem
              key={result.id}
              loadingId={loadingId}
              onError={setLoadError}
              onLoad={onLoad}
              onLoadingIdChange={setLoadingId}
              result={result}
            />
          ))}
        </div>
      </div>
    </ScrollArea>
  );
}
