import type { Radio } from "@avoid.quest/cacophony";
import type { Platform } from "@avoid.quest/radio-shared";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { Button } from "@workspace/ui/components/button";
import { useIsMobile } from "@workspace/ui/hooks/use-mobile";
import { cn } from "@workspace/ui/lib/utils";
import { Volume2Icon } from "lucide-react";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useDjStore } from "@/lib/stores/dj-store";
import type { DeckId } from "@/lib/stores/dj-store/types";

import { RadioLogo } from "../radio-logo";
import { DjDeck } from "./dj-deck";
import { DjMixer } from "./dj-mixer";
import { getPlatformFromItem, isPlatformItem } from "./dj-radio-list";

type DjPlayerProps = {
  radios?: Radio[];
};

type HandlePlatformItemDragParams = {
  radio: Radio;
  deckId: string;
  setPendingPlatformItem: (
    item: { deckId: DeckId; platform: Platform } | null
  ) => void;
};

function handlePlatformItemDrag({
  radio,
  deckId,
  setPendingPlatformItem,
}: HandlePlatformItemDragParams): boolean {
  if (!isPlatformItem(radio)) {
    return false;
  }

  const platform = getPlatformFromItem(radio);
  if (platform && (deckId === "left-deck" || deckId === "right-deck")) {
    setPendingPlatformItem({
      deckId: deckId as "left-deck" | "right-deck",
      platform,
    });
  }
  return true;
}

type DjPlayerMobileViewProps = {
  radios: Radio[];
};

function DjPlayerMobileView({ radios }: DjPlayerMobileViewProps) {
  const [mobileTab, setMobileTab] = useState<"left" | "mixer" | "right">(
    "mixer"
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Mobile Tab Navigation */}
      <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted p-1">
        <Button
          className="w-full"
          onClick={() => setMobileTab("left")}
          size="sm"
          variant={mobileTab === "left" ? "default" : "ghost"}
        >
          Left Deck
        </Button>
        <Button
          className="w-full"
          onClick={() => setMobileTab("mixer")}
          size="sm"
          variant={mobileTab === "mixer" ? "default" : "ghost"}
        >
          Mixer
        </Button>
        <Button
          className="w-full"
          onClick={() => setMobileTab("right")}
          size="sm"
          variant={mobileTab === "right" ? "default" : "ghost"}
        >
          Right Deck
        </Button>
      </div>

      {/* Mobile Content Area */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <div
          className={cn("h-full", mobileTab === "left" ? "block" : "hidden")}
        >
          <DjDeck deckId="left-deck" radios={radios} />
        </div>
        <div
          className={cn("h-full", mobileTab === "mixer" ? "block" : "hidden")}
        >
          <DjMixer radios={radios} />
        </div>
        <div
          className={cn("h-full", mobileTab === "right" ? "block" : "hidden")}
        >
          <DjDeck deckId="right-deck" radios={radios} />
        </div>
      </div>
    </div>
  );
}

type DjPlayerDesktopViewProps = {
  radios: Radio[];
};

function DjPlayerDesktopView({ radios }: DjPlayerDesktopViewProps) {
  return (
    <div className="grid h-full min-h-0 w-full grid-cols-1 gap-4 lg:grid-cols-3 xl:gap-6">
      {/* Left Deck */}
      <DjDeck
        className="order-2 lg:order-1"
        deckId="left-deck"
        radios={radios}
      />

      {/* Center Mixer */}
      <DjMixer className="order-1 lg:order-2" radios={radios} />

      {/* Right Deck */}
      <DjDeck className="order-3" deckId="right-deck" radios={radios} />
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
  const {
    setLeftRadio,
    setRightRadio,
    setPendingPlatformItem,
    setActiveDragRadio,
    activeDragRadio,
  } = useDjStore(
    useShallow((state) => ({
      setLeftRadio: state.setLeftRadio,
      setRightRadio: state.setRightRadio,
      setPendingPlatformItem: state.setPendingPlatformItem,
      setActiveDragRadio: state.setActiveDragRadio,
      activeDragRadio: state.ui.activeDragRadio,
    }))
  );

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
    if (deckId === "left-deck") {
      setLeftRadio(radio);
    } else if (deckId === "right-deck") {
      setRightRadio(radio);
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
      setPendingPlatformItem,
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
        className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col px-4 py-4"
        style={{
          // Ensure drag operations work properly on mobile
          touchAction: "manipulation",
        }}
      >
        {isMobile ? (
          <DjPlayerMobileView radios={radios} />
        ) : (
          <DjPlayerDesktopView radios={radios} />
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
