import { Input } from "@avoid.quest/ui/components/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@avoid.quest/ui/components/tabs";
import { cn } from "@avoid.quest/ui/lib/utils";
import { ChevronDownIcon, ChevronUpIcon, SearchIcon } from "lucide-react";
import { useState } from "react";
import type { Radio } from "@/lib/audio";
import { PLATFORM_ITEMS } from "../dj-radio-list";
import { BrowserGrid } from "./browser-grid";

type BrowserPanelProps = {
  radios: Radio[];
  className?: string;
};

export function BrowserPanel({ radios, className }: BrowserPanelProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("radios");

  const filterBySearchQuery = (items: Radio[]) =>
    items.filter((item) => {
      if (!searchQuery.trim()) {
        return true;
      }
      const query = searchQuery.toLowerCase();
      return (
        item.name.toLowerCase().includes(query) ||
        item.description?.toLowerCase().includes(query)
      );
    });

  const filteredRadios = filterBySearchQuery(radios);
  const filteredPlatformItems = filterBySearchQuery(PLATFORM_ITEMS);

  return (
    <div className={cn("border-border/50 border-t", className)}>
      {/* Toggle bar — always visible */}
      <button
        className="flex w-full items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/30"
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <span className="font-mono text-foreground/80 text-xs uppercase tracking-wider">
          Browser
        </span>
        <span className="text-[10px] text-muted-foreground/50">
          {radios.length} stations + {PLATFORM_ITEMS.length} sources
        </span>
        <div className="flex-1" />
        {isOpen ? (
          <ChevronDownIcon className="size-3.5 text-muted-foreground/50" />
        ) : (
          <ChevronUpIcon className="size-3.5 text-muted-foreground/50" />
        )}
      </button>

      {/* Expandable content */}
      {isOpen && (
        <div className="px-3 pb-3">
          <Tabs onValueChange={setActiveTab} value={activeTab}>
            <div className="mb-2 flex items-center gap-2">
              <TabsList className="shrink-0">
                <TabsTrigger className="text-xs" value="radios">
                  Radios
                </TabsTrigger>
                <TabsTrigger className="text-xs" value="external">
                  Sources
                </TabsTrigger>
              </TabsList>
              <div className="relative flex-1">
                <SearchIcon className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="Search radios and external inputs"
                  className="h-8 pl-8 text-xs"
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search..."
                  type="search"
                  value={searchQuery}
                />
              </div>
            </div>

            <TabsContent className="mt-0" value="radios">
              <BrowserGrid items={filteredRadios} />
            </TabsContent>

            <TabsContent className="mt-0" value="external">
              <BrowserGrid items={filteredPlatformItems} />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}
