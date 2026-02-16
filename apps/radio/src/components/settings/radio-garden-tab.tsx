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
import { radiosCollection } from "@/lib/collections";
import { addRadio } from "@/lib/hooks/use-radios";
import type {
  RadioGardenMetadata,
  RadioGardenSearchResult,
} from "@/lib/platform-types";
import {
  radioGardenResolveStream,
  radioGardenSearch,
} from "@/utils/radio-garden.functions";

type RadioGardenTabProps = {
  onSuccess: () => void;
};

export function RadioGardenTab({ onSuccess }: RadioGardenTabProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RadioGardenSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editedName, setEditedName] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) {
      return;
    }

    setIsSearching(true);
    setSearchError(null);
    setSelectedId(null);
    try {
      const response = await radioGardenSearch({
        data: { query: query.trim() },
      });

      if (!response.ok) {
        setSearchError(response.error.message);
        setResults([]);
        return;
      }

      setResults(response.data.results);
      if (response.data.results.length === 0) {
        setSearchError("No stations found. Try a different search.");
      }
    } catch (error) {
      captureError(error, {
        surface: "ui",
        operation: "radio-garden.search",
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

  const handleSelect = (result: RadioGardenSearchResult) => {
    if (selectedId === result.channelId) {
      setSelectedId(null);
      return;
    }
    setSelectedId(result.channelId);
    setEditedName(result.title);
  };

  const handleAdd = async (result: RadioGardenSearchResult) => {
    setIsAdding(true);
    try {
      const resolveResponse = await radioGardenResolveStream({
        data: { channelId: result.channelId },
      });

      if (!resolveResponse.ok) {
        toast.error(
          `Failed to resolve stream: ${resolveResponse.error.message}`
        );
        return;
      }

      const existingRadios = Array.from(radiosCollection.state.values());
      const maxOrder = Math.max(...existingRadios.map((r) => r.order || 0), 0);

      const metadata: RadioGardenMetadata = {
        platform: "radiogarden",
        itemType: "channel",
        url: result.url,
        channelId: result.channelId,
        name: editedName || result.title,
        subtitle: result.subtitle,
        website: result.website,
        placeTitle: result.placeTitle,
        countryTitle: result.countryTitle,
      };

      addRadio({
        name: editedName || result.title,
        streamUrl: resolveResponse.data.streamUrl,
        description: `${result.placeTitle}, ${result.countryTitle}`,
        websiteUrl: result.website,
        order: maxOrder + 1,
        enabled: true,
        isSystem: false,
        platformMetadata: metadata,
      });

      toast.success(`Added "${editedName || result.title}" to your collection`);
      onSuccess();
    } catch (error) {
      captureError(error, {
        surface: "ui",
        operation: "radio-garden.add",
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

  const selected = results.find((r) => r.channelId === selectedId);

  return (
    <div className="flex flex-col gap-3">
      <form className="flex gap-2" onSubmit={handleSearch}>
        <div className="relative flex-1">
          <SearchIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            disabled={isSearching}
            onChange={(e) => setQuery(e.target.value)}
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

      {searchError && (
        <div className="rounded-md bg-destructive/10 p-3">
          <p className="text-destructive text-sm">{searchError}</p>
        </div>
      )}

      {results.length > 0 && (
        <ScrollArea className="max-h-[50vh]">
          <div className="space-y-1 pr-3">
            {results.map((result) => (
              <div key={result.channelId}>
                <button
                  className="flex w-full items-center gap-3 rounded-md p-2.5 text-left transition-colors hover:bg-accent data-[selected=true]:bg-accent"
                  data-selected={selectedId === result.channelId}
                  onClick={() => handleSelect(result)}
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

                {selectedId === result.channelId && selected && (
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
                        onChange={(e) => setEditedName(e.target.value)}
                        value={editedName}
                      />
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground text-xs">
                      <GlobeIcon className="size-3 shrink-0" />
                      <span>
                        {result.placeTitle}, {result.countryTitle}
                      </span>
                    </div>
                    {result.website && (
                      <a
                        className="flex items-center gap-1 text-primary text-xs hover:underline"
                        href={result.website}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        <ExternalLinkIcon className="size-3" />
                        {result.website}
                      </a>
                    )}
                    <Button
                      className="w-full"
                      disabled={isAdding}
                      onClick={() => handleAdd(result)}
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
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
