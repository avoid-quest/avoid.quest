import { Badge } from "@avoid.quest/ui/components/badge";
import { Button } from "@avoid.quest/ui/components/button";
import { Input } from "@avoid.quest/ui/components/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@avoid.quest/ui/components/tabs";
import { useIsMobile } from "@avoid.quest/ui/hooks/use-mobile";
import { useDraggable } from "@dnd-kit/core";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  FileAudioIcon,
  GlobeIcon,
  GripVerticalIcon,
  MicIcon,
  RadioTowerIcon,
  SearchIcon,
  Volume2Icon,
} from "lucide-react";
import { useState } from "react";
import type { Radio } from "@/lib/audio";
import { getDjDeckActions } from "@/lib/dj-actions";
import {
  AUDIO_INPUT_PLATFORM_ID,
  BANDCAMP_PLATFORM_ID,
  getPlatformFromPlaceholderItem,
  getPlatformSourceColor,
  isPlatformPlaceholderItem,
  PLATFORM_ITEMS,
  RADIO_GARDEN_PLATFORM_ID,
  SEARCH_ALL_PLATFORM_ID,
  SOUNDCLOUD_PLATFORM_ID,
  STATIC_AUDIO_PLATFORM_ID,
  YOUTUBE_PLATFORM_ID,
} from "@/lib/dj-library-sources";
import {
  isSessionRadio,
  useSessionRadios,
} from "@/lib/hooks/use-session-radios";
import type { Platform } from "@/lib/platform-types";
import { RadioLogo } from "../radio-logo";

type DjRadioListProps = {
  radios: Radio[];
};

export {
  AUDIO_INPUT_PLATFORM_ID,
  BANDCAMP_PLATFORM_ID,
  PLATFORM_ITEMS,
  RADIO_GARDEN_PLATFORM_ID,
  SEARCH_ALL_PLATFORM_ID,
  SOUNDCLOUD_PLATFORM_ID,
  STATIC_AUDIO_PLATFORM_ID,
  YOUTUBE_PLATFORM_ID,
} from "@/lib/dj-library-sources";
export const LOCAL_FILE_PLATFORM_ID = STATIC_AUDIO_PLATFORM_ID;
/** @deprecated Use SEARCH_ALL_PLATFORM_ID */
export const EXTERNAL_PLATFORM_ID = SEARCH_ALL_PLATFORM_ID;

export function isPlatformItem(radio: Radio): boolean {
  return isPlatformPlaceholderItem(radio);
}

export function isRadioGardenItem(radio: Radio): boolean {
  return radio.id === RADIO_GARDEN_PLATFORM_ID;
}

export function isAudioInputItem(radio: Radio): boolean {
  return radio.id === AUDIO_INPUT_PLATFORM_ID;
}

export function isStaticAudioItem(radio: Radio): boolean {
  return radio.id === STATIC_AUDIO_PLATFORM_ID;
}

/** @deprecated Use isStaticAudioItem */
export function isLocalFileItem(radio: Radio): boolean {
  return radio.id === STATIC_AUDIO_PLATFORM_ID;
}

export function isSearchAllItem(radio: Radio): boolean {
  return radio.id === SEARCH_ALL_PLATFORM_ID;
}

/** @deprecated Use isSearchAllItem */
export function isExternalItem(radio: Radio): boolean {
  return radio.id === SEARCH_ALL_PLATFORM_ID;
}

export function isBandcampItem(radio: Radio): boolean {
  return radio.id === BANDCAMP_PLATFORM_ID;
}

export function isSoundCloudItem(radio: Radio): boolean {
  return radio.id === SOUNDCLOUD_PLATFORM_ID;
}

export function isYouTubeItem(radio: Radio): boolean {
  return radio.id === YOUTUBE_PLATFORM_ID;
}

export function getPlatformFromItem(radio: Radio): Platform | null {
  return getPlatformFromPlaceholderItem(radio);
}

function getPlatformColor(platform: Platform | null): string {
  return getPlatformSourceColor(platform);
}

