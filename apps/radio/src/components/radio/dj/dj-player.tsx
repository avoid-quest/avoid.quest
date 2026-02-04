import { Button } from "@avoid.quest/ui/components/button";
import { useIsMobile } from "@avoid.quest/ui/hooks/use-mobile";
import { cn } from "@avoid.quest/ui/lib/utils";
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
import { useEffect, useRef, useState } from "react";
import type { Radio } from "@/lib/audio";
import {
  deckCollection,
  mixerCollection,
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
import { useAudioSettings } from "@/lib/hooks/use-settings";
import type { Platform } from "@/lib/platform-types";
import {
  type DeckId,
  useDeckAPeakLevel,
  useDeckBPeakLevel,
} from "@/lib/stores/dj-runtime-store";

import { RadioLogo } from "../radio-logo";
import { DjDeck } from "./dj-deck";
import { DjMixer } from "./dj-mixer";
import { DjRadioBrowser } from "./dj-radio-browser";
import {
  getPlatformFromItem,
  isAudioInputItem,
  isPlatformItem,
} from "./dj-radio-list";
import { MiniMixerBar } from "./mini-mixer-bar";

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
  if (!isPlatformItem(radio)) {
    return false;
  }

  const platform = getPlatformFromItem(radio);
  if (platform && (deckId === "deck-a" || deckId === "deck-b")) {
    setPendingItem({
      deckId: deckId as "deck-a" | "deck-b",
      platform,
    });
  }
  return true;
}

// Conditional hydration hook for DJ state
function useDjStateHydration() {
  const hasHydratedRef = useRef(false);

  // Note: Cleanup on mode change is handled by mode-select.tsx which awaits cleanupAudioOnly()
  // We don't cleanup on unmount here because on page refresh the audio stops naturally,
  // and running cleanup could interfere with state persistence timing.

  useEffect(() => {
    if (hasHydratedRef.current) {
      return;
    }
    hasHydratedRef.current = true;

    // Async IIFE - wait for all collections to load from localStorage, then restore state
    (async () => {
      // Wait for all collections to complete initial sync from localStorage
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

      // Re-init audio for decks that have radios (audio needs component context)
      // This also applies channel strip settings (pan, speed, filter, etc.)
      if (deckA?.radio) {
        await setDeckARadio(deckA.radio as Radio);
      }
      if (deckB?.radio) {
        await setDeckBRadio(deckB.radio as Radio);
      }

      // Apply mixer settings to audio engine
      if (mixer) {
        setMasterVolume(mixer.masterVolume);
        setCrossfadePosition(mixer.crossfadePosition);
      }
    })();
  }, []);
}

type DjPlayerMobileViewProps = {
  radios: Radio[];
  crossfadePosition: number;
  masterVolume: number;
  deckACueEnabled: boolean;
  deckBCueEnabled: boolean;
  isCueActive: boolean;
};

function DjPlayerMobileView({
  radios,
  crossfadePosition,
  masterVolume,
  deckACueEnabled,
  deckBCueEnabled,
  isCueActive,
}: DjPlayerMobileViewProps) {
  const [mobileTab, setMobileTab] = useState<"left" | "right">("left");
  const deckAPeakLevel = useDeckAPeakLevel();
  const deckBPeakLevel = useDeckBPeakLevel();

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* Mini Mixer Bar — always visible */}
      <MiniMixerBar
        crossfadePosition={crossfadePosition}
        deckACueEnabled={deckACueEnabled}
        deckAPeakLevel={deckAPeakLevel}
        deckBCueEnabled={deckBCueEnabled}
        deckBPeakLevel={deckBPeakLevel}
        isCueActive={isCueActive}
        masterVolume={masterVolume}
        onCrossfadeChange={setCrossfadePosition}
        onDeckACueChange={setDeckACueEnabled}
        onDeckBCueChange={setDeckBCueEnabled}
        onMasterVolumeChange={setMasterVolume}
      />

      {/* 2-Tab Navigation */}
      <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-1">
        <Button
          className={cn("w-full", mobileTab === "left" && "text-blue-500")}
          onClick={() => setMobileTab("left")}
          size="sm"
          variant={mobileTab === "left" ? "default" : "ghost"}
        >
          Deck A
        </Button>
        <Button
          className={cn("w-full", mobileTab === "right" && "text-amber-500")}
          onClick={() => setMobileTab("right")}
          size="sm"
          variant={mobileTab === "right" ? "default" : "ghost"}
        >
          Deck B
        </Button>
      </div>

      {/* Deck Content Area */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <div
          className={cn("h-full", mobileTab === "left" ? "block" : "hidden")}
        >
          <DjDeck deckId="deck-a" radios={radios} />
        </div>
        <div
          className={cn("h-full", mobileTab === "right" ? "block" : "hidden")}
        >
          <DjDeck deckId="deck-b" radios={radios} />
        </div>
      </div>
    </div>
  );
}

