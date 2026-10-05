import { cn } from "@avoid.quest/ui/lib/utils";
import { useDjError } from "@/lib/hooks/use-dj-state";
import { InlineError } from "../../inline-error";
import { MixerChannel } from "./mixer-channel";
import { MixerCrossfader } from "./mixer-crossfader";
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
        "flex h-full min-h-0 w-full flex-col gap-3 border-border/50 border-x p-3",
        className
      )}
    >
      <MixerCrossfader
        crossfadePosition={crossfadePosition}
        onCrossfadeChange={onCrossfadeChange}
      />

      {/* A | master | B, rows aligned: label, knobs, fader+meter, cue */}
      <div className="grid min-h-0 flex-1 grid-cols-[1fr_auto_1fr] grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-x-3 gap-y-2 border-border/50 border-t pt-3">
        <MixerChannel
          cueEnabled={deckACueEnabled}
          deckId="deck-a"
          isCueActive={isCueActive}
          onCueChange={onDeckACueChange}
        />
        <MixerMaster
          headphoneVolume={headphoneVolume}
          isCueActive={isCueActive}
          masterVolume={masterVolume}
          onHeadphoneVolumeChange={onHeadphoneVolumeChange}
          onMasterVolumeChange={onMasterVolumeChange}
        />
        <MixerChannel
          cueEnabled={deckBCueEnabled}
          deckId="deck-b"
          isCueActive={isCueActive}
          onCueChange={onDeckBCueChange}
        />
      </div>

      <div className="border-border/50 border-t pt-2">
        <MixerRouting />
      </div>

      {error?.trim() ? <InlineError>{error}</InlineError> : null}
    </div>
  );
}
