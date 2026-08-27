// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
import { captureError } from "@avoid.quest/error";
import { Button } from "@avoid.quest/ui/components/button";
import { Input } from "@avoid.quest/ui/components/input";
import { ScrollArea } from "@avoid.quest/ui/components/scroll-area";
import {
  ExternalLinkIcon,
  GlobeIcon,
  Loader2Icon,
  MapPinIcon,
  PlusIcon,
  RadioIcon,
  SearchIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { searchRadioGarden } from "@/lib/platform-client";
import type { RadioGardenSearchResult } from "@/lib/platform-types";
import { createBrowserStationIntake } from "@/lib/stations/external-station-workflow";
import { resolveRadioGardenStreamForWorkflow } from "@/lib/stations/radio-garden-resolve-adapter";
import { notifyStationSave } from "@/lib/stations/station-save-notification";

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
      if (searchResults.length === 0) {
        setSearchError("No stations found. Try a different search.");
      }
    } catch (error) {
      captureError(error, {
        operation: "radio-garden.search",
        surface: "ui",
      });
      setSearchError(
        error instanceof Error
          ? error.message
          : "Search failed. Please try again."
      );
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
        toast.error(`Failed to resolve stream: ${resolved.error.message}`);
        return;
      }

      notifyStationSave(
        resolved.data,
        `Added "${editedName || selected.title}" to your collection`
      );
      onSuccess();
    } catch (error) {
      captureError(error, {
        operation: "radio-garden.add",
        surface: "ui",
      });
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to add station. Please try again."
      );
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
        <div className="relative flex-1">
          <SearchIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            disabled={isSearching}
            onChange={handleQueryChange}
            placeholder="Search 40,000+ radio stations..."
            value={query}
          />
        </div>
        <Button disabled={isSearching || !query.trim()} type="submit">
          {isSearching ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            "Search"
          )}
        </Button>
      </form>

      {searchError ? (
        <div className="rounded-md bg-destructive/10 p-3">
          <p className="text-destructive text-sm">{searchError}</p>
        </div>
      ) : null}

      {results.length > 0 && (
        <ScrollArea className="max-h-[50vh]">
          <div className="space-y-1 pr-3">
            {results.map((result) => (
              <div key={result.channelId}>
                <button
                  className="flex w-full items-center gap-3 rounded-md p-2.5 text-left transition-colors hover:bg-accent data-[selected=true]:bg-accent"
                  data-channel-id={result.channelId}
                  data-selected={selectedId === result.channelId}
                  onClick={handleSelect}
                  type="button"
                >
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-emerald-500/10">
                    <RadioIcon className="size-4 text-emerald-500" />
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
                    <div className="space-y-2">
                      <label
                        className="font-medium text-xs"
                        htmlFor="rg-station-name"
                      >
                        Station Name
                      </label>
                      <Input
                        id="rg-station-name"
                        onChange={handleEditedNameChange}
                        value={editedName}
                      />
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground text-xs">
                      <GlobeIcon className="size-3 shrink-0" />
                      <span>
                        {result.placeTitle}, {result.countryTitle}
                      </span>
                    </div>
                    {result.website ? (
                      <a
                        className="flex items-center gap-1 text-primary text-xs hover:underline"
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
                        <>
                          <Loader2Icon className="mr-2 size-3 animate-spin" />
                          Resolving stream...
                        </>
                      ) : (
                        <>
                          <PlusIcon className="mr-2 size-3" />
                          Add to Collection
                        </>
                      )}
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
