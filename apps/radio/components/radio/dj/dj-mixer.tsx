"use client";

import type { DragEndEvent } from "@dnd-kit/core";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { Card, CardContent } from "@workspace/ui/components/card";
import { Separator } from "@workspace/ui/components/separator";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";
import { cn } from "@workspace/ui/lib/utils";
import { Crossfader } from "@/components/audio/crossfader";
import { EffectChain } from "@/components/audio/effect-chain";
import type { FilterConfig } from "@/components/audio/filter-control";
import type { ReverbConfig } from "@/components/audio/reverb-control";
import { VolumeControl } from "@/components/audio/volume-control";
import type { EffectConfig } from "@/lib/audio/effects/types";

type DjMixerProps = {
  className?: string;
  crossfadePosition: number;
  leftVolume: number;
  rightVolume: number;
  masterVolume: number;
  leftMuted: boolean;
  rightMuted: boolean;
  isTransitioning: boolean;
  error: string | null;
  leftSoundId: string | null;
  rightSoundId: string | null;
  // Legacy support
  leftFilterConfig: FilterConfig;
  rightFilterConfig: FilterConfig;
  leftReverbConfig: ReverbConfig;
  rightReverbConfig: ReverbConfig;
  // New unified effect system
  leftEffects: EffectConfig[];
  rightEffects: EffectConfig[];
  onCrossfadeChange: (position: number) => void;
  onLeftVolumeChange: (volume: number) => void;
  onRightVolumeChange: (volume: number) => void;
  onMasterVolumeChange: (volume: number) => void;
  onLeftMuteChange: (muted: boolean) => void;
  onRightMuteChange: (muted: boolean) => void;
  // Legacy support
  onLeftFilterChange: (config: FilterConfig) => void;
  onRightFilterChange: (config: FilterConfig) => void;
  onLeftReverbChange: (config: ReverbConfig) => void;
  onRightReverbChange: (config: ReverbConfig) => void;
  // New unified effect system
  onAddLeftEffect: (type: string) => void;
  onAddRightEffect: (type: string) => void;
  onUpdateLeftEffect: (effectId: string, config: Partial<EffectConfig>) => void;
  onUpdateRightEffect: (effectId: string, config: Partial<EffectConfig>) => void;
  onRemoveLeftEffect: (effectId: string) => void;
  onRemoveRightEffect: (effectId: string) => void;
  onReorderLeftEffects: (effectIds: string[]) => void;
  onReorderRightEffects: (effectIds: string[]) => void;
};