type DjPlayerDesktopViewProps = {
  radios: Radio[];
  crossfadePosition: number;
  masterVolume: number;
  headphoneVolume: number;
  deckACueEnabled: boolean;
  deckBCueEnabled: boolean;
  isCueActive: boolean;
};

function DjPlayerDesktopView({
  radios,
  crossfadePosition,
  masterVolume,
  headphoneVolume,
  deckACueEnabled,
  deckBCueEnabled,
  isCueActive,
}: DjPlayerDesktopViewProps) {
  return (
    <div className="grid h-full min-h-0 w-full grid-rows-[1fr_auto] gap-2">
      {/* Row 1: Decks + Mixer */}
      <div className="grid min-h-0 grid-cols-1 gap-2 lg:grid-cols-[1fr_24rem_1fr]">
        {/* Deck A */}
        <DjDeck
          className="order-2 lg:order-1"
          deckId="deck-a"
          radios={radios}
        />

        {/* Center Mixer */}
        <DjMixer
          className="order-1 lg:order-2"
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
        />

        {/* Deck B */}
        <DjDeck className="order-3" deckId="deck-b" radios={radios} />
      </div>

      {/* Row 2: Radio Browser */}
      <DjRadioBrowser radios={radios} />
    </div>
  );
}

type DjPlayerDragOverlayProps = {
  activeDragRadio: Radio | null;
};

function DjPlayerDragOverlay({ activeDragRadio }: DjPlayerDragOverlayProps) {
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
  // Conditionally hydrate the DJ state based on user settings
  useDjStateHydration();

  // Enable keyboard shortcuts for DJ mode (Q=Deck A CUE, W=Deck B CUE)
  useDjKeyboard();

  // Get UI state from the runtime store
  const activeDragRadio = useActiveDragRadio();
  const mixer = useMixer();
  const audioSettings = useAudioSettings();

  const crossfadePosition = mixer?.crossfadePosition ?? 0.5;
  const masterVolume = mixer?.masterVolume ?? 1;
  const headphoneVolume = mixer?.headphoneVolume ?? 1;
  const deckACueEnabled = mixer?.deckACueEnabled ?? false;
  const deckBCueEnabled = mixer?.deckBCueEnabled ?? false;
  const isCueActive = !!audioSettings.cueOutputId;

  // Configure sensors for both mouse and touch interactions
  // Enhanced mobile support with better touch handling
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 50, // Reduced delay for better responsiveness
        tolerance: 5, // Reduced tolerance for more precise touch handling
      },
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const radio = active.data.current?.radio;
    if (radio) {
      setActiveDragRadio(radio);
    }
  };

  const handleRegularRadioDrag = (radio: Radio, deckId: string): void => {
    if (deckId === "deck-a") {
      setDeckARadio(radio);
    } else if (deckId === "deck-b") {
      setDeckBRadio(radio);
    }
  };

  const handleAudioInputDrag = (deckId: string): boolean => {
    if (deckId === "deck-a" || deckId === "deck-b") {
      setPendingPlatformItem({
        deckId: deckId as "deck-a" | "deck-b",
        platform: "device-input",
      });
      return true;
    }
    return false;
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

    // Check if it's an audio input item first
    if (isAudioInputItem(radio)) {
      handleAudioInputDrag(deckId);
      return;
    }

    const handled = handlePlatformItemDrag({
      radio,
      deckId,
      setPendingItem: setPendingPlatformItem,
    });

    if (handled) {
      return;
    }

    setPendingPlatformItem(null);
    handleRegularRadioDrag(radio, deckId);
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
        style={{
          // Ensure drag operations work properly on mobile
          touchAction: "manipulation",
        }}
      >
        {isMobile ? (
          <DjPlayerMobileView
            crossfadePosition={crossfadePosition}
            deckACueEnabled={deckACueEnabled}
            deckBCueEnabled={deckBCueEnabled}
            isCueActive={isCueActive}
            masterVolume={masterVolume}
            radios={radios}
          />
        ) : (
          <DjPlayerDesktopView
            crossfadePosition={crossfadePosition}
            deckACueEnabled={deckACueEnabled}
            deckBCueEnabled={deckBCueEnabled}
            headphoneVolume={headphoneVolume}
            isCueActive={isCueActive}
            masterVolume={masterVolume}
            radios={radios}
          />
        )}
      </div>

      {/* Drag Overlay */}
      <DragOverlay
        style={{
          // Ensure drag overlay can escape scroll containers on mobile
          zIndex: 9999,
          position: "fixed",
        }}
      >
        <DjPlayerDragOverlay activeDragRadio={activeDragRadio} />
      </DragOverlay>
    </DndContext>
  );
}
