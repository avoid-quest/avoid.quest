import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { Volume2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useDjStore } from "@/lib/stores/dj-store";
import type { Radio } from "@/lib/types";

import { RadioLogo } from "../radio-logo";
import { DjDeck } from "./dj-deck";
import { DjMixer } from "./dj-mixer";
import {
  DjRadioList,
  getPlatformFromItem,
  isPlatformItem,
} from "./dj-radio-list";

type DjPlayerProps = {
  radios?: Radio[];
};

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

    // Handle platform items - show form for the specific platform
    if (isPlatformItem(radio)) {
      const platform = getPlatformFromItem(radio);
      if (platform && (deckId === "left-deck" || deckId === "right-deck")) {
        setPendingPlatformItem({
          deckId: deckId as "left-deck" | "right-deck",
          platform,
        });
      }
      return;
    }

    // Clear pending platform item when dragging regular radio
    setPendingPlatformItem(null);
    handleRegularRadioDrag(radio, deckId);
  };

  return (
    <DndContext
      onDragEnd={handleDragEnd}
      onDragStart={handleDragStart}
      sensors={sensors}
    >
      <div
        className="mx-auto flex h-full w-full max-w-7xl flex-col space-y-4"
        style={{
          // Ensure drag operations work properly on mobile
          touchAction: "manipulation",
        }}
      >
        {/* Main DJ Interface */}
        <div className="grid w-full flex-1 grid-cols-1 gap-4 lg:grid-cols-3 xl:gap-6">
          {/* Left Deck */}
          <DjDeck className="order-2 lg:order-1" deckId="left-deck" />

          {/* Center Mixer */}
          <DjMixer className="order-1 lg:order-2" />

          {/* Right Deck */}
          <DjDeck className="order-3" deckId="right-deck" />
        </div>

        {/* Radio List at Bottom - Full Width */}
        <div className="w-full">
          <DjRadioList radios={radios || []} />
        </div>
      </div>

      {/* Drag Overlay */}
      <DragOverlay
        style={{
          // Ensure drag overlay can escape scroll containers on mobile
          zIndex: 9999,
          position: "fixed",
        }}
      >
        {activeDragRadio ? (
          <div className="rounded-lg border bg-background p-4 shadow-lg">
            <div className="flex items-center gap-3">
              <RadioLogo
                fallbackIcon={
                  <Volume2 className="size-4 text-muted-foreground" />
                }
                logoUrl={activeDragRadio.logoUrl}
                name={activeDragRadio.name}
                size="lg"
              />
              <div>
                <div className="font-medium">{activeDragRadio.name}</div>
                {activeDragRadio.description && (
                  <div className="text-muted-foreground text-sm">
                    {activeDragRadio.description}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
