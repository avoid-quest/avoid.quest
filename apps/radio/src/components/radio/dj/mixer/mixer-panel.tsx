import { cn } from "@avoid.quest/ui/lib/utils";
import { useDjError } from "@/lib/hooks/use-dj-state";
import { MixerCrossfader } from "./mixer-crossfader";
import { MixerCue } from "./mixer-cue";
import { MixerMaster } from "./mixer-master";
import { MixerRouting } from "./mixer-routing";

type MixerPanelProps = {
  className?: string;
  crossfadePosition: number;
  masterVolume: number;
  headphoneVolume: number;
  isCueActive: boolean;
  deckACueEnabled: boolean;
  deckBCueEnabled: boolean;
  onCrossfadeChange: (position: number) => void;
  onMasterVolumeChange: (volume: number) => void;
  onHeadphoneVolumeChange: (volume: number) => void;
  onDeckACueChange: (enabled: boolean) => void;
  onDeckBCueChange: (enabled: boolean) => void;
};

export function MixerPanel({
  className,
  crossfadePosition,
  masterVolume,
  headphoneVolume,
  isCueActive,
  deckACueEnabled,
  deckBCueEnabled,
  onCrossfadeChange,
  onMasterVolumeChange,
  onHeadphoneVolumeChange,
  onDeckACueChange,
  onDeckBCueChange,
}: MixerPanelProps) {
  const error = useDjError();

  return (
    <div
      className={cn(
        "flex h-full min-h-0 w-full flex-col gap-4 border-border/50 border-x p-3",
        className
      )}
    >
      {/* Master VU + Volume */}
      <MixerMaster
        headphoneVolume={headphoneVolume}
        isCueActive={isCueActive}
        masterVolume={masterVolume}
        onHeadphoneVolumeChange={onHeadphoneVolumeChange}
        onMasterVolumeChange={onMasterVolumeChange}
      />

      {/* Crossfader */}
      <MixerCrossfader
        crossfadePosition={crossfadePosition}
        onCrossfadeChange={onCrossfadeChange}
      />

      {/* CUE Controls */}
      {isCueActive ? (
        <MixerCue
          deckACueEnabled={deckACueEnabled}
          deckBCueEnabled={deckBCueEnabled}
          onDeckACueChange={onDeckACueChange}
          onDeckBCueChange={onDeckBCueChange}
        />
      ) : (
        <p className="text-center font-mono text-[10px] text-muted-foreground">
          Enable CUE output in audio settings
        </p>
      )}

      {/* Divider */}
      <div className="h-px bg-border/50" />

      {/* Audio Routing */}
      <div className="mt-auto">
        <MixerRouting />
      </div>

      {/* Error Status */}
      {!!error?.trim() && (
        <div className="rounded-md bg-destructive/10 p-2 text-center">
          <div className="font-medium text-destructive text-xs">Error</div>
          <div className="text-[10px] text-destructive">{error}</div>
        </div>
      )}
    </div>
  );
}
