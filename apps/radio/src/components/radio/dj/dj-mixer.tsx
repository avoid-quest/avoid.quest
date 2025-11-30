import { Card, CardContent } from "@workspace/ui/components/card";
import { useIsMobile } from "@workspace/ui/hooks/use-mobile";
import { cn } from "@workspace/ui/lib/utils";
import { useShallow } from "zustand/react/shallow";
import { Crossfader } from "@/components/audio/crossfader";
import { VolumeControl } from "@/components/audio/volume-control";
import { useDjStore } from "@/lib/stores/dj-store";
import type { Radio } from "@/lib/types";
import { DjRadioList } from "./dj-radio-list";

type DjMixerProps = {
  className?: string;
  radios?: Radio[];
};

export function DjMixer({ className, radios = [] }: DjMixerProps) {
  const {
    crossfadePosition,
    masterVolume,
    error,
    setCrossfadePosition,
    setMasterVolume,
  } = useDjStore(
    useShallow((state) => ({
      crossfadePosition: state.mixer.crossfadePosition,
      masterVolume: state.mixer.masterVolume,
      error: state.error,
      setCrossfadePosition: state.setCrossfadePosition,
      setMasterVolume: state.setMasterVolume,
    }))
  );

  const isMobile = useIsMobile();

  return (
    <Card className={cn("flex h-full min-h-0 w-full flex-col", className)}>
      <CardContent className="flex h-full min-h-0 flex-col p-0">
        {/* Crossfade Section - Always Visible */}
        <div className="border-b p-4">
          <Crossfader
            onPositionChange={setCrossfadePosition}
            position={crossfadePosition}
            size="lg"
          />
        </div>

        {/* Master Volume Section */}
        <div className="border-b p-4">
          <div className="space-y-3">
            <div className="font-medium text-sm">Master Volume</div>
            <VolumeControl
              onVolumeChange={setMasterVolume}
              showMute={false}
              size="md"
              volume={masterVolume}
            />
          </div>
        </div>

        {/* Radio List Section - Hidden on mobile */}
        {!isMobile && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
            <DjRadioList radios={radios} />
          </div>
        )}

        {/* Status Indicators */}
        {!!error?.trim() && (
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
