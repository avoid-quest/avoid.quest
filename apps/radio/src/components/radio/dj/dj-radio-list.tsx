import { useDraggable } from "@dnd-kit/core";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";
import { useIsMobile } from "@workspace/ui/hooks/use-mobile";
import {
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Music,
  Search,
  Volume2,
} from "lucide-react";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { Platform } from "@/lib/external-url/types";
import { useDjStore } from "@/lib/stores/dj-store";
import type { Radio } from "@/lib/types";
import { RadioLogo } from "../radio-logo";
import { RadioNameLink } from "../radio-name-link";

type DjRadioListProps = {
  radios: Radio[];
};

const BANDCAMP_PLATFORM_ID = -1;
const SOUNDCLOUD_PLATFORM_ID = -2;

const BANDCAMP_COLOR = "#629aa0";
const SOUNDCLOUD_COLOR = "#ff7700";

// Platform-specific placeholder items
const PLATFORM_ITEMS: Radio[] = [
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
];

export function isPlatformItem(radio: Radio): boolean {
  return (
    radio.id === BANDCAMP_PLATFORM_ID || radio.id === SOUNDCLOUD_PLATFORM_ID
  );
}

export function getPlatformFromItem(radio: Radio): Platform | null {
  if (radio.id === BANDCAMP_PLATFORM_ID) {
    return "bandcamp";
  }
  if (radio.id === SOUNDCLOUD_PLATFORM_ID) {
    return "soundcloud";
  }
  return radio.platformMetadata?.platform || null;
}

function RadioItemContent({ radio }: { radio: Radio }) {
  const isPlatform = isPlatformItem(radio);
  const platform = getPlatformFromItem(radio);

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <div className="shrink-0">
        {isPlatform ? (
          <div
            className="flex size-10 items-center justify-center rounded"
            style={{
              backgroundColor:
                platform === "bandcamp"
                  ? `${BANDCAMP_COLOR}1a`
                  : `${SOUNDCLOUD_COLOR}1a`,
            }}
          >
            <Music
              className="size-5"
              style={{
                color:
                  platform === "bandcamp" ? BANDCAMP_COLOR : SOUNDCLOUD_COLOR,
              }}
            />
          </div>
        ) : (
          <RadioLogo
            fallbackIcon={<Volume2 className="size-4 text-muted-foreground" />}
            logoUrl={radio.logoUrl}
            name={radio.name}
            size="md"
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-medium text-sm">
          {isPlatform ? radio.name : <RadioNameLink radio={radio} />}
        </h3>
        {radio.description && (
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

function DraggableRadioItem({ radio }: DraggableRadioItemProps) {
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
      className={`flex w-full shrink-0 items-center gap-2 rounded-lg border bg-card p-3 transition-all hover:shadow-md ${
        isDragging ? "opacity-50 shadow-lg" : ""
      } ${isPlatform ? "border-primary/50 border-dashed bg-primary/5" : ""}`}
      ref={setNodeRef}
      style={{
        ...style,
        // Ensure drag operations can escape scroll containers on mobile
        touchAction: "none",
        // Prevent text selection during drag on mobile
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      {/* Drag Handle - Only this area is draggable */}
      <div
        className={`cursor-grab touch-manipulation rounded p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground active:cursor-grabbing ${
          isDragging ? "bg-primary/20 text-primary" : ""
        }`}
        style={{
          touchAction: "none",
          // Ensure proper touch handling on mobile
          WebkitTouchCallout: "none",
          WebkitUserSelect: "none",
          userSelect: "none",
        }}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4 sm:size-3" />
      </div>

      {/* Radio Content - Not draggable, allows normal interaction */}
      <RadioItemContent radio={radio} />
    </div>
  );
}

function MobileRadioItem({ radio }: { radio: Radio }) {
  const { setLeftRadio, setRightRadio, setPendingPlatformItem } = useDjStore(
    useShallow((state) => ({
      setLeftRadio: state.setLeftRadio,
      setRightRadio: state.setRightRadio,
      setPendingPlatformItem: state.setPendingPlatformItem,
    }))
  );

  const handleLoad = (deckId: "left-deck" | "right-deck") => {
    const isPlatform = isPlatformItem(radio);
    const platform = getPlatformFromItem(radio);
    if (isPlatform) {
      if (platform) {
        setPendingPlatformItem({
          deckId,
          platform,
        });
      }
    } else if (deckId === "left-deck") {
      setLeftRadio(radio);
    } else {
      setRightRadio(radio);
    }
  };

  return (
    <div className="flex w-full shrink-0 items-center justify-between gap-2 rounded-lg border bg-card p-3">
      <RadioItemContent radio={radio} />

      <div className="flex shrink-0 gap-1">
        <Button
          aria-label="Load to Left Deck"
          className="h-8 w-8 p-0"
          onClick={() => handleLoad("left-deck")}
          size="sm"
          title="Load to Left Deck"
          variant="outline"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button
          aria-label="Load to Right Deck"
          className="h-8 w-8 p-0"
          onClick={() => handleLoad("right-deck")}
          size="sm"
          title="Load to Right Deck"
          variant="outline"
        >
          <ChevronRight className="size-4" />
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
              External Inputs
            </TabsTrigger>
          </TabsList>
          <div className="relative">
            <Search className="-translate-y-1/2 absolute top-1/2 left-2 size-4 text-muted-foreground" />
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
          {isMobile
            ? "Tap ← or → to load stations"
            : "Use the grip handle to drag stations to the decks"}
        </div>

        {/* Radios Tab */}
        <TabsContent
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden"
          value="radios"
        >
          {renderRadioList(filteredRadios)}
        </TabsContent>

        {/* External Inputs Tab */}
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
