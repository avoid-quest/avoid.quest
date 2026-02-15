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
import { useEffect, useRef } from "react";
import type { Radio } from "@/lib/audio";
import {
  deckCollection,
  mixerCollection,
  resetDeck,
  settingsCollection,
} from "@/lib/collections";
import {
  setCrossfadePosition,
  setDeckACueEnabled,
  setDeckARadio,
  setDeckBCueEnabled,
  setDeckBRadio,
  setHeadphoneVolume,
  setMasterVolume,
} from "@/lib/dj-actions";
import { useDjKeyboard } from "@/lib/hooks/use-dj-keyboard";
import {
  setActiveDragRadio,
  setPendingPlatformItem,
  useActiveDragRadio,
  useMixer,
} from "@/lib/hooks/use-dj-state";
import { useMidi } from "@/lib/hooks/use-midi";
import { useAudioSettings } from "@/lib/hooks/use-settings";
import type { Platform } from "@/lib/platform-types";
import type { DeckId } from "@/lib/stores/dj-runtime-store";

import { RadioLogo } from "../radio-logo";
import { DjConsole } from "./dj-console";
import { DjConsoleMobile } from "./dj-console-mobile";
import {
  getPlatformFromItem,
  isAudioInputItem,
  isLocalFileItem,
  isPlatformItem,
  isRadioGardenItem,
} from "./dj-radio-list";

// Note: isAudioInputItem, isLocalFileItem, isRadioGardenItem used by handlePlatformItemDrag

type DjPlayerProps = {
  radios?: Radio[];
};

type HandlePlatformItemDragParams = {
  radio: Radio;
  deckId: string;
  setPendingItem: (item: { deckId: DeckId; platform: Platform } | null) => void;
};

function handlePlatformItemDrag({
  radio,
  deckId,
  setPendingItem,
}: HandlePlatformItemDragParams): boolean {
  // Handle all known platform items (audio input, static audio, external, radio garden)
  if (isAudioInputItem(radio)) {
    if (deckId === "deck-a" || deckId === "deck-b") {
      setPendingItem({ deckId, platform: "device-input" });
    }
    return true;
  }

  if (isLocalFileItem(radio)) {
    if (deckId === "deck-a" || deckId === "deck-b") {
      setPendingItem({ deckId, platform: "local-file" });
    }
    return true;
  }

  if (isRadioGardenItem(radio)) {
    if (deckId === "deck-a" || deckId === "deck-b") {
      setPendingItem({ deckId, platform: "radiogarden" });
    }
    return true;
  }

  if (!isPlatformItem(radio)) {
    return false;
  }

  const platform = getPlatformFromItem(radio);
  if (platform && (deckId === "deck-a" || deckId === "deck-b")) {
    setPendingItem({ deckId, platform });
  }
  return true;
}

function useDjStateHydration() {
  const hasHydratedRef = useRef(false);

  useEffect(() => {
    if (hasHydratedRef.current) {
      return;
    }
    hasHydratedRef.current = true;

    (async () => {
      const [settingsMap, deckMap, mixerMap] = await Promise.all([
        settingsCollection.stateWhenReady(),
        deckCollection.stateWhenReady(),
        mixerCollection.stateWhenReady(),
      ]);

      const settings = settingsMap.get("app-settings");
      const shouldRestore = settings?.player?.restoreStateOnLoad !== false;
      if (!shouldRestore) {
        return;
      }

      const deckA = deckMap.get("deck-a");
      const deckB = deckMap.get("deck-b");
      const mixer = mixerMap.get("mixer");

      if (deckA?.radio?.platformMetadata?.platform === "local-file") {
        resetDeck("deck-a");
      } else if (deckA?.radio) {
        await setDeckARadio(deckA.radio as Radio);
      }
      if (deckB?.radio?.platformMetadata?.platform === "local-file") {
        resetDeck("deck-b");
      } else if (deckB?.radio) {
        await setDeckBRadio(deckB.radio as Radio);
      }

      if (mixer) {
        setMasterVolume(mixer.masterVolume);
        setCrossfadePosition(mixer.crossfadePosition);
      }
    })();
  }, []);
}

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

export function DjPlayer({ radios = [] }: DjPlayerProps) {
  useDjStateHydration();
  useDjKeyboard();
  useMidi();

  const activeDragRadio = useActiveDragRadio();
  const mixer = useMixer();
  const audioSettings = useAudioSettings();

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

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const radio = active.data.current?.radio;
    if (radio) {
      setActiveDragRadio(radio);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragRadio(null);

    if (!over) {
      setPendingPlatformItem(null);
      return;
    }

    const radio = active.data.current?.radio as Radio;
    const deckId = over.id as string;

    const handled = handlePlatformItemDrag({
      radio,
      deckId,
      setPendingItem: setPendingPlatformItem,
    });

    if (handled) {
      return;
    }

    setPendingPlatformItem(null);
    if (deckId === "deck-a") {
      setDeckARadio(radio);
    } else if (deckId === "deck-b") {
      setDeckBRadio(radio);
    }
  };

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
            onDeckACueChange={setDeckACueEnabled}
            onDeckBCueChange={setDeckBCueEnabled}
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
            onDeckACueChange={setDeckACueEnabled}
            onDeckBCueChange={setDeckBCueEnabled}
            onHeadphoneVolumeChange={setHeadphoneVolume}
            onMasterVolumeChange={setMasterVolume}
            radios={radios}
          />
        )}
      </div>

      <DragOverlay style={{ zIndex: 9999, position: "fixed" }}>
        <DjPlayerDragOverlay activeDragRadio={activeDragRadio} />
      </DragOverlay>
    </DndContext>
  );
}
