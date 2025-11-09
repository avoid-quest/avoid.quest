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
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Volume2 } from "lucide-react";
import { useState } from "react";
import { useDjAudio } from "@/lib/audio";
import type { Radio } from "@/lib/types";
import { SettingsButton } from "../../settings/settings-button";
import { RadioLogo } from "../radio-logo";
import { DjDeck } from "./dj-deck";
import { DjMixer } from "./dj-mixer";
import { DjRadioList } from "./dj-radio-list";

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
    leftReverbConfig,
    rightReverbConfig,
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
    updateLeftReverb,
    updateRightReverb,
    playLeft,
    playRight,
    pauseLeft,
    pauseRight,
  } = useDjAudio();

  const [activeRadio, setActiveRadio] = useState<Radio | null>(null);

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

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveRadio(null);

    if (!over) {
      return;
    }

    const radio = active.data.current?.radio as Radio;
    const deckId = over.id as string;

    if (deckId === "left-deck") {
      setLeftRadio(radio);
    } else if (deckId === "right-deck") {
      setRightRadio(radio);
    }
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
  };

  const handleRightClear = () => {
    setRightRadio(null);
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
            leftFilterConfig={leftFilterConfig}
            leftMuted={leftMuted}
            leftReverbConfig={leftReverbConfig}
            leftSoundId={leftRadio ? `left_${leftRadio.id}` : null}
            leftVolume={leftVolume}
            masterVolume={masterVolume}
            onCrossfadeChange={handleCrossfadeChange}
            onLeftFilterChange={updateLeftFilter}
            onLeftMuteChange={setLeftMute}
            onLeftReverbChange={updateLeftReverb}
            onLeftVolumeChange={handleLeftVolumeChange}
            onMasterVolumeChange={setMasterVolume}
            onRightFilterChange={updateRightFilter}
            onRightMuteChange={setRightMute}
            onRightReverbChange={updateRightReverb}
            onRightVolumeChange={handleRightVolumeChange}
            rightFilterConfig={rightFilterConfig}
            rightMuted={rightMuted}
            rightReverbConfig={rightReverbConfig}
            rightSoundId={rightRadio ? `right_${rightRadio.id}` : null}
            rightVolume={rightVolume}
          />

          {/* Right Deck */}
          <DjDeck
            className="order-3"
            deckId="right-deck"
            isLoading={rightIsLoading}
            isPlaying={rightIsPlaying}
            onClear={handleRightClear}
            onPlayPause={handleRightPlayPause}
            onVolumeChange={handleRightVolumeChange}
            radio={rightRadio}
            volume={rightVolume}
          />
        </div>

        {/* Radio List at Bottom - Full Width */}
        <div className="w-full">
          {radios && radios.length > 0 ? (
            <DjRadioList radios={radios} />
          ) : (
            <Card className="w-full">
              <CardHeader className="pb-4">
                <CardTitle className="text-center">Radio Stations</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Volume2 className="mb-4 size-12 text-muted-foreground" />
                  <h3 className="mb-2 font-medium text-lg">
                    No Radio Stations Available
                  </h3>
                  <p className="mb-4 text-muted-foreground text-sm">
                    All radio stations are currently disabled. Please enable
                    some stations in the settings.
                  </p>
                  <SettingsButton />
                </div>
              </CardContent>
            </Card>
          )}
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
