import { useIsMobile } from "@avoid.quest/ui/hooks/use-mobile";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { Volume2Icon } from "lucide-react";
import type { Radio } from "@/lib/audio";
import {
  setCrossfadePosition,
  setHeadphoneVolume,
  setMasterVolume,
} from "@/lib/dj-actions";
import { type DeckId, getDjDeckModule } from "@/lib/dj-deck";
import { useDjKeyboard } from "@/lib/hooks/use-dj-keyboard";
import {
  setActiveDragRadio,
  useActiveDragRadio,
  useDeckA,
  useDeckB,
  useMixer,
} from "@/lib/hooks/use-dj-state";
import { useMediaSession } from "@/lib/hooks/use-media-session";
import { useMidi } from "@/lib/hooks/use-midi";
import { useAudioSettings } from "@/lib/hooks/use-settings";
import { RadioLogo } from "../radio-logo";
import { DjConsole } from "./dj-console";
import { DjConsoleMobile } from "./dj-console-mobile";

type DjPlayerProps = {
  radios?: Radio[];
};

function DjPlayerDragOverlay({
  activeDragRadio,
}: {
  activeDragRadio: Radio | null;
}) {
  if (!activeDragRadio) {
    return null;
  }

  return (
    <div className="rounded-lg border bg-background p-4 shadow-lg">
      <div className="flex items-center gap-3">
        <RadioLogo
          fallbackIcon={
            <Volume2Icon className="size-4 text-muted-foreground" />
          }
          logoUrl={activeDragRadio.logoUrl}
          name={activeDragRadio.name}
          size="lg"
        />
        <div>
          <div className="font-medium">{activeDragRadio.name}</div>
          {activeDragRadio.description?.trim() !== "" && (
            <div className="text-muted-foreground text-sm">
              {activeDragRadio.description}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function isDeckId(value: string): value is DeckId {
  return value === "deck-a" || value === "deck-b";
}

function handleDragStart(event: DragStartEvent) {
  const { active } = event;
  const radio = active.data.current?.radio;
  if (radio) {
    setActiveDragRadio(radio);
  }
}

function handleDragEnd(event: DragEndEvent) {
  const { active, over } = event;
  const decks = getDjDeckModule();
  setActiveDragRadio(null);

  if (!over) {
    decks.pendingSource.cancel();
    return;
  }

  const radio = active.data.current?.radio as Radio;
  const deckId = over.id as string;

  if (isDeckId(deckId)) {
    decks
      .deck(deckId)
      .load({ radio, type: "library" })
      .catch((error) => {
        console.error("[dj] Failed to load dragged source:", error);
      });
  }
}

function handleDeckACueChange(enabled: boolean) {
  getDjDeckModule().deck("deck-a").change({ enabled, type: "cue" });
}

function handleDeckBCueChange(enabled: boolean) {
  getDjDeckModule().deck("deck-b").change({ enabled, type: "cue" });
}

export function DjPlayer({ radios = [] }: DjPlayerProps) {
  useDjKeyboard();
  useMidi();

  const activeDragRadio = useActiveDragRadio();
  const mixer = useMixer();
  const audioSettings = useAudioSettings();
  const deckA = useDeckA();
  const deckB = useDeckB();

  const isPlaying = (deckA?.isPlaying ?? false) || (deckB?.isPlaying ?? false);
  useMediaSession({
    deckA: deckA?.radio ?? null,
    deckB: deckB?.radio ?? null,
    isPlaying,
    mode: "dj",
  });

  const crossfadePosition = mixer?.crossfadePosition ?? 0.5;
  const masterVolume = mixer?.masterVolume ?? 1;
  const headphoneVolume = mixer?.headphoneVolume ?? 1;
  const deckACueEnabled = mixer?.deckACueEnabled ?? false;
  const deckBCueEnabled = mixer?.deckBCueEnabled ?? false;
  const isCueActive = !!audioSettings.cueOutputId;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 50, tolerance: 5 },
    })
  );

  const isMobile = useIsMobile();

  return (
    <DndContext
      onDragEnd={handleDragEnd}
      onDragStart={handleDragStart}
      sensors={sensors}
    >
      <div
        className="flex h-full min-h-0 w-full flex-col px-2 py-2"
        style={{ touchAction: "manipulation" }}
      >
        {isMobile ? (
          <DjConsoleMobile
            crossfadePosition={crossfadePosition}
            deckACueEnabled={deckACueEnabled}
            deckBCueEnabled={deckBCueEnabled}
            isCueActive={isCueActive}
            masterVolume={masterVolume}
            onCrossfadeChange={setCrossfadePosition}
            onDeckACueChange={handleDeckACueChange}
            onDeckBCueChange={handleDeckBCueChange}
            onMasterVolumeChange={setMasterVolume}
            radios={radios}
          />
        ) : (
          <DjConsole
            crossfadePosition={crossfadePosition}
            deckACueEnabled={deckACueEnabled}
            deckBCueEnabled={deckBCueEnabled}
            headphoneVolume={headphoneVolume}
            isCueActive={isCueActive}
            masterVolume={masterVolume}
            onCrossfadeChange={setCrossfadePosition}
            onDeckACueChange={handleDeckACueChange}
            onDeckBCueChange={handleDeckBCueChange}
            onHeadphoneVolumeChange={setHeadphoneVolume}
            onMasterVolumeChange={setMasterVolume}
            radios={radios}
          />
        )}
      </div>

      <DragOverlay style={{ position: "fixed", zIndex: 9999 }}>
        <DjPlayerDragOverlay activeDragRadio={activeDragRadio} />
      </DragOverlay>
    </DndContext>
  );
}
