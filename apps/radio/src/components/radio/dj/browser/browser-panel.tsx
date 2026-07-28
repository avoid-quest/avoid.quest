import { Input } from "@avoid.quest/ui/components/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@avoid.quest/ui/components/tabs";
import { cn } from "@avoid.quest/ui/lib/utils";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  LoaderIcon,
  SearchIcon,
} from "lucide-react";
import { useState } from "react";
import type { Radio } from "@/lib/audio";
import { PLATFORM_ITEMS } from "@/lib/dj-library-sources";
import { useSessionRadios } from "@/lib/hooks/use-session-radios";
import { useUnifiedRadioSearch } from "@/lib/hooks/use-unified-radio-search";
import { BrowserGrid } from "./browser-grid";
import { toDjBrowserRadio } from "./browser-model";

type BrowserPanelProps = {
  radios: Radio[];
  className?: string;
};

export function BrowserPanel({ radios, className }: BrowserPanelProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("stations");
  const sessionRadios = useSessionRadios((s) => s.radios);

  const allRadios = [
    ...radios,
    ...sessionRadios.filter((sr) => !radios.some((r) => r.id === sr.id)),
  ];

  const { duplicateCount, isSearching, results } = useUnifiedRadioSearch(
    searchQuery,
    allRadios
  );
  const hasQuery = searchQuery.trim().length > 0;
  const visibleRadios = hasQuery ? results.map(toDjBrowserRadio) : allRadios;

  return (
    <div className={cn("border-border/50 border-t", className)}>
      <button
        className="flex w-full items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/30"
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <span className="font-mono text-foreground/80 text-xs uppercase tracking-wider">
          Browser
        </span>
        <span className="text-[10px] text-muted-foreground/50">
          {activeTab === "stations" && hasQuery
            ? `${visibleRadios.length} result${visibleRadios.length === 1 ? "" : "s"}`
            : `${allRadios.length} stations · ${PLATFORM_ITEMS.length} sources`}
        </span>
        {activeTab === "stations" && isSearching && (
          <LoaderIcon className="size-3 animate-spin text-muted-foreground/50" />
        )}
        {activeTab === "stations" && hasQuery && duplicateCount > 0 && (
          <span className="text-[10px] text-muted-foreground/40">
            {duplicateCount} merged
          </span>
        )}
        <div className="flex-1" />
        {isOpen ? (
          <ChevronDownIcon className="size-3.5 text-muted-foreground/50" />
        ) : (
          <ChevronUpIcon className="size-3.5 text-muted-foreground/50" />
        )}
      </button>

      {isOpen && (
        <div className="px-3 pb-3">
          <Tabs onValueChange={setActiveTab} value={activeTab}>
            <div className="mb-2 flex items-center gap-2">
              <TabsList className="shrink-0">
                <TabsTrigger className="text-xs" value="stations">
                  Stations
                </TabsTrigger>
                <TabsTrigger className="text-xs" value="sources">
                  Other sources
                </TabsTrigger>
              </TabsList>
              {activeTab === "stations" && (
                <div className="relative min-w-0 flex-1">
                  <SearchIcon className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    aria-label="Search stations"
                    className="h-8 pl-8 text-xs"
                    maxLength={200}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search stations…"
                    type="search"
                    value={searchQuery}
                  />
                </div>
              )}
            </div>
            <TabsContent className="mt-0" value="stations">
              <BrowserGrid
                emptyLabel={
                  (isSearching && "Searching station directories…") ||
                  (hasQuery && "No playable stations found") ||
                  "No stations in your collection"
                }
                items={visibleRadios}
              />
            </TabsContent>
            <TabsContent className="mt-0" value="sources">
              <BrowserGrid
                className="grid-cols-[repeat(auto-fill,minmax(16rem,1fr))]"
                items={PLATFORM_ITEMS}
              />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}
