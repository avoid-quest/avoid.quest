// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers

import { ScrollArea } from "@avoid.quest/ui/components/scroll-area";
import { Spinner } from "@avoid.quest/ui/components/spinner";
import { cn } from "@avoid.quest/ui/lib/utils";
import { MusicIcon, PlayIcon } from "lucide-react";
import { useState } from "react";
import type { Radio } from "@/lib/audio";
import { getPlatformSourceColor } from "@/lib/dj-library-sources";
import { formatPlatformDuration } from "@/lib/external-url/utils";
import { useDjTrackLoad } from "@/lib/hooks/use-dj-track-load";
import type { SourceSearchResult as UnifiedSearchResult } from "@/lib/source-search-workflow";
import { EmptyHint } from "../../empty-hint";
import { InlineError } from "../../inline-error";
import {
  StationRowSubtitle,
  StationRowText,
  stationRowButtonOnlyClassName,
} from "../../station-row";

type SearchResultsProps = {
  mode?: "dj" | "node";
  error: string | null;
  onLoad: (radio: Radio) => void;
  /** Called when a result is picked, before it resolves. */
  onPick?: () => void;
  isCurrentPick?: () => boolean;
  results: UnifiedSearchResult[];
  showEmpty?: boolean;
};

const PLATFORM_LABELS = {
  bandcamp: "BC",
  local: "FM",
  mixcloud: "MC",
  "radio-browser": "RB",
  radiogarden: "RG",
  soundcloud: "SC",
  youtube: "YT",
};

function ResultItem({
  mode,
  result,
  onLoad,
  onPick,
  isCurrentPick,
  onError,
  isDisabled,
  isLoading,
  onLoadingChange,
}: {
  mode?: "dj" | "node";
  result: UnifiedSearchResult;
  onLoad: (radio: Radio) => void;
  onPick?: () => void;
  isCurrentPick?: () => boolean;
  onError: (message: string) => void;
  isDisabled: boolean;
  isLoading: boolean;
  onLoadingChange: (loading: boolean) => void;
}) {
  const { mutate: loadItem, isPending } = useDjTrackLoad({
    mode,
    onError: (message) => {
      if (isCurrentPick?.() !== false) {
        onError(message);
      }
    },
    onLoad: (radio) => {
      onError("");
      onLoad(radio);
    },
    onSettled: () => onLoadingChange(false),
  });

  const handleClick = () => {
    onError("");
    onLoadingChange(true);
    onPick?.();
    if (result.radio) {
      onLoad(result.radio);
      onLoadingChange(false);
    } else {
      loadItem(result.url);
    }
  };

  const platformColor = getPlatformSourceColor(
    result.platform === "local" || result.platform === "radio-browser"
      ? "external"
      : result.platform
  );
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
  mode,
  result,
  loadingId,
  onLoad,
  onPick,
  isCurrentPick,
  onError,
  onLoadingIdChange,
}: {
  mode?: "dj" | "node";
  result: UnifiedSearchResult;
  loadingId: string | null;
  onLoad: (radio: Radio) => void;
  onPick?: () => void;
  isCurrentPick?: () => boolean;
  onError: (message: string) => void;
  onLoadingIdChange: (id: string | null) => void;
}) {
  const handleLoadingChange = (loading: boolean) =>
    onLoadingIdChange(loading ? result.id : null);

  return (
    <ResultItem
      isCurrentPick={isCurrentPick}
      isDisabled={loadingId !== null}
      isLoading={loadingId === result.id}
      mode={mode}
      onError={onError}
      onLoad={onLoad}
      onLoadingChange={handleLoadingChange}
      onPick={onPick}
      result={result}
    />
  );
}

export function SearchResults({
  mode,
  error,
  onLoad,
  onPick,
  isCurrentPick,
  results,
  showEmpty = false,
}: SearchResultsProps) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Row callbacks stop on unmount, so release their parent loading lock here.
  if (
    loadingId !== null &&
    (error || !results.some((result) => result.id === loadingId))
  ) {
    setLoadingId(null);
  }

  if (error) {
    return <InlineError>{error}</InlineError>;
  }

  if (results.length === 0) {
    return showEmpty ? (
      <EmptyHint>Nothing found. Try another search or platform.</EmptyHint>
    ) : null;
  }

  return (
    <ScrollArea
      aria-label="Search results"
      className="nowheel min-h-0 flex-1"
      role="region"
    >
      <div className="space-y-2">
        {!!loadError?.trim() && <InlineError>{loadError}</InlineError>}

        <div className="flex w-0 min-w-full flex-col gap-1">
          {results.map((result) => (
            <ManagedResultItem
              isCurrentPick={isCurrentPick}
              key={result.id}
              loadingId={loadingId}
              mode={mode}
              onError={setLoadError}
              onLoad={onLoad}
              onLoadingIdChange={setLoadingId}
              onPick={onPick}
              result={result}
            />
          ))}
        </div>
      </div>
    </ScrollArea>
  );
}
