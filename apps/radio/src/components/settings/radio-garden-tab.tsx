// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers

import { captureError } from "@avoid.quest/error";
import { Button } from "@avoid.quest/ui/components/button";
import { Field, FieldLabel } from "@avoid.quest/ui/components/field";
import { Input } from "@avoid.quest/ui/components/input";
import { ScrollArea } from "@avoid.quest/ui/components/scroll-area";
import { Spinner } from "@avoid.quest/ui/components/spinner";
import {
  ExternalLinkIcon,
  MapPinIcon,
  PlusIcon,
  RadioIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { searchRadioGarden } from "@/lib/platform-client";
import type { RadioGardenSearchResult } from "@/lib/platform-types";
import { createBrowserStationIntake } from "@/lib/stations/external-station-workflow";
import { resolveRadioGardenStreamForWorkflow } from "@/lib/stations/radio-garden-resolve-adapter";
import { notifyStationSave } from "@/lib/stations/station-save-notification";
import { EmptyHint } from "../radio/empty-hint";
import { InlineError } from "../radio/inline-error";
import { SearchField } from "../radio/search-field";

type RadioGardenTabProps = {
  onSuccess: () => void;
};

const stationIntake = createBrowserStationIntake({
  radioGarden: {
    resolveStream: resolveRadioGardenStreamForWorkflow,
  },
});

export function RadioGardenTab({ onSuccess }: RadioGardenTabProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RadioGardenSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editedName, setEditedName] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const selected = results.find((result) => result.channelId === selectedId);

  const handleSearch = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!query.trim()) {
      return;
    }

    setIsSearching(true);
    setSearchError(null);
    setSelectedId(null);
    try {
      const searchResults = await searchRadioGarden(query.trim());
      setResults(searchResults);
      setHasSearched(true);
    } catch (error) {
      captureError(error, {
        operation: "radio-garden.search",
        surface: "ui",
      });
      setSearchError("Couldn't search Radio Garden");
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelect = (event: React.MouseEvent<HTMLButtonElement>) => {
    const { channelId } = event.currentTarget.dataset;
    if (!channelId) {
      return;
    }
    if (selectedId === channelId) {
      setSelectedId(null);
      return;
    }
    const result = results.find((item) => item.channelId === channelId);
    if (!result) {
      return;
    }
    const { title } = result;
    setSelectedId(channelId);
    setEditedName(title);
  };

  const handleAdd = async () => {
    if (!selected) {
      setSelectedId(null);
      return;
    }
    setIsAdding(true);
    try {
      const resolved = await stationIntake.save({
        name: editedName || selected.title,
        origin: "radio-garden",
        result: selected,
      });

      if (!resolved.ok) {
        toast.error(`Couldn't add station: ${resolved.error.message}`);
        return;
      }

      notifyStationSave(
        resolved.data,
        `Added "${editedName || selected.title}"`
      );
      onSuccess();
    } catch (error) {
      captureError(error, {
        operation: "radio-garden.add",
        surface: "ui",
      });
      toast.error("Couldn't add station");
    } finally {
      setIsAdding(false);
    }
  };
  const handleQueryChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
  };
  const handleEditedNameChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    setEditedName(event.target.value);
  };

  return (
    <div className="flex flex-col gap-3">
      <form className="flex gap-2" onSubmit={handleSearch}>
        <SearchField
          aria-label="Search Radio Garden"
          className="min-w-0 flex-1"
          disabled={isSearching}
          onChange={handleQueryChange}
          placeholder="Search 40,000+ radio stations…"
          value={query}
        />
        <Button disabled={isSearching || !query.trim()} size="sm" type="submit">
          {isSearching ? <Spinner /> : "Search"}
        </Button>
      </form>

      {searchError ? <InlineError>{searchError}</InlineError> : null}
      {!searchError && hasSearched && results.length === 0 ? (
        <EmptyHint>No stations found</EmptyHint>
      ) : null}

      {results.length > 0 && (
        <ScrollArea className="max-h-[50vh]">
          <div className="space-y-1 pr-3">
            {results.map((result) => (
              <div key={result.channelId}>
                <button
                  className="flex w-full items-center gap-3 rounded-md p-2.5 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[selected=true]:bg-accent"
                  data-channel-id={result.channelId}
                  data-selected={selectedId === result.channelId}
                  onClick={handleSelect}
                  type="button"
                >
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                    <RadioIcon className="size-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-sm">
                      {result.title}
                    </p>
                    <p className="flex items-center gap-1 truncate text-muted-foreground text-xs">
                      <MapPinIcon className="size-3 shrink-0" />
                      {result.placeTitle}, {result.countryTitle}
                    </p>
                  </div>
                </button>

                {selectedId === result.channelId && selected ? (
                  <div className="mx-2 mb-2 space-y-3 rounded-md border bg-muted/30 p-3">
                    <Field className="gap-1.5">
                      <FieldLabel htmlFor="rg-station-name">Name</FieldLabel>
                      <Input
                        id="rg-station-name"
                        onChange={handleEditedNameChange}
                        value={editedName}
                      />
                    </Field>
                    {result.website ? (
                      <a
                        className="flex items-center gap-1 rounded-sm text-primary text-xs outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        href={result.website}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        <ExternalLinkIcon className="size-3" />
                        {result.website}
                      </a>
                    ) : null}
                    <Button
                      className="w-full"
                      disabled={isAdding}
                      onClick={handleAdd}
                      size="sm"
                    >
                      {isAdding ? (
                        <Spinner className="size-3" />
                      ) : (
                        <PlusIcon className="size-3" />
                      )}
                      {isAdding ? "Adding…" : "Add station"}
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
