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
import { useCallback, useEffect, useRef, useState } from "react";
import { useDjAudio } from "@/lib/audio";
import type { Platform } from "@/lib/external-url/types";
import type { Radio } from "@/lib/types";

// Regex pattern for extracting URLs from proxy URLs
const PROXY_URL_PATTERN = /url=([^&]+)/;

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

  // Track previous playing states to detect when tracks end
  const prevLeftIsPlayingRef = useRef(leftIsPlaying);
  const prevRightIsPlayingRef = useRef(rightIsPlaying);
  // Track if user manually paused to prevent autoplay
  const leftManuallyPausedRef = useRef(false);
  const rightManuallyPausedRef = useRef(false);

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
        leftManuallyPausedRef.current = true;
        pauseLeft();
      } else {
        leftManuallyPausedRef.current = false;
        playLeft();
      }
    }
  };

  const handleRightPlayPause = () => {
    if (rightRadio) {
      if (rightIsPlaying) {
        rightManuallyPausedRef.current = true;
        pauseRight();
      } else {
        rightManuallyPausedRef.current = false;
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

  const handleLeftLoadTrack = async (streamUrl: string) => {
    if (leftRadio) {
      const wasPlaying = leftIsPlaying;
      // Pause current track if playing
      if (wasPlaying) {
        pauseLeft();
      }
      // Update radio with new streamUrl and reload sound
      const updatedRadio = {
        ...leftRadio,
        streamUrl,
      };
      await setLeftRadio(updatedRadio);
      // Resume playback if it was playing
      if (wasPlaying) {
        playLeft();
      }
    }
  };

  const handleRightLoadTrack = async (streamUrl: string) => {
    if (rightRadio) {
      const wasPlaying = rightIsPlaying;
      // Pause current track if playing
      if (wasPlaying) {
        pauseRight();
      }
      // Update radio with new streamUrl and reload sound
      const updatedRadio = {
        ...rightRadio,
        streamUrl,
      };
      await setRightRadio(updatedRadio);
      // Resume playback if it was playing
      if (wasPlaying) {
        playRight();
      }
    }
  };

  // Store handler refs for autoplay
  const handleLeftLoadTrackRef = useRef(handleLeftLoadTrack);
  const handleRightLoadTrackRef = useRef(handleRightLoadTrack);

  // Keep refs up to date on every render
  handleLeftLoadTrackRef.current = handleLeftLoadTrack;
  handleRightLoadTrackRef.current = handleRightLoadTrack;

  // Helper function to get tracks from metadata
  const getTracksFromMetadata = useCallback(
    (
      metadata: Radio["platformMetadata"]
    ): Array<{ streamUrl: string }> | null => {
      if (!metadata) {
        return null;
      }
      if (metadata.platform === "bandcamp" && metadata.itemType === "album") {
        return metadata.tracks || null;
      }
      if (
        metadata.platform === "soundcloud" &&
        metadata.itemType === "playlist"
      ) {
        return metadata.tracks || null;
      }
      return null;
    },
    []
  );

  // Helper to normalize URLs for comparison (handles proxy URLs)
  const normalizeUrl = useCallback((url: string): string => {
    // Extract the actual URL from proxy URLs
    if (url.includes("/api/bandcamp-proxy?url=")) {
      const match = url.match(PROXY_URL_PATTERN);
      if (match?.[1]) {
        return decodeURIComponent(match[1]);
      }
    }
    return url;
  }, []);

  // Helper function to find next track in playlist
  const findNextTrack = useCallback(
    (radio: Radio | null): { streamUrl: string } | null => {
      if (!radio?.platformMetadata) {
        return null;
      }

      const tracks = getTracksFromMetadata(radio.platformMetadata);
      if (!tracks || tracks.length === 0) {
        return null;
      }

      const currentStreamUrl = normalizeUrl(radio.streamUrl);
      const currentIndex = tracks.findIndex(
        (track) => normalizeUrl(track.streamUrl) === currentStreamUrl
      );

      if (currentIndex === -1 || currentIndex + 1 >= tracks.length) {
        return null;
      }

      return tracks[currentIndex + 1] || null;
    },
    [getTracksFromMetadata, normalizeUrl]
  );

  // Autoplay next track when current track ends (left deck)
  useEffect(() => {
    const wasPlaying = prevLeftIsPlayingRef.current;
    const trackEnded =
      wasPlaying && !leftIsPlaying && !leftManuallyPausedRef.current;

    if (leftIsPlaying) {
      leftManuallyPausedRef.current = false;
    }

    if (trackEnded) {
      leftManuallyPausedRef.current = false;
      const nextTrack = findNextTrack(leftRadio);
      if (nextTrack) {
        handleLeftLoadTrackRef.current(nextTrack.streamUrl).then(() => {
          playLeft();
        });
      }
    }

    prevLeftIsPlayingRef.current = leftIsPlaying;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftIsPlaying, leftRadio, findNextTrack, playLeft]);

  // Autoplay next track when current track ends (right deck)
  useEffect(() => {
    const wasPlaying = prevRightIsPlayingRef.current;
    const trackEnded =
      wasPlaying && !rightIsPlaying && !rightManuallyPausedRef.current;

    if (rightIsPlaying) {
      rightManuallyPausedRef.current = false;
    }

    if (trackEnded) {
      rightManuallyPausedRef.current = false;
      const nextTrack = findNextTrack(rightRadio);
      if (nextTrack) {
        handleRightLoadTrackRef.current(nextTrack.streamUrl).then(() => {
          playRight();
        });
      }
    }

    prevRightIsPlayingRef.current = rightIsPlaying;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rightIsPlaying, rightRadio, findNextTrack, playRight]);

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
            onLoadTrack={handleLeftLoadTrack}
            onPlayPause={handleLeftPlayPause}
            onVolumeChange={handleLeftVolumeChange}
            pendingPlatform={
              pendingPlatformItem?.deckId === "left-deck"
                ? pendingPlatformItem.platform
                : undefined
            }
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
            onLoadTrack={handleRightLoadTrack}
            onPlayPause={handleRightPlayPause}
            onVolumeChange={handleRightVolumeChange}
            pendingPlatform={
              pendingPlatformItem?.deckId === "right-deck"
                ? pendingPlatformItem.platform
                : undefined
            }
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
