"use client";

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
import { useState } from "react";
import { useDjAudio } from "@/lib/audio";
import type { Radio } from "@/lib/types";
import { RadioLogo } from "../radio-logo";
import { DjDeck } from "./dj-deck";
import { DjMixer } from "./dj-mixer";
import {
  DjRadioList,
  getPlatformFromItem,
  isPlatformItem,
} from "./dj-radio-list";
import type { Platform } from "@/lib/external-url/types";

type DjPlayerProps = {
  radios?: Radio[];
};

export function DjPlayer({ radios = [] }: DjPlayerProps) {
  const {
    leftRadio,
    rightRadio,
    crossfadePosition,
    leftVolume,
    rightVolume,
    leftIsPlaying,
    rightIsPlaying,
    leftIsLoading,
    rightIsLoading,
    error,
    masterVolume,
    leftMuted,
    rightMuted,
    leftFilterConfig,
    rightFilterConfig,
    leftEffects,
    rightEffects,
    leftSoundId,
    rightSoundId,
    setLeftRadio,
    setRightRadio,
    setCrossfadePosition,
    setLeftVolume,
    setRightVolume,
    setMasterVolume,
    setLeftMute,
    setRightMute,
    updateLeftFilter,
    updateRightFilter,
    addLeftEffect,
    addRightEffect,
    updateLeftEffect,
    updateRightEffect,
    removeLeftEffect,
    removeRightEffect,
    reorderLeftEffects,
    reorderRightEffects,
    playLeft,
    playRight,
    pauseLeft,
    pauseRight,
  } = useDjAudio();

  const [activeRadio, setActiveRadio] = useState<Radio | null>(null);
  const [pendingPlatformItem, setPendingPlatformItem] = useState<{
    deckId: "left-deck" | "right-deck";
    platform: Platform;
  } | null>(null);

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
      setActiveRadio(radio);
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
    setActiveRadio(null);

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

  const handleLeftPlatformItemLoad = (radio: Radio) => {
    setLeftRadio(radio);
    setPendingPlatformItem(null);
  };

  const handleRightPlatformItemLoad = (radio: Radio) => {
    setRightRadio(radio);
    setPendingPlatformItem(null);
  };

  const handleLeftPlayPause = () => {
    if (leftRadio) {
      if (leftIsPlaying) {
        pauseLeft();
      } else {
        playLeft();
      }
    }
  };

  const handleRightPlayPause = () => {
    if (rightRadio) {
      if (rightIsPlaying) {
        pauseRight();
      } else {
        playRight();
      }
    }
  };

  const handleLeftVolumeChange = (volume: number) => {
    setLeftVolume(volume);
  };

  const handleRightVolumeChange = (volume: number) => {
    setRightVolume(volume);
  };

  const handleCrossfadeChange = (position: number) => {
    setCrossfadePosition(position);
  };

  const handleLeftClear = () => {
    setLeftRadio(null);
    // Clear pending platform item if it was for left deck
    if (pendingPlatformItem?.deckId === "left-deck") {
      setPendingPlatformItem(null);
    }
  };

  const handleRightClear = () => {
    setRightRadio(null);
    // Clear pending platform item if it was for right deck
    if (pendingPlatformItem?.deckId === "right-deck") {
      setPendingPlatformItem(null);
    }
  };

  const handleLeftLoadTrack = (streamUrl: string) => {
    if (leftRadio) {
      setLeftRadio({
        ...leftRadio,
        streamUrl,
      });
    }
  };

  const handleRightLoadTrack = (streamUrl: string) => {
    if (rightRadio) {
      setRightRadio({
        ...rightRadio,
        streamUrl,
      });
    }
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
          <DjDeck
            className="order-2 lg:order-1"
            deckId="left-deck"
            isLoading={leftIsLoading}
            isPlaying={leftIsPlaying}
            onClear={handleLeftClear}
            onLoadPlatformItem={
              pendingPlatformItem?.deckId === "left-deck"
                ? handleLeftPlatformItemLoad
                : undefined
            }
            pendingPlatform={pendingPlatformItem?.deckId === "left-deck" ? pendingPlatformItem.platform : undefined}
            onLoadTrack={handleLeftLoadTrack}
            onPlayPause={handleLeftPlayPause}
            onVolumeChange={handleLeftVolumeChange}
            radio={leftRadio}
            volume={leftVolume}
          />

          {/* Center Mixer */}
          <DjMixer
            className="order-1 lg:order-2"
            crossfadePosition={crossfadePosition}
            error={error}
            isTransitioning={false}
            leftEffects={leftEffects}
            leftFilterConfig={leftFilterConfig}
            leftMuted={leftMuted}
            leftSoundId={leftSoundId}
            leftVolume={leftVolume}
            masterVolume={masterVolume}
            onAddLeftEffect={addLeftEffect}
            onAddRightEffect={addRightEffect}
            onCrossfadeChange={handleCrossfadeChange}
            onLeftFilterChange={updateLeftFilter}
            onLeftMuteChange={setLeftMute}
            onLeftVolumeChange={handleLeftVolumeChange}
            onMasterVolumeChange={setMasterVolume}
            onRemoveLeftEffect={removeLeftEffect}
            onRemoveRightEffect={removeRightEffect}
            onReorderLeftEffects={reorderLeftEffects}
            onReorderRightEffects={reorderRightEffects}
            onRightFilterChange={updateRightFilter}
            onRightMuteChange={setRightMute}
            onRightVolumeChange={handleRightVolumeChange}
            onUpdateLeftEffect={updateLeftEffect}
            onUpdateRightEffect={updateRightEffect}
            rightEffects={rightEffects}
            rightFilterConfig={rightFilterConfig}
            rightMuted={rightMuted}
            rightSoundId={rightSoundId}
            rightVolume={rightVolume}
          />

          {/* Right Deck */}
          <DjDeck
            className="order-3"
            deckId="right-deck"
            isLoading={rightIsLoading}
            isPlaying={rightIsPlaying}
            onClear={handleRightClear}
            onLoadPlatformItem={
              pendingPlatformItem?.deckId === "right-deck"
                ? handleRightPlatformItemLoad
                : undefined
            }
            pendingPlatform={pendingPlatformItem?.deckId === "right-deck" ? pendingPlatformItem.platform : undefined}
            onLoadTrack={handleRightLoadTrack}
            onPlayPause={handleRightPlayPause}
            onVolumeChange={handleRightVolumeChange}
            radio={rightRadio}
            volume={rightVolume}
          />
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
        {activeRadio ? (
          <div className="rounded-lg border bg-background p-4 shadow-lg">
            <div className="flex items-center gap-3">
              <RadioLogo
                fallbackIcon={
                  <Volume2 className="size-4 text-muted-foreground" />
                }
                logoUrl={activeRadio.logoUrl}
                name={activeRadio.name}
                size="lg"
              />
              <div>
                <div className="font-medium">{activeRadio.name}</div>
                {activeRadio.description && (
                  <div className="text-muted-foreground text-sm">
                    {activeRadio.description}
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
