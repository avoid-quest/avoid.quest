/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Button } from "@avoid.quest/ui/components/button";
import { ScrollArea } from "@avoid.quest/ui/components/scroll-area";
import { cn } from "@avoid.quest/ui/lib/utils";
import { BookmarkPlusIcon, CheckIcon, LinkIcon, PlayIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { Radio } from "@/lib/audio";
import {
  type UnifiedRadioSearchResult,
  useUnifiedRadioSearch,
} from "@/lib/hooks/use-unified-radio-search";
import { EmptyHint } from "./empty-hint";
import { InlineError } from "./inline-error";
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
  /**
   * A pasted http(s) link, offered as its own row instead of a search.
   * Resolves to why it didn't load, or null once it did.
   */
  onSubmitUrl?: (url: string) => Promise<string | null>;
  className?: string;
  /** The results list; e.g. wider than a narrow field. */
  dropdownClassName?: string;
  placeholder?: string;
};

const PASTED_URL = /^https?:\/\/\S+$/i;

/** The pasted link's row: Enter or a click loads it. */
function LinkRow({
  id,
  url,
  isLoading,
  onSelect,
}: {
  id: string;
  url: string;
  isLoading: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      aria-selected
      className={cn(stationRowClassName, "bg-muted/40")}
      id={id}
      role="option"
      tabIndex={-1}
    >
      <button
        className={stationRowButtonClassName}
        disabled={isLoading}
        onClick={onSelect}
        type="button"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground">
          <LinkIcon className="size-3.5" />
        </span>
        <StationRowText title={isLoading ? "Loading link…" : "Play this link"}>
          <StationRowSubtitle>{url}</StationRowSubtitle>
        </StationRowText>
      </button>
    </div>
  );
}

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

/**
 * A pasted http(s) link in the search: loads through `onSubmitUrl` instead
 * of searching, and keeps why it failed next to it.
 */
function usePastedLink(
  query: string,
  onSubmitUrl: RadioSearchBarProps["onSubmitUrl"],
  onLoaded: () => void
) {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const url =
    onSubmitUrl && PASTED_URL.test(query.trim()) ? query.trim() : null;
  const submit = () => {
    if (!(url && onSubmitUrl) || isLoading) {
      return;
    }
    setError(null);
    setIsLoading(true);
    onSubmitUrl(url)
      .then((failure) => {
        if (failure) {
          setError(failure);
        } else {
          onLoaded();
        }
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => setIsLoading(false));
  };
  return { clearError: () => setError(null), error, isLoading, submit, url };
}

type PastedLink = ReturnType<typeof usePastedLink>;

/** The pasted link's option, and why it failed if it did. */
function PastedLinkList({
  link,
  listId,
  optionId,
}: {
  link: PastedLink & { url: string };
  listId: string;
  optionId: string;
}) {
  return (
    <>
      <div
        className="flex w-0 min-w-full flex-col p-1"
        id={listId}
        role="listbox"
      >
        <LinkRow
          id={optionId}
          isLoading={link.isLoading}
          onSelect={link.submit}
          url={link.url}
        />
      </div>
      {link.error ? (
        <InlineError className="mx-2 mb-2">{link.error}</InlineError>
      ) : null}
    </>
  );
}

/** What the screen reader hears about the open results. */
function searchStatus(
  showDropdown: boolean,
  link: PastedLink,
  resultCount: number,
  emptyLabel: string
): string {
  if (!showDropdown) {
    return "";
  }
  if (link.url) {
    return link.error ?? "Enter plays this link";
  }
  if (resultCount === 0) {
    return emptyLabel;
  }
  return `${resultCount} ${resultCount === 1 ? "station" : "stations"}`;
}

export function RadioSearchBar({
  radios,
  onSelectDiscovered,
  onSelectLocal,
  onSaveDiscovered,
  onSubmitUrl,
  className,
  dropdownClassName,
  placeholder = "Search stations…",
}: RadioSearchBarProps) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  // The result Enter plays; arrow keys move it.
  const [activeIndex, setActiveIndex] = useState(0);
  const resultIdPrefix = useId();
  const listId = `${resultIdPrefix}-list`;
  const containerRef = useRef<HTMLDivElement>(null);
  // Focus stays in the input, so typing again reopens the results.
  const resetSearch = () => {
    setIsOpen(false);
    setQuery("");
  };
  const link = usePastedLink(query, onSubmitUrl, resetSearch);
  const pastedUrl = link.url;
  const { isSearching, results } = useUnifiedRadioSearch(
    pastedUrl ? "" : query,
    radios
  );

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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
    link.clearError();
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
  /** Enter: the pasted link, or the active result. False when neither. */
  const pickActive = () => {
    if (pastedUrl) {
      link.submit();
      return true;
    }
    const active = results[clampedActiveIndex];
    if (active) {
      selectResult(active);
    }
    return Boolean(active);
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
    if (!pastedUrl && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      moveActive(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter" && pickActive()) {
      event.preventDefault();
    }
  };

  const emptyLabel = isSearching
    ? "Checking station directories…"
    : "No stations found";
  const statusLabel = searchStatus(
    showDropdown,
    link,
    results.length,
    emptyLabel
  );
  const hasListbox = showDropdown && (pastedUrl !== null || results.length > 0);
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
        <div
          className={cn(
            "absolute right-0 left-0 z-50 mt-1 overflow-hidden rounded-lg border border-border/50 bg-popover shadow-lg",
            dropdownClassName
          )}
        >
          <ScrollArea className="max-h-72 overflow-hidden">
            {pastedUrl ? (
              <PastedLinkList
                link={{ ...link, url: pastedUrl }}
                listId={listId}
                optionId={`${resultIdPrefix}-0`}
              />
            ) : null}
            {!pastedUrl && results.length > 0 ? (
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
            ) : null}
            {pastedUrl || results.length > 0 ? null : (
              <EmptyHint>{emptyLabel}</EmptyHint>
            )}
          </ScrollArea>
        </div>
      ) : null}
    </div>
  );
}
