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
  GripVerticalIcon,
  MicIcon,
  MusicIcon,
  SearchIcon,
  Volume2Icon,
} from "lucide-react";
import { useState } from "react";
import type { Radio } from "@/lib/audio";
import { setDeckARadio, setDeckBRadio } from "@/lib/dj-actions";
import { setPendingPlatformItem } from "@/lib/hooks/use-dj-state";
import type { Platform } from "@/lib/platform-types";
import { RadioLogo } from "../radio-logo";

type DjRadioListProps = {
  radios: Radio[];
};

const BANDCAMP_PLATFORM_ID = -1;
const SOUNDCLOUD_PLATFORM_ID = -2;
const AUDIO_INPUT_PLATFORM_ID = -3;

const BANDCAMP_COLOR = "#629aa0";
const SOUNDCLOUD_COLOR = "#ff7700";
const AUDIO_INPUT_COLOR = "#10b981";

// Platform-specific placeholder items
export const PLATFORM_ITEMS: Radio[] = [
  {
    id: BANDCAMP_PLATFORM_ID,
    name: "Bandcamp",
    streamUrl: "",
    description: "Paste a Bandcamp URL (album, track, or artist)",
    enabled: true,
    platformMetadata: {
      platform: "bandcamp",
      itemType: "album",
      url: "",
    },
  },
  {
    id: SOUNDCLOUD_PLATFORM_ID,
    name: "SoundCloud",
    streamUrl: "",
    description: "Paste a SoundCloud URL (track, playlist, or user)",
    enabled: true,
    platformMetadata: {
      platform: "soundcloud",
      itemType: "track",
      url: "",
    },
  },
  {
    id: AUDIO_INPUT_PLATFORM_ID,
    name: "Audio Input",
    streamUrl: "",
    description: "Route mic/line-in from your audio interface",
    enabled: true,
    platformMetadata: {
      platform: "device-input",
      itemType: "track",
      url: "",
      deviceId: "",
      deviceLabel: "",
      channelSelection: { left: 0, right: 1 },
      channelCount: 2,
    },
  },
];

export function isPlatformItem(radio: Radio): boolean {
  return (
    radio.id === BANDCAMP_PLATFORM_ID ||
    radio.id === SOUNDCLOUD_PLATFORM_ID ||
    radio.id === AUDIO_INPUT_PLATFORM_ID
  );
}

export function isAudioInputItem(radio: Radio): boolean {
  return radio.id === AUDIO_INPUT_PLATFORM_ID;
}

export function getPlatformFromItem(radio: Radio): Platform | null {
  if (radio.id === BANDCAMP_PLATFORM_ID) {
    return "bandcamp";
  }
  if (radio.id === SOUNDCLOUD_PLATFORM_ID) {
    return "soundcloud";
  }
  if (radio.id === AUDIO_INPUT_PLATFORM_ID) {
    return "device-input";
  }
  return radio.platformMetadata?.platform || null;
}

function getPlatformColor(platform: Platform | null): string {
  switch (platform) {
    case "bandcamp":
      return BANDCAMP_COLOR;
    case "soundcloud":
      return SOUNDCLOUD_COLOR;
    case "device-input":
      return AUDIO_INPUT_COLOR;
    default:
      return SOUNDCLOUD_COLOR;
  }
}

export function RadioItemContent({ radio }: { radio: Radio }) {
  const isPlatform = isPlatformItem(radio);
  const isAudioInput = isAudioInputItem(radio);
  const platform = getPlatformFromItem(radio);
  const platformColor = getPlatformColor(platform);

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
            {isAudioInput ? (
              <MicIcon
                className="size-5"
                style={{
                  color: platformColor,
                }}
              />
            ) : (
              <MusicIcon
                className="size-5"
                style={{
                  color: platformColor,
                }}
              />
            )}
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
        <h3 className="truncate font-medium text-sm">{radio.name}</h3>
        {radio.description?.trim() !== "" && (
          <p className="truncate text-muted-foreground text-xs">
            {radio.description}
          </p>
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
    const isPlatform = isPlatformItem(radio);
    const platform = getPlatformFromItem(radio);
    if (isPlatform) {
      if (platform) {
        setPendingPlatformItem({
          deckId,
          platform,
        });
      }
    } else if (deckId === "deck-a") {
      setDeckARadio(radio);
    } else {
      setDeckBRadio(radio);
    }
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
              Radios
            </TabsTrigger>
            <TabsTrigger className="flex-1 text-xs" value="external">
              External
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
