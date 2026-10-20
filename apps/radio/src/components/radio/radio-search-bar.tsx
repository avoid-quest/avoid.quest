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
   * Resolves to why it didn't load, or null once it did. `signal` aborts
   * when the query changes or a result is picked before it resolves, so the
   * loader must not commit afterwards.
   */
  onSubmitUrl?: (url: string, signal: AbortSignal) => Promise<string | null>;
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
    <tr
      aria-selected
      className={cn(stationRowClassName, "bg-muted/40")}
      id={id}
      tabIndex={-1}
    >
      <td className="flex min-w-0 flex-1">
        <button
          className={stationRowButtonClassName}
          disabled={isLoading}
          onClick={onSelect}
          type="button"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground">
            <LinkIcon className="size-3.5" />
          </span>
          <StationRowText
            title={isLoading ? "Loading link…" : "Play this link"}
          >
            <StationRowSubtitle>{url}</StationRowSubtitle>
          </StationRowText>
        </button>
      </td>
    </tr>
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
    <tr
      aria-selected={isActive}
      className={cn(stationRowClassName, isActive && "bg-muted/40")}
      id={id}
      tabIndex={-1}
      title={sourceLabel(result)}
    >
      <td className="flex min-w-0 flex-1">
        <button
          aria-label={`Listen to ${result.name}`}
          className={stationRowButtonClassName}
          onClick={handleSelect}
          type="button"
        >
          <RadioLogo
            decorative
            loading="lazy"
            logoUrl={result.logoUrl}
            name={result.name}
            size="md"
          />
          <StationRowText title={result.name}>
            <StationRowSubtitle>{details}</StationRowSubtitle>
          </StationRowText>
          <PlayIcon className="size-3.5 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/50" />
        </button>
      </td>
      {action ? <td>{action}</td> : null}
    </tr>
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
  // The submission in flight; a later query or pick aborts it.
  const pending = useRef<AbortController | null>(null);
  // So does unmounting: a deleted Station's link must not fill a new one
  // that takes its id.
  useEffect(() => () => pending.current?.abort(), []);
  const url =
    onSubmitUrl && PASTED_URL.test(query.trim()) ? query.trim() : null;
  const submit = () => {
    if (!(url && onSubmitUrl) || isLoading) {
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    const { signal } = controller;
    setError(null);
    setIsLoading(true);
    onSubmitUrl(url, signal)
      .then((failure) => {
        if (signal.aborted) {
          return;
        }
        if (failure) {
          setError(failure);
        } else {
          onLoaded();
        }
      })
      .catch((cause: unknown) => {
        if (!signal.aborted) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        if (pending.current === controller) {
          pending.current = null;
          setIsLoading(false);
        }
      });
  };
  /** A newer query or pick wins over the link still loading. */
  const cancel = () => {
    pending.current?.abort();
    pending.current = null;
    setIsLoading(false);
    setError(null);
  };
  return { cancel, error, isLoading, submit, url };
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
      <table
        aria-label="Station results"
        className="flex w-0 min-w-full flex-col p-1"
        id={listId}
        // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: grid popups can use native table semantics.
        role="grid"
      >
        <tbody className="flex flex-col">
          <LinkRow
            id={optionId}
            isLoading={link.isLoading}
            onSelect={link.submit}
            url={link.url}
          />
        </tbody>
      </table>
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

function isComposing(event: KeyboardEvent) {
  return event.isComposing || event.keyCode === 229;
}

function searchEmptyLabel(isSearching: boolean, failed: boolean) {
  if (isSearching) {
    return "Checking station directories…";
  }
  return failed
    ? "Couldn’t reach the station directory. Try again."
    : "No stations found";
}

function DirectoryFailure({
  visible,
  hasResults,
  retry,
}: {
  visible: boolean;
  hasResults: boolean;
  retry: () => void;
}) {
  if (!visible) {
    return null;
  }
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 text-muted-foreground text-xs">
      {hasResults ? <span>Couldn’t reach the station directory.</span> : null}
      <Button onClick={retry} size="sm" variant="ghost">
        Retry station search
      </Button>
    </div>
  );
}

