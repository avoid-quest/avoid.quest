import { Button } from "@avoid.quest/ui/components/button";
import { Card, CardContent } from "@avoid.quest/ui/components/card";
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
import { DraggableRadioItem, PLATFORM_ITEMS } from "./dj-radio-list";

type DjRadioBrowserProps = {
  radios: Radio[];
};

export function DjRadioBrowser({ radios }: DjRadioBrowserProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
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
    <Card className="flex shrink-0 flex-col">
      {/* Header with collapse toggle */}
      <Button
        className="flex w-full items-center justify-between px-4 py-2"
        onClick={() => setIsCollapsed(!isCollapsed)}
        size="sm"
        variant="ghost"
      >
        <span className="font-medium text-sm">Radio Browser</span>
        {isCollapsed ? (
          <ChevronUpIcon className="size-4" />
        ) : (
          <ChevronDownIcon className="size-4" />
        )}
      </Button>

      {!isCollapsed && (
        <CardContent className="px-4 pt-0 pb-4">
          <Tabs onValueChange={setActiveTab} value={activeTab}>
            <div className="mb-2 flex items-center gap-2">
              <TabsList className="shrink-0">
                <TabsTrigger className="text-xs" value="radios">
                  Radios
                </TabsTrigger>
                <TabsTrigger className="text-xs" value="external">
                  External
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

            <div className="mb-2 text-muted-foreground text-xs">
              Drag to load in a deck
            </div>

            <TabsContent className="mt-0" value="radios">
              <BrowserGrid items={filteredRadios} />
            </TabsContent>

            <TabsContent className="mt-0" value="external">
              <BrowserGrid items={filteredPlatformItems} />
            </TabsContent>
          </Tabs>
        </CardContent>
      )}
    </Card>
  );
}

function BrowserGrid({ items }: { items: Radio[] }) {
  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center py-4 text-center">
        <p className="text-muted-foreground text-sm">No items found</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "grid max-h-[14rem] gap-2 overflow-y-auto",
        "grid-cols-[repeat(auto-fill,minmax(12rem,1fr))]"
      )}
      style={{
        touchAction: "pan-y",
        position: "relative",
        zIndex: 1,
      }}
    >
      {items.map((radio) => (
        <DraggableRadioItem key={radio.id} radio={radio} />
      ))}
    </div>
  );
}
