// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
import { ScrollArea } from "@avoid.quest/ui/components/scroll-area";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@avoid.quest/ui/components/tabs";
import { cn } from "@avoid.quest/ui/lib/utils";
import { useState } from "react";
import type { Radio } from "@/lib/audio";
import { getDjDeckModule } from "@/lib/dj-deck";
import {
  getPlatformFromPlaceholderItem,
  getPlatformSourceColor,
  getPlatformSourceDefinition,
  isPlatformPlaceholderItem,
  PLATFORM_ITEMS,
  SEARCH_ALL_PLATFORM_ID,
  STATIC_AUDIO_PLATFORM_ID,
} from "@/lib/dj-library-sources";
import { useHasEnteredViewport } from "@/lib/hooks/use-has-entered-viewport";
import { useRadioMetadata } from "@/lib/hooks/use-radio-metadata";
import {
  isSessionRadio,
  useSessionRadios,
} from "@/lib/hooks/use-session-radios";
import { EmptyHint } from "../empty-hint";
import { platformSourceIcon } from "../platform-source-icon";
import { RadioListItemMetadata } from "../radio-list-item-metadata";
import { RadioLogo } from "../radio-logo";
import {
  StationRowSubtitle,
  StationRowText,
  stationFallbackSubtitle,
  stationRowButtonOnlyClassName,
} from "../station-row";
import { ExternalSearch } from "./external-search";

export {
  AUDIO_INPUT_PLATFORM_ID,
  BANDCAMP_PLATFORM_ID,
  MIXCLOUD_PLATFORM_ID,
  PLATFORM_ITEMS,
  RADIO_GARDEN_PLATFORM_ID,
  SEARCH_ALL_PLATFORM_ID,
  SOUNDCLOUD_PLATFORM_ID,
  STATIC_AUDIO_PLATFORM_ID,
  YOUTUBE_PLATFORM_ID,
} from "@/lib/dj-library-sources";
export const LOCAL_FILE_PLATFORM_ID = STATIC_AUDIO_PLATFORM_ID;
export const EXTERNAL_PLATFORM_ID = SEARCH_ALL_PLATFORM_ID;

type DeckId = "deck-a" | "deck-b";

export function isPlatformItem(radio: Radio): boolean {
  return isPlatformPlaceholderItem(radio);
}

function PlatformIcon({ radio }: { radio: Radio }) {
  const platform = getPlatformFromPlaceholderItem(radio);
  const color = getPlatformSourceColor(platform);
  const Icon = platformSourceIcon(
    getPlatformSourceDefinition(radio)?.icon ?? "youtube"
  );
  return <Icon className="size-5" style={{ color }} />;
}

function PlatformTile({ radio }: { radio: Radio }) {
  const platformColor = getPlatformSourceColor(
    getPlatformFromPlaceholderItem(radio)
  );
  return (
    <div
      className="flex size-10 shrink-0 items-center justify-center rounded-sm border border-border/70"
      style={{ backgroundColor: `${platformColor}1a` }}
    >
      <PlatformIcon radio={radio} />
    </div>
  );
}

function loadIntoDeck(deckId: DeckId, radio: Radio) {
  getDjDeckModule()
    .deck(deckId)
    .load({ radio, type: "library" })
    .catch((error) => {
      console.error("[dj] Failed to load source:", error);
    });
}

function SourceRow({ radio, deckId }: { radio: Radio; deckId: DeckId }) {
  const handleLoad = () => loadIntoDeck(deckId, radio);

  return (
    <button
      className={stationRowButtonOnlyClassName}
      onClick={handleLoad}
      type="button"
    >
      <PlatformTile radio={radio} />
      <StationRowText title={radio.name}>
        <StationRowSubtitle>{radio.description}</StationRowSubtitle>
      </StationRowText>
    </button>
  );
}

function StationRow({
  radio,
  deckId,
  showSessionMarker,
  isActive,
}: {
  radio: Radio;
  deckId: DeckId;
  showSessionMarker: boolean;
  /** The row Enter in the search field loads. */
  isActive: boolean;
}) {
  const { elementRef, hasEnteredViewport } =
    useHasEnteredViewport<HTMLButtonElement>();
  const { metadata } = useRadioMetadata({
    enabled: hasEnteredViewport,
    poll: false,
    radio,
  });
  const handleLoad = () => loadIntoDeck(deckId, radio);

  return (
    <button
      className={cn(
        stationRowButtonOnlyClassName,
        isActive && "bg-muted/40",
        showSessionMarker &&
          isSessionRadio(radio) &&
          "border-l-2 border-l-[#00d084]/40"
      )}
      onClick={handleLoad}
      ref={elementRef}
      type="button"
    >
      <RadioLogo
        decorative
        logoUrl={radio.logoUrl}
        name={radio.name}
        size="md"
      />
      <StationRowText title={radio.name}>
        <RadioListItemMetadata
          fallback={
            <StationRowSubtitle>
              {stationFallbackSubtitle(radio)}
            </StationRowSubtitle>
          }
          metadata={metadata}
          radio={radio}
        />
      </StationRowText>
    </button>
  );
}

function RowList({
  emptyLabel,
  items,
  deckId,
  isSearch = false,
}: {
  emptyLabel: string;
  items: Radio[];
  deckId: DeckId;
  /** Search results are marked by the search itself, not the session rule. */
  isSearch?: boolean;
}) {
  if (items.length === 0) {
    return <EmptyHint>{emptyLabel}</EmptyHint>;
  }

  return (
    <ScrollArea className="min-h-0 min-w-0 flex-1 overflow-x-hidden">
      <div className="flex w-0 min-w-full flex-col gap-1">
        {items.map((radio, index) =>
          isPlatformItem(radio) ? (
            <SourceRow
              deckId={deckId}
              key={radio.id ?? radio.streamUrl}
              radio={radio}
            />
          ) : (
            <StationRow
              deckId={deckId}
              isActive={isSearch && index === 0}
              key={radio.id ?? radio.streamUrl}
              radio={radio}
              showSessionMarker={!isSearch}
            />
          )
        )}
      </div>
    </ScrollArea>
  );
}

export function DjRadioList({
  radios,
  deckId,
}: {
  radios: Radio[];
  deckId: DeckId;
}) {
  const [activeTab, setActiveTab] = useState("stations");
  const sessionRadios = useSessionRadios((state) => state.radios);
  const allRadios = [
    ...sessionRadios,
    ...radios.filter(
      (radio) =>
        !sessionRadios.some((sessionRadio) => sessionRadio.id === radio.id)
    ),
  ];

  return (
    <ExternalSearch
      onLoad={(radio) => loadIntoDeck(deckId, radio)}
      radios={allRadios}
    >
      <Tabs
        className="flex min-h-0 flex-1 flex-col"
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
        <TabsContent
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden"
          tabIndex={-1}
          value="stations"
        >
          <RowList
            deckId={deckId}
            emptyLabel="Search to find a station"
            items={allRadios}
          />
        </TabsContent>
        <TabsContent
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden"
          tabIndex={-1}
          value="sources"
        >
          <RowList
            deckId={deckId}
            emptyLabel="No sources available"
            items={PLATFORM_ITEMS}
          />
        </TabsContent>
      </Tabs>
    </ExternalSearch>
  );
}