function SearchResults({
  results,
  listId,
  resultIdPrefix,
  activeIndex,
  canSave,
  onSave,
  onSelect,
}: {
  results: UnifiedRadioSearchResult[];
  listId: string;
  resultIdPrefix: string;
  activeIndex: number;
  canSave: boolean;
  onSave: (result: UnifiedRadioSearchResult) => void;
  onSelect: (result: UnifiedRadioSearchResult) => void;
}) {
  if (results.length === 0) {
    return null;
  }
  return (
    <table
      aria-label="Station results"
      className="flex w-0 min-w-full flex-col p-1"
      id={listId}
      // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: grid popups can use native table semantics.
      role="grid"
    >
      <tbody className="flex flex-col">
        {results.map((result, index) => (
          <SearchResultRow
            canSave={canSave}
            id={`${resultIdPrefix}-${index}`}
            isActive={index === activeIndex}
            key={result.key}
            onSave={onSave}
            onSelect={onSelect}
            result={result}
          />
        ))}
      </tbody>
    </table>
  );
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
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const resultIdPrefix = useId();
  const listId = `${resultIdPrefix}-list`;
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pointerType = useRef("mouse");
  // Focus stays in the input, so typing again reopens the results.
  const resetSearch = () => {
    setIsOpen(false);
    setQuery("");
    if (pointerType.current !== "touch") {
      inputRef.current?.focus({ preventScroll: true });
    }
  };
  const link = usePastedLink(query, onSubmitUrl, resetSearch);
  const pastedUrl = link.url;
  const { isSearching, results, failedSources, retry } = useUnifiedRadioSearch(
    pastedUrl ? "" : query,
    radios,
    isOpen && !pastedUrl
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
    link.cancel();
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
    link.cancel();
    setQuery(event.target.value);
    setActiveKey(null);
    setIsOpen(true);
  };
  const hasQuery = query.trim().length > 0;
  const showDropdown = isOpen && hasQuery;
  const lastIndex = results.length - 1;
  const activeResult =
    results.find((result) => result.key === activeKey) ?? results[0];
  const clampedActiveIndex = activeResult ? results.indexOf(activeResult) : 0;
  const selectedKey = activeResult?.key ?? null;
  useEffect(() => {
    setActiveKey(selectedKey);
  }, [selectedKey]);
  const moveActive = (step: number) => {
    const next = Math.max(0, Math.min(clampedActiveIndex + step, lastIndex));
    setActiveKey(results[next]?.key ?? null);
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
    if (isComposing(event.nativeEvent)) {
      return;
    }
    pointerType.current = "keyboard";
    if (event.key === "Escape") {
      if (query || showDropdown) {
        event.preventDefault();
        link.cancel();
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

  const emptyLabel = searchEmptyLabel(
    isSearching,
    Boolean(failedSources?.length)
  );
  const statusLabel = searchStatus(
    showDropdown,
    link,
    results.length,
    emptyLabel
  );
  const hasResultsPopup =
    showDropdown && (pastedUrl !== null || results.length > 0);
  const activeResultId = hasResultsPopup
    ? `${resultIdPrefix}-${clampedActiveIndex}`
    : undefined;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: focus bookkeeping that closes the results when focus leaves the search
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: focus bookkeeping that closes the results when focus leaves the search
    <div
      className={cn("relative", className)}
      onBlur={handleBlur}
      onPointerDownCapture={(event) => {
        pointerType.current = event.pointerType;
      }}
      ref={containerRef}
    >
      <SearchField
        aria-activedescendant={activeResultId}
        aria-autocomplete="list"
        aria-controls={hasResultsPopup ? listId : undefined}
        aria-expanded={showDropdown}
        aria-haspopup="grid"
        aria-label="Search stations"
        isSearching={isSearching}
        // Pasted links can be long (signed HLS, share links); text stays short.
        maxLength={onSubmitUrl ? 2048 : 200}
        onChange={handleQueryChange}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        ref={inputRef}
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
            {pastedUrl ? null : (
              <SearchResults
                activeIndex={clampedActiveIndex}
                canSave={Boolean(onSaveDiscovered)}
                listId={listId}
                onSave={saveResult}
                onSelect={selectResult}
                resultIdPrefix={resultIdPrefix}
                results={results}
              />
            )}
            {pastedUrl || results.length > 0 ? null : (
              <EmptyHint>{emptyLabel}</EmptyHint>
            )}
          </ScrollArea>
          <DirectoryFailure
            hasResults={results.length > 0}
            retry={retry}
            visible={
              !pastedUrl && Boolean(failedSources?.length) && !isSearching
            }
          />
        </div>
      ) : null}
    </div>
  );
}