export function DjMixer({
  className,
  crossfadePosition,
  leftVolume,
  rightVolume,
  masterVolume,
  leftMuted,
  rightMuted,
  isTransitioning,
  error,
  leftSoundId,
  rightSoundId,
  leftFilterConfig,
  rightFilterConfig,
  leftReverbConfig,
  rightReverbConfig,
  leftEffects,
  rightEffects,
  onCrossfadeChange,
  onLeftVolumeChange,
  onRightVolumeChange,
  onMasterVolumeChange,
  onLeftMuteChange,
  onRightMuteChange,
  onLeftFilterChange,
  onRightFilterChange,
  onLeftReverbChange,
  onRightReverbChange,
  onAddLeftEffect,
  onAddRightEffect,
  onUpdateLeftEffect,
  onUpdateRightEffect,
  onRemoveLeftEffect,
  onRemoveRightEffect,
  onReorderLeftEffects,
  onReorderRightEffects,
}: DjMixerProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    // Determine which side based on the active item
    const activeId = active.id as string;
    const isLeft = leftEffects.some((e) => e.id === activeId);

    if (isLeft) {
      const oldIndex = leftEffects.findIndex((e) => e.id === activeId);
      const newIndex = leftEffects.findIndex((e) => e.id === over.id);

      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = arrayMove(leftEffects, oldIndex, newIndex);
        onReorderLeftEffects(newOrder.map((e) => e.id));
      }
    } else {
      const oldIndex = rightEffects.findIndex((e) => e.id === activeId);
      const newIndex = rightEffects.findIndex((e) => e.id === over.id);

      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = arrayMove(rightEffects, oldIndex, newIndex);
        onReorderRightEffects(newOrder.map((e) => e.id));
      }
    }
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <Card className={cn("h-full w-full", className)}>
        <CardContent className="flex h-full flex-col p-0">
          {/* Crossfade Section - Always Visible */}
          <div className="border-b p-4">
            <div className="space-y-4">
              <div className="text-center">
                <div className="font-medium text-lg">Crossfade</div>
              </div>
              <Crossfader
                onPositionChange={onCrossfadeChange}
                position={crossfadePosition}
                size="lg"
              />
            </div>
          </div>

          {/* Tabs Section */}
          <div className="flex-1 p-4">
            <Tabs className="h-full" defaultValue="general">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="general">General</TabsTrigger>
                <TabsTrigger value="effects">Effects</TabsTrigger>
              </TabsList>

              {/* General Tab */}
              <TabsContent className="mt-4 space-y-6" value="general">
                {/* Master Volume */}
                <div className="space-y-3">
                  <div className="font-medium text-sm">Master Volume</div>
                  <VolumeControl
                    onVolumeChange={onMasterVolumeChange}
                    showMute={false}
                    size="md"
                    volume={masterVolume}
                  />
                </div>

                <Separator />

                {/* Deck Volumes */}
                <div className="space-y-4">
                  <div className="space-y-3">
                    <div className="font-medium text-sm">Left Deck Volume</div>
                    <VolumeControl
                      onVolumeChange={(volume) => {
                        if (volume === 0 && !leftMuted) {
                          onLeftMuteChange(true);
                        } else if (volume > 0 && leftMuted) {
                          onLeftMuteChange(false);
                          onLeftVolumeChange(volume);
                        } else if (!leftMuted) {
                          onLeftVolumeChange(volume);
                        }
                      }}
                      showMute={true}
                      size="md"
                      volume={leftMuted ? 0 : leftVolume}
                    />
                  </div>

                  <div className="space-y-3">
                    <div className="font-medium text-sm">Right Deck Volume</div>
                    <VolumeControl
                      onVolumeChange={(volume) => {
                        if (volume === 0 && !rightMuted) {
                          onRightMuteChange(true);
                        } else if (volume > 0 && rightMuted) {
                          onRightMuteChange(false);
                          onRightVolumeChange(volume);
                        } else if (!rightMuted) {
                          onRightVolumeChange(volume);
                        }
                      }}
                      showMute={true}
                      size="md"
                      volume={rightMuted ? 0 : rightVolume}
                    />
                  </div>
                </div>
              </TabsContent>

              {/* Effects Tab */}
              <TabsContent className="mt-4 space-y-4" value="effects">
                <EffectChain
                  effects={leftEffects}
                  isInitialized={!!leftSoundId}
                  onAddEffect={onAddLeftEffect}
                  onUpdateEffect={onUpdateLeftEffect}
                  onRemoveEffect={onRemoveLeftEffect}
                  onReorderEffects={onReorderLeftEffects}
                  title="Left Deck Effects"
                />
                <EffectChain
                  effects={rightEffects}
                  isInitialized={!!rightSoundId}
                  onAddEffect={onAddRightEffect}
                  onUpdateEffect={onUpdateRightEffect}
                  onRemoveEffect={onRemoveRightEffect}
                  onReorderEffects={onReorderRightEffects}
                  title="Right Deck Effects"
                />
              </TabsContent>
            </Tabs>
          </div>

          {/* Status Indicators */}
          {error && (
            <div className="border-t p-4">
              <div className="rounded-md bg-destructive/10 p-3 text-center">
                <div className="font-medium text-destructive text-sm">Error</div>
                <div className="text-destructive text-xs">{error}</div>
              </div>
            </div>
          )}

          {isTransitioning && (
            <div className="border-t p-4">
              <div className="rounded-md bg-primary/10 p-3 text-center">
                <div className="font-medium text-primary text-sm">
                  Transitioning...
                </div>
                <div className="text-primary text-xs">
                  Crossfading between decks
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </DndContext>
  );
}
