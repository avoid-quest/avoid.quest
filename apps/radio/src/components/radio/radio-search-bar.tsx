/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Button } from "@avoid.quest/ui/components/button";
import { ScrollArea } from "@avoid.quest/ui/components/scroll-area";
import { cn } from "@avoid.quest/ui/lib/utils";
import { BookmarkPlusIcon, CheckIcon, PlayIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { Radio } from "@/lib/audio";
import {
  type UnifiedRadioSearchResult,
  useUnifiedRadioSearch,
} from "@/lib/hooks/use-unified-radio-search";
import { EmptyHint } from "./empty-hint";
import { RadioLogo } from "./radio-logo";
import { SearchField } from "./search-field";
import {
  formatLocation,
  StationRowSubtitle,
  StationRowText,
  stationRowButtonClassName,
  stationRowClassName,
} from "./station-row";

type RadioSearchBarProps = {
  radios: Radio[];
  onSelectDiscovered: (radio: Radio) => void;
  onSelectLocal: (radio: Radio) => void;
  onSaveDiscovered?: (radio: Radio) => void;
  className?: string;
  placeholder?: string;
};

function resultDetails(result: UnifiedRadioSearchResult): string | undefined {
  return formatLocation(result.location, result.country) || result.description;
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
  id,
  result,
  isActive,
  onSelect,
  onSave,
  canSave,
}: {
  id: string;
  result: UnifiedRadioSearchResult;
  isActive: boolean;
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
        className="flex size-7 shrink-0 items-center justify-center text-muted-foreground"
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
      aria-selected={isActive}
      className={cn(stationRowClassName, isActive && "bg-muted/40")}
      id={id}
      role="option"
      tabIndex={-1}
      title={sourceLabel(result)}
    >
      <button
        aria-label={`Listen to ${result.name}`}
        className={stationRowButtonClassName}
        onClick={handleSelect}
        type="button"
      >
        <RadioLogo
          decorative
          logoUrl={result.logoUrl}
          name={result.name}
          size="md"
        />
        <StationRowText title={result.name}>
          <StationRowSubtitle>{details}</StationRowSubtitle>
        </StationRowText>
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
  const [isOpen, setIsOpen] = useState(false);
  // The result Enter plays; arrow keys move it.
  const [activeIndex, setActiveIndex] = useState(0);
  const resultIdPrefix = useId();
  const listId = `${resultIdPrefix}-list`;
  const containerRef = useRef<HTMLDivElement>(null);
  const { isSearching, results } = useUnifiedRadioSearch(query, radios);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Focus stays in the input, so typing again reopens the results.
  const resetSearch = () => {
    setIsOpen(false);
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
  const handleQueryChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
    setActiveIndex(0);
    setIsOpen(true);
  };
  const hasQuery = query.trim().length > 0;
  const showDropdown = isOpen && hasQuery;
  const lastIndex = results.length - 1;
  const clampedActiveIndex = Math.min(activeIndex, Math.max(lastIndex, 0));
  const moveActive = (step: number) => {
    const next = Math.max(0, Math.min(clampedActiveIndex + step, lastIndex));
    setActiveIndex(next);
    document
      .getElementById(`${resultIdPrefix}-${next}`)
      ?.scrollIntoView({ block: "nearest" });
  };
  const handleFocus = () => setIsOpen(true);
  // Mouse clicks outside are handled above; this covers keyboard focus
  // leaving (a null relatedTarget is a click, not a focus move).
  const handleBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && !event.currentTarget.contains(next)) {
      setIsOpen(false);
    }
  };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      if (query || showDropdown) {
        event.preventDefault();
        resetSearch();
      }
      return;
    }
    // Without visible results, arrows and Enter keep their usual meaning.
    if (!showDropdown) {
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    const active = results[clampedActiveIndex];
    if (event.key === "Enter" && active) {
      event.preventDefault();
      selectResult(active);
    }
  };

  const emptyLabel = isSearching
    ? "Checking station directories…"
    : "No stations found";
  let statusLabel = "";
  if (showDropdown) {
    statusLabel =
      results.length > 0
        ? `${results.length} ${results.length === 1 ? "station" : "stations"}`
        : emptyLabel;
  }
  const hasListbox = showDropdown && results.length > 0;
  const activeResultId = hasListbox
    ? `${resultIdPrefix}-${clampedActiveIndex}`
    : undefined;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: focus bookkeeping that closes the results when focus leaves the search
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: focus bookkeeping that closes the results when focus leaves the search
    <div
      className={cn("relative", className)}
      onBlur={handleBlur}
      ref={containerRef}
    >
      <SearchField
        aria-activedescendant={activeResultId}
        aria-autocomplete="list"
        aria-controls={hasListbox ? listId : undefined}
        aria-expanded={showDropdown}
        aria-label="Search stations"
        isSearching={isSearching}
        onChange={handleQueryChange}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        role="combobox"
        value={query}
      />
      <span className="sr-only" role="status">
        {statusLabel}
      </span>

      {showDropdown ? (
        <div className="absolute right-0 left-0 z-50 mt-1 overflow-hidden rounded-lg border border-border/50 bg-popover shadow-lg">
          <ScrollArea className="max-h-72 overflow-hidden">
            {results.length > 0 ? (
              <div
                className="flex w-0 min-w-full flex-col p-1"
                id={listId}
                role="listbox"
              >
                {results.map((result, index) => (
                  <SearchResultRow
                    canSave={Boolean(onSaveDiscovered)}
                    id={`${resultIdPrefix}-${index}`}
                    isActive={index === clampedActiveIndex}
                    key={result.key}
                    onSave={saveResult}
                    onSelect={selectResult}
                    result={result}
                  />
                ))}
              </div>
            ) : (
              <EmptyHint>{emptyLabel}</EmptyHint>
            )}
          </ScrollArea>
        </div>
      ) : null}
    </div>
  );
}
