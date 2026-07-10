import type { RadioGardenSearchResult } from "@avoid.quest/platforms";
import { Input } from "@avoid.quest/ui/components/input";
import { ScrollArea } from "@avoid.quest/ui/components/scroll-area";
import { LoaderIcon, SearchIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Radio } from "@/lib/audio";
import { useRadioGardenSuggestions } from "@/lib/hooks/use-radio-garden-suggestions";
import { useUnifiedRadioSearch } from "@/lib/hooks/use-unified-radio-search";
import { createRadioBrowserRadio } from "@/lib/stations/external-station-workflow";
import { RadioBrowserResultItem } from "./radio-browser-result-item";
import { RadioGardenResultItem } from "./radio-garden-result-item";
import { RadioLogo } from "./radio-logo";

type RadioSearchBarProps = {
  radios: Radio[];
  onSelectDiscovered: (radio: Radio) => void;
  onSelectLocal: (radio: Radio) => void;
  onSelectRemote: (result: RadioGardenSearchResult) => void;
  onSaveRemote?: (result: RadioGardenSearchResult) => void;
  isResolving?: boolean;
  className?: string;
};

export function RadioSearchBar({
  radios,
  onSelectDiscovered,
  onSelectLocal,
  onSelectRemote,
  onSaveRemote,
  isResolving,
  className,
}: RadioSearchBarProps) {
  const [query, setQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { localResults, radioBrowserResults, radioGardenResults, isSearching } =
    useUnifiedRadioSearch(query, radios);

  const { data: suggestions, isLoading: isSuggestionsLoading } =
    useRadioGardenSuggestions(isFocused && !query.trim());

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsFocused(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const showDropdown = isFocused && (query.trim() || suggestions?.length);
  const hasQuery = query.trim().length > 0;

  return (
    <div className={`relative ${className ?? ""}`} ref={containerRef}>
      <div className="relative">
        <SearchIcon className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
        <Input
          className="h-8 pl-8 text-xs"
          maxLength={200}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setIsFocused(true)}
          placeholder="Search stations, Radio Browser, or Radio Garden..."
          type="search"
          value={query}
        />
        {(isSearching || isResolving) && (
          <LoaderIcon className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground/50" />
        )}
      </div>

      {showDropdown && (
        <div className="absolute right-0 left-0 z-50 mt-1 overflow-hidden rounded-lg border border-border/50 bg-popover shadow-lg">
          <ScrollArea className="max-h-72 overflow-hidden">
            {hasQuery ? (
              <>
                {/* Local results */}
                {localResults.length > 0 && (
                  <div className="px-1 py-1">
                    <p className="px-2.5 py-1 font-mono text-[10px] text-muted-foreground/50 uppercase tracking-wider">
                      Your stations
                    </p>
                    {localResults.slice(0, 5).map((radio) => (
                      <button
                        className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted/40"
                        key={radio.id}
                        onClick={() => {
                          onSelectLocal(radio);
                          setIsFocused(false);
                          setQuery("");
                        }}
                        type="button"
                      >
                        <RadioLogo
                          logoUrl={radio.logoUrl}
                          name={radio.name}
                          size="sm"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm leading-snug">
                            {radio.name}
                          </p>
                          {(radio.placeTitle || radio.description) && (
                            <p className="mt-0.5 truncate text-muted-foreground/60 text-xs leading-snug">
                              {radio.placeTitle
                                ? `${radio.placeTitle}, ${radio.countryTitle}`
                                : radio.description}
                            </p>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* Divider */}
                {localResults.length > 0 &&
                  (radioBrowserResults.length > 0 ||
                    radioGardenResults.length > 0) && (
                    <div className="mx-2.5 border-border/50 border-t" />
                  )}

                {/* Radio Browser results */}
                {radioBrowserResults.length > 0 && (
                  <div className="px-1 py-1">
                    <p className="px-2.5 py-1 font-mono text-[10px] text-muted-foreground/50 uppercase tracking-wider">
                      Radio Browser
                    </p>
                    {radioBrowserResults.map((result) => (
                      <RadioBrowserResultItem
                        key={result.stationUuid}
                        onSelect={(station) => {
                          onSelectDiscovered(createRadioBrowserRadio(station));
                          setIsFocused(false);
                          setQuery("");
                        }}
                        result={result}
                      />
                    ))}
                  </div>
                )}

                {radioBrowserResults.length > 0 &&
                  radioGardenResults.length > 0 && (
                    <div className="mx-2.5 border-border/50 border-t" />
                  )}

                {/* Radio Garden results */}
                {radioGardenResults.length > 0 && (
                  <div className="px-1 py-1">
                    <p className="px-2.5 py-1 font-mono text-[10px] text-muted-foreground/50 uppercase tracking-wider">
                      Radio Garden
                    </p>
                    {radioGardenResults.map((result) => (
                      <RadioGardenResultItem
                        isLoading={isResolving}
                        key={result.channelId}
                        onSave={onSaveRemote}
                        onSelect={(r) => {
                          onSelectRemote(r);
                          setIsFocused(false);
                          setQuery("");
                        }}
                        result={result}
                      />
                    ))}
                  </div>
                )}

                {/* No results */}
                {localResults.length === 0 &&
                  radioBrowserResults.length === 0 &&
                  radioGardenResults.length === 0 &&
                  !isSearching && (
                    <div className="px-4 py-6 text-center">
                      <p className="text-muted-foreground/60 text-xs">
                        No stations found
                      </p>
                    </div>
                  )}

                {/* Searching indicator */}
                {isSearching &&
                  radioBrowserResults.length === 0 &&
                  radioGardenResults.length === 0 && (
                    <div className="flex items-center justify-center gap-2 px-4 py-4">
                      <LoaderIcon className="size-3 animate-spin text-muted-foreground/50" />
                      <p className="text-muted-foreground/50 text-xs">
                        Searching station directories...
                      </p>
                    </div>
                  )}
              </>
            ) : (
              // Suggestions (no query)
              <div className="px-1 py-1">
                <p className="px-2.5 py-1 font-mono text-[10px] text-muted-foreground/50 uppercase tracking-wider">
                  Popular on Radio Garden
                </p>
                {isSuggestionsLoading ? (
                  <div className="flex items-center justify-center gap-2 px-4 py-4">
                    <LoaderIcon className="size-3 animate-spin text-muted-foreground/50" />
                    <p className="text-muted-foreground/50 text-xs">
                      Loading suggestions...
                    </p>
                  </div>
                ) : (
                  suggestions?.map((result) => (
                    <RadioGardenResultItem
                      isLoading={isResolving}
                      key={result.channelId}
                      onSave={onSaveRemote}
                      onSelect={(r) => {
                        onSelectRemote(r);
                        setIsFocused(false);
                      }}
                      result={result}
                    />
                  ))
                )}
              </div>
            )}
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