export function RadioItemContent({ radio }: { radio: Radio }) {
  const isPlatform = isPlatformItem(radio);
  const isAudioInput = isAudioInputItem(radio);
  const isStaticAudio = isStaticAudioItem(radio);
  const isSearchAll = isSearchAllItem(radio);
  const isRG = isRadioGardenItem(radio);
  const isSession = isSessionRadio(radio);
  const platform = getPlatformFromItem(radio);
  const platformColor = getPlatformColor(platform);

  const getPlatformIcon = () => {
    if (isAudioInput) {
      return <MicIcon className="size-5" style={{ color: platformColor }} />;
    }
    if (isStaticAudio) {
      return (
        <FileAudioIcon className="size-5" style={{ color: platformColor }} />
      );
    }
    if (isRG) {
      return (
        <RadioTowerIcon className="size-5" style={{ color: platformColor }} />
      );
    }
    if (isSearchAll) {
      return <SearchIcon className="size-5" style={{ color: platformColor }} />;
    }
    return <GlobeIcon className="size-5" style={{ color: platformColor }} />;
  };

  const subtitle = radio.placeTitle
    ? `${radio.placeTitle}, ${radio.countryTitle}`
    : radio.description;

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <div className="shrink-0">
        {isPlatform ? (
          <div
            className="flex size-10 items-center justify-center rounded"
            style={{
              backgroundColor: `${platformColor}1a`,
            }}
          >
            {getPlatformIcon()}
          </div>
        ) : (
          <RadioLogo
            fallbackIcon={
              <Volume2Icon className="size-4 text-muted-foreground" />
            }
            logoUrl={radio.logoUrl}
            name={radio.name}
            size="md"
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <h3 className="truncate font-medium text-sm">{radio.name}</h3>
          {isSession && (
            <Badge
              className="h-4 shrink-0 border-[#00d084]/30 bg-[#00d084]/10 px-1 text-[#00d084] text-[10px]"
              variant="outline"
            >
              Unsaved
            </Badge>
          )}
        </div>
        {subtitle?.trim() !== "" && (
          <p className="truncate text-muted-foreground text-xs">{subtitle}</p>
        )}
      </div>
    </div>
  );
}

type DraggableRadioItemProps = {
  radio: Radio;
};

export function DraggableRadioItem({ radio }: DraggableRadioItemProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `radio-${radio.id}`,
      data: { radio },
    });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined;

  const isPlatform = isPlatformItem(radio);

  return (
    <div
      className={`flex w-full shrink-0 items-center gap-2 rounded-lg border bg-card p-3 transition-all hover:-translate-y-0.5 hover:shadow-md ${
        isDragging ? "cursor-grabbing opacity-50 shadow-lg" : "cursor-grab"
      } ${isPlatform ? "border-primary/50 border-dashed bg-primary/5" : ""}`}
      ref={setNodeRef}
      style={{
        ...style,
        touchAction: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
      {...attributes}
      {...listeners}
    >
      {/* Grip icon - visual indicator only */}
      <div className="rounded p-1">
        <GripVerticalIcon className="size-4 text-muted-foreground/50 sm:size-3" />
      </div>

      <RadioItemContent radio={radio} />
    </div>
  );
}

export function MobileRadioItem({ radio }: { radio: Radio }) {
  const handleLoad = (deckId: "deck-a" | "deck-b") => {
    getDjDeckActions(deckId)
      .loadLibrarySource(radio)
      .catch((error) => {
        console.error("[dj] Failed to load mobile source:", error);
      });
  };

  return (
    <div className="flex w-full shrink-0 items-center justify-between gap-2 rounded-lg border bg-card p-3">
      <RadioItemContent radio={radio} />

      <div className="flex shrink-0 gap-1">
        <Button
          aria-label="Load to Deck A"
          className="h-8 w-8 p-0"
          onClick={() => handleLoad("deck-a")}
          size="sm"
          title="Load to Deck A"
          variant="outline"
        >
          <ChevronLeftIcon className="size-4" />
        </Button>
        <Button
          aria-label="Load to Deck B"
          className="h-8 w-8 p-0"
          onClick={() => handleLoad("deck-b")}
          size="sm"
          title="Load to Deck B"
          variant="outline"
        >
          <ChevronRightIcon className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function DjRadioList({ radios }: DjRadioListProps) {
  const isMobile = useIsMobile();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("radios");
  const sessionRadios = useSessionRadios((s) => s.radios);

  const allRadios = [
    ...radios,
    ...sessionRadios.filter((sr) => !radios.some((r) => r.id === sr.id)),
  ];

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

  const filteredRadios = filterBySearchQuery(allRadios);
  const filteredPlatformItems = filterBySearchQuery(PLATFORM_ITEMS);

  const renderRadioList = (itemsToRender: Radio[]) => {
    if (itemsToRender.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <p className="text-muted-foreground text-sm">
            {searchQuery.trim()
              ? "No items found matching your search"
              : "No items available"}
          </p>
        </div>
      );
    }

    return (
      <div
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto"
        style={{
          touchAction: "pan-y",
          // Ensure drag operations can escape this container
          position: "relative",
          zIndex: 1,
        }}
      >
        {itemsToRender.map((radio) =>
          isMobile ? (
            <MobileRadioItem key={radio.id} radio={radio} />
          ) : (
            <DraggableRadioItem key={radio.id} radio={radio} />
          )
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Tabs
        className="flex h-full min-h-0 flex-col"
        onValueChange={setActiveTab}
        value={activeTab}
      >
        {/* Header with tabs and search */}
        <div className="mb-3 flex shrink-0 flex-col gap-2">
          <TabsList className="w-full">
            <TabsTrigger className="flex-1 text-xs" value="radios">
              Library
            </TabsTrigger>
            <TabsTrigger className="flex-1 text-xs" value="external">
              Sources
            </TabsTrigger>
          </TabsList>
          <div className="relative">
            <SearchIcon className="absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
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

        {/* Help text */}
        <div className="mb-3 shrink-0 text-muted-foreground text-xs">
          {isMobile ? "Tap ← or → to load stations" : "Drag to load in a deck"}
        </div>

        {/* Radios Tab */}
        <TabsContent
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden"
          value="radios"
        >
          {renderRadioList(filteredRadios)}
        </TabsContent>

        {/* External Tab */}
        <TabsContent
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden"
          value="external"
        >
          {renderRadioList(filteredPlatformItems)}
        </TabsContent>
      </Tabs>
    </div>
  );
}
