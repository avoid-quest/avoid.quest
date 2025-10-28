"use client";

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
import type { FilterConfig } from "@/components/audio/filter-control";
import { FilterControl } from "@/components/audio/filter-control";
import { VolumeControl } from "@/components/audio/volume-control";

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
  leftFilterConfig: FilterConfig;
  rightFilterConfig: FilterConfig;
  onCrossfadeChange: (position: number) => void;
  onLeftVolumeChange: (volume: number) => void;
  onRightVolumeChange: (volume: number) => void;
  onMasterVolumeChange: (volume: number) => void;
  onLeftMuteChange: (muted: boolean) => void;
  onRightMuteChange: (muted: boolean) => void;
  onLeftFilterChange: (config: FilterConfig) => void;
  onRightFilterChange: (config: FilterConfig) => void;
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
  onCrossfadeChange,
  onLeftVolumeChange,
  onRightVolumeChange,
  onMasterVolumeChange,
  onLeftMuteChange,
  onRightMuteChange,
  onLeftFilterChange,
  onRightFilterChange,
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
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="filters">Filters</TabsTrigger>
              <TabsTrigger value="fx">FX</TabsTrigger>
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

            {/* Filters Tab */}
            <TabsContent className="mt-4" value="filters">
              <div className="flex flex-col gap-2">
                <FilterControl
                  initialConfig={leftFilterConfig}
                  onFilterChange={onLeftFilterChange}
                  soundId={leftSoundId}
                  title="Left Deck Filter"
                />
                <FilterControl
                  initialConfig={rightFilterConfig}
                  onFilterChange={onRightFilterChange}
                  soundId={rightSoundId}
                  title="Right Deck Filter"
                />
              </div>
            </TabsContent>

            {/* FX Tab */}
            <TabsContent className="mt-4" value="fx">
              <div className="flex h-32 items-center justify-center rounded-lg border-2 border-muted-foreground/25 border-dashed">
                <div className="text-center">
                  <div className="font-medium text-lg text-muted-foreground">
                    Coming Soon
                  </div>
                  <div className="text-muted-foreground text-sm">
                    Advanced effects will be available here
                  </div>
                </div>
              </div>
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
