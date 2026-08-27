// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
import { Button } from "@avoid.quest/ui/components/button";
import { Input } from "@avoid.quest/ui/components/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@avoid.quest/ui/components/tabs";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  FileAudioIcon,
  GlobeIcon,
  MicIcon,
  RadioTowerIcon,
  SearchIcon,
  Volume2Icon,
} from "lucide-react";
import { useState } from "react";
import type { Radio } from "@/lib/audio";
import { getDjDeckModule } from "@/lib/dj-deck";
import {
  AUDIO_INPUT_PLATFORM_ID,
  getPlatformFromPlaceholderItem,
  getPlatformSourceColor,
  isPlatformPlaceholderItem,
  PLATFORM_ITEMS,
  RADIO_GARDEN_PLATFORM_ID,
  SEARCH_ALL_PLATFORM_ID,
  STATIC_AUDIO_PLATFORM_ID,
} from "@/lib/dj-library-sources";
import { useSessionRadios } from "@/lib/hooks/use-session-radios";
import { useUnifiedRadioSearch } from "@/lib/hooks/use-unified-radio-search";
import { RadioLogo } from "../radio-logo";
import { toDjBrowserRadio } from "./browser/browser-model";

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
export const EXTERNAL_PLATFORM_ID = SEARCH_ALL_PLATFORM_ID;

export function isPlatformItem(radio: Radio): boolean {
  return isPlatformPlaceholderItem(radio);
}

function PlatformIcon({ radio }: { radio: Radio }) {
  const platform = getPlatformFromPlaceholderItem(radio);
  const color = getPlatformSourceColor(platform);
  const className = "size-5";

  if (radio.id === AUDIO_INPUT_PLATFORM_ID) {
    return <MicIcon className={className} style={{ color }} />;
  }
  if (radio.id === STATIC_AUDIO_PLATFORM_ID) {
    return <FileAudioIcon className={className} style={{ color }} />;
  }
  if (radio.id === RADIO_GARDEN_PLATFORM_ID) {
    return <RadioTowerIcon className={className} style={{ color }} />;
  }
  if (radio.id === SEARCH_ALL_PLATFORM_ID) {
    return <SearchIcon className={className} style={{ color }} />;
  }
  return <GlobeIcon className={className} style={{ color }} />;
}

export function RadioItemContent({ radio }: { radio: Radio }) {
  const isPlatform = isPlatformItem(radio);
  const platform = isPlatform ? getPlatformFromPlaceholderItem(radio) : null;
  const platformColor = getPlatformSourceColor(platform);
  const place =
    radio.placeTitle?.toLocaleLowerCase() ===
    radio.countryTitle?.toLocaleLowerCase()
      ? undefined
      : radio.placeTitle;
  const subtitle =
    [place, radio.countryTitle].filter(Boolean).join(", ") || radio.description;

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      {isPlatform ? (
        <div
          className="flex size-10 shrink-0 items-center justify-center rounded"
          style={{ backgroundColor: `${platformColor}1a` }}
        >
          <PlatformIcon radio={radio} />
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
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-medium text-sm">{radio.name}</h3>
        {subtitle?.trim() !== "" && (
          <p className="truncate text-muted-foreground text-xs">{subtitle}</p>
        )}
      </div>
    </div>
  );
}

function MobileRadioItem({ radio }: { radio: Radio }) {
  const load = (deckId: "deck-a" | "deck-b") => {
    getDjDeckModule()
      .deck(deckId)
      .load({ radio, type: "library" })
      .catch((error) => {
        console.error("[dj] Failed to load mobile source:", error);
      });
  };
  const handleLoadDeckA = () => load("deck-a");
  const handleLoadDeckB = () => load("deck-b");

  return (
    <div className="flex w-full shrink-0 items-center justify-between gap-2 rounded-lg border bg-card p-3">
      <RadioItemContent radio={radio} />
      <div className="flex shrink-0 gap-1">
        <Button
          aria-label="Load to Deck A"
          className="h-8 w-8 p-0"
          onClick={handleLoadDeckA}
          size="sm"
          title="Load to Deck A"
          variant="outline"
        >
          <ChevronLeftIcon className="size-4" />
        </Button>
        <Button
          aria-label="Load to Deck B"
          className="h-8 w-8 p-0"
          onClick={handleLoadDeckB}
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

function MobileList({
  emptyLabel,
  items,
}: {
  emptyLabel: string;
  items: Radio[];
}) {
  if (items.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-center">
        <p className="text-muted-foreground text-sm">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
      {items.map((radio) => (
        <MobileRadioItem key={radio.id ?? radio.streamUrl} radio={radio} />
      ))}
    </div>
  );
}

export function DjRadioList({ radios }: { radios: Radio[] }) {
  const [activeTab, setActiveTab] = useState("stations");
  const [query, setQuery] = useState("");
  const sessionRadios = useSessionRadios((state) => state.radios);
  const allRadios = [
    ...radios,
    ...sessionRadios.filter(
      (sessionRadio) => !radios.some((radio) => radio.id === sessionRadio.id)
    ),
  ];
  const { isSearching, results } = useUnifiedRadioSearch(query, allRadios);
  const hasQuery = query.trim().length > 0;
  const visibleRadios = hasQuery ? results.map(toDjBrowserRadio) : allRadios;
  const handleQueryChange = (event: React.ChangeEvent<HTMLInputElement>) =>
    setQuery(event.target.value);

  return (
    <Tabs
      className="flex h-full min-h-0 flex-col"
      onValueChange={setActiveTab}
      value={activeTab}
    >
      <TabsList className="mb-2 w-full shrink-0">
        <TabsTrigger className="flex-1 text-xs" value="stations">
          Stations
        </TabsTrigger>
        <TabsTrigger className="flex-1 text-xs" value="sources">
          Other sources
        </TabsTrigger>
      </TabsList>
      {activeTab === "stations" && (
        <div className="relative mb-2 shrink-0">
          <SearchIcon className="absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search stations"
            className="h-8 pl-8 text-xs"
            maxLength={200}
            onChange={handleQueryChange}
            placeholder="Search stations…"
            type="search"
            value={query}
          />
        </div>
      )}
      <TabsContent
        className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden"
        value="stations"
      >
        <MobileList
          emptyLabel={
            (isSearching && "Searching station directories…") ||
            (hasQuery && "No playable stations found") ||
            "No stations in your collection"
          }
          items={visibleRadios}
        />
      </TabsContent>
      <TabsContent
        className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden"
        value="sources"
      >
        <MobileList emptyLabel="No sources available" items={PLATFORM_ITEMS} />
      </TabsContent>
    </Tabs>
  );
}
