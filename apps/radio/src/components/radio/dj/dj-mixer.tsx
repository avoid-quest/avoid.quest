import { Card, CardContent } from "@workspace/ui/components/card";
import { Separator } from "@workspace/ui/components/separator";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";
import { cn } from "@workspace/ui/lib/utils";
import { useShallow } from "zustand/react/shallow";
import { Crossfader } from "@/components/audio/crossfader";
import { EffectChain } from "@/components/audio/effect-chain";
import { VolumeControl } from "@/components/audio/volume-control";
import { useDjStore } from "@/lib/stores/dj-store";

type DjMixerProps = {
  className?: string;
};

export function DjMixer({ className }: DjMixerProps) {
  const {
    crossfadePosition,
    masterVolume,
    leftVolume,
    rightVolume,
    leftMuted,
    rightMuted,
    error,
    leftEffects,
    rightEffects,
    setCrossfadePosition,
    setMasterVolume,
    setLeftVolume,
    setRightVolume,
    setLeftMute,
    setRightMute,
    addLeftEffect,
    addRightEffect,
    updateLeftEffect,
    updateRightEffect,
    removeLeftEffect,
    removeRightEffect,
    reorderLeftEffects,
    reorderRightEffects,
  } = useDjStore(
    useShallow((state) => ({
      crossfadePosition: state.mixer.crossfadePosition,
      masterVolume: state.mixer.masterVolume,
      leftVolume: state.leftDeck.volume,
      rightVolume: state.rightDeck.volume,
      leftMuted: state.leftDeck.muted,
      rightMuted: state.rightDeck.muted,
      error: state.error,
      leftEffects: state.leftDeck.effects,
      rightEffects: state.rightDeck.effects,
      setCrossfadePosition: state.setCrossfadePosition,
      setMasterVolume: state.setMasterVolume,
      setLeftVolume: state.setLeftVolume,
      setRightVolume: state.setRightVolume,
      setLeftMute: state.setLeftMute,
      setRightMute: state.setRightMute,
      addLeftEffect: state.addLeftEffect,
      addRightEffect: state.addRightEffect,
      updateLeftEffect: state.updateLeftEffect,
      updateRightEffect: state.updateRightEffect,
      removeLeftEffect: state.removeLeftEffect,
      removeRightEffect: state.removeRightEffect,
      reorderLeftEffects: state.reorderLeftEffects,
      reorderRightEffects: state.reorderRightEffects,
    }))
  );

  const handleLeftVolumeChange = (volume: number) => {
    if (volume === 0 && !leftMuted) {
      setLeftMute(true);
    } else if (volume > 0 && leftMuted) {
      setLeftMute(false);
      setLeftVolume(volume);
    } else if (!leftMuted) {
      setLeftVolume(volume);
    }
  };

  const handleRightVolumeChange = (volume: number) => {
    if (volume === 0 && !rightMuted) {
      setRightMute(true);
    } else if (volume > 0 && rightMuted) {
      setRightMute(false);
      setRightVolume(volume);
    } else if (!rightMuted) {
      setRightVolume(volume);
    }
  };

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
              onPositionChange={setCrossfadePosition}
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
                  onVolumeChange={setMasterVolume}
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
                    onVolumeChange={handleLeftVolumeChange}
                    showMute={true}
                    size="md"
                    volume={leftMuted ? 0 : leftVolume}
                  />
                </div>

                <div className="space-y-3">
                  <div className="font-medium text-sm">Right Deck Volume</div>
                  <VolumeControl
                    onVolumeChange={handleRightVolumeChange}
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
                onAddEffect={addLeftEffect}
                onRemoveEffect={removeLeftEffect}
                onReorderEffects={reorderLeftEffects}
                onUpdateEffect={updateLeftEffect}
                title="Left Deck Effects"
              />
              <EffectChain
                effects={rightEffects}
                onAddEffect={addRightEffect}
                onRemoveEffect={removeRightEffect}
                onReorderEffects={reorderRightEffects}
                onUpdateEffect={updateRightEffect}
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
      </CardContent>
    </Card>
  );
}
