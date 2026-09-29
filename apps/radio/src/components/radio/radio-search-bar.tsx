/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Button } from "@avoid.quest/ui/components/button";
import { Input } from "@avoid.quest/ui/components/input";
import { ScrollArea } from "@avoid.quest/ui/components/scroll-area";
import { Spinner } from "@avoid.quest/ui/components/spinner";
import {
  BookmarkPlusIcon,
  CheckIcon,
  PlayIcon,
  SearchIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Radio } from "@/lib/audio";
import {
  type UnifiedRadioSearchResult,
  useUnifiedRadioSearch,
} from "@/lib/hooks/use-unified-radio-search";
import { RadioLogo } from "./radio-logo";

type RadioSearchBarProps = {
  radios: Radio[];
  onSelectDiscovered: (radio: Radio) => void;
  onSelectLocal: (radio: Radio) => void;
  onSaveDiscovered?: (radio: Radio) => void;
  className?: string;
  placeholder?: string;
};

function resultDetails(result: UnifiedRadioSearchResult): string | undefined {
  const location = [result.location, result.country].filter(Boolean).join(", ");
  return location || result.description;
}

function sourceLabel(result: UnifiedRadioSearchResult): string {
  if (result.action.type === "local") {
    return "Your collection";
  }
  if (result.sources.length > 1) {
    return `${result.sources.length} station directories`;
  }
  return result.action.type === "radio-browser"
    ? "Radio Browser"
    : "Radio Garden";
}

function assertNever(value: never): never {
  throw new Error(`Unsupported search result: ${String(value)}`);
}

function SearchResultRow({
  result,
  onSelect,
  onSave,
  canSave,
}: {
  result: UnifiedRadioSearchResult;
  onSelect: (result: UnifiedRadioSearchResult) => void;
  onSave: (result: UnifiedRadioSearchResult) => void;
  canSave: boolean;
}) {
  const details = resultDetails(result);
  const isLocal = result.action.type === "local";
  const handleSelect = () => onSelect(result);
  const handleSave = () => onSave(result);
  let action: React.ReactNode = null;
  if (isLocal) {
    action = (
      <span
        aria-label="In your collection"
        className="flex size-7 shrink-0 items-center justify-center text-emerald-500"
        role="img"
      >
        <CheckIcon className="size-3.5" />
      </span>
    );
  } else if (canSave) {
    action = (
      <Button
        aria-label={`Save ${result.name} to collection`}
        className="size-7 shrink-0"
        onClick={handleSave}
        size="icon"
        variant="ghost"
      >
        <BookmarkPlusIcon className="size-3.5" />
      </Button>
    );
  }

  return (
    <div
      className="group flex items-center gap-2 rounded-lg px-2.5 py-2 transition-colors hover:bg-muted/40"
      title={sourceLabel(result)}
    >
      <button
        aria-label={`Listen to ${result.name}`}
        className="flex min-w-0 flex-1 items-center gap-3 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={handleSelect}
        type="button"
      >
        <RadioLogo logoUrl={result.logoUrl} name={result.name} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm leading-snug">{result.name}</p>
          {details ? (
            <p className="mt-0.5 truncate text-muted-foreground/60 text-xs leading-snug">
              {details}
            </p>
          ) : null}
        </div>
        <PlayIcon className="size-3.5 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/50" />
      </button>
      {action}
    </div>
  );
}

export function RadioSearchBar({
  radios,
  onSelectDiscovered,
  onSelectLocal,
  onSaveDiscovered,
  className,
  placeholder = "Search stations…",
}: RadioSearchBarProps) {
  const [query, setQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { isSearching, results } = useUnifiedRadioSearch(query, radios);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsFocused(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const resetSearch = () => {
    setIsFocused(false);
    setQuery("");
  };

  const selectResult = (result: UnifiedRadioSearchResult) => {
    switch (result.action.type) {
      case "local":
        onSelectLocal(result.action.radio);
        break;
      case "radio-browser":
        onSelectDiscovered(result.action.radio);
        break;
      case "radio-garden":
        onSelectDiscovered(result.action.radio);
        break;
      default:
        assertNever(result.action);
    }
    resetSearch();
  };

  const saveResult = (result: UnifiedRadioSearchResult) => {
    if (result.action.type !== "local") {
      onSaveDiscovered?.(result.action.radio);
    }
  };
  const handleQueryChange = (event: React.ChangeEvent<HTMLInputElement>) =>
    setQuery(event.target.value);
  const handleFocus = () => setIsFocused(true);
  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.currentTarget.blur();
      resetSearch();
      return;
    }
    const [first] = results;
    if (event.key === "Enter" && first) {
      event.preventDefault();
      selectResult(first);
    }
  };

  const hasQuery = query.trim().length > 0;
  const showDropdown = isFocused && hasQuery;
  const emptyLabel = isSearching
    ? "Checking station directories…"
    : "No stations found";

  return (
    <div className={`relative ${className ?? ""}`} ref={containerRef}>
      <div className="relative">
        <SearchIcon className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
        <Input
          className="h-8 pl-8 text-xs"
          maxLength={200}
          onChange={handleQueryChange}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          type="search"
          value={query}
        />
        {isSearching ? (
          <Spinner className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
        ) : null}
      </div>

      {showDropdown ? (
        <div className="absolute right-0 left-0 z-50 mt-1 overflow-hidden rounded-lg border border-border/50 bg-popover shadow-lg">
          <ScrollArea className="max-h-72 overflow-hidden">
            {results.length > 0 ? (
              <div className="px-1 pb-1">
                {results.map((result) => (
                  <SearchResultRow
                    canSave={Boolean(onSaveDiscovered)}
                    key={result.key}
                    onSave={saveResult}
                    onSelect={selectResult}
                    result={result}
                  />
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 px-4 py-6 text-center text-muted-foreground/60 text-xs">
                {isSearching ? <Spinner className="size-3.5" /> : null}
                {emptyLabel}
              </div>
            )}
          </ScrollArea>
        </div>
      ) : null}
    </div>
  );
}
