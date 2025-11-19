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
  // Unified effect system
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
  // Unified effect system
  onAddLeftEffect: (type: string) => void;
  onAddRightEffect: (type: string) => void;
  onUpdateLeftEffect: (effectId: string, config: Partial<EffectConfig>) => void;
  onUpdateRightEffect: (
    effectId: string,
    config: Partial<EffectConfig>
  ) => void;
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
  leftEffects,
  rightEffects,
  onCrossfadeChange,
  onLeftVolumeChange,
  onRightVolumeChange,
  onMasterVolumeChange,
  onLeftMuteChange,
  onRightMuteChange,
  onAddLeftEffect,
  onAddRightEffect,
  onUpdateLeftEffect,
  onUpdateRightEffect,
  onRemoveLeftEffect,
  onRemoveRightEffect,
  onReorderLeftEffects,
  onReorderRightEffects,
}: DjMixerProps) {
  return (
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
                onRemoveEffect={onRemoveLeftEffect}
                onReorderEffects={onReorderLeftEffects}
                onUpdateEffect={onUpdateLeftEffect}
                title="Left Deck Effects"
              />
              <EffectChain
                effects={rightEffects}
                isInitialized={!!rightSoundId}
                onAddEffect={onAddRightEffect}
                onRemoveEffect={onRemoveRightEffect}
                onReorderEffects={onReorderRightEffects}
                onUpdateEffect={onUpdateRightEffect}
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
  );
}
