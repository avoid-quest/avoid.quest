// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
import { Slider } from "@avoid.quest/ui/components/slider";
import { HeadphonesIcon, Volume2Icon } from "lucide-react";
import { MidiControlWrapper } from "@/components/audio/midi-control-wrapper";
import { useMasterPeakLevel } from "@/lib/hooks/use-master-peak-level";
import { PeakMeter } from "../shared/peak-meter";

type MixerMasterProps = {
  masterVolume: number;
  headphoneVolume: number;
  isCueActive: boolean;
  onMasterVolumeChange: (volume: number) => void;
  onHeadphoneVolumeChange: (volume: number) => void;
};

export function MixerMaster({
  masterVolume,
  headphoneVolume,
  isCueActive,
  onMasterVolumeChange,
  onHeadphoneVolumeChange,
}: MixerMasterProps) {
  const masterPeak = useMasterPeakLevel();
  const handleMasterVolumeChange = ([value]: number[]) =>
    onMasterVolumeChange((value ?? 0) / 100);
  const handleHeadphoneVolumeChange = ([value]: number[]) =>
    onHeadphoneVolumeChange((value ?? 0) / 100);

  return (
    <div className="space-y-3">
      {/* Master VU meters */}
      <div className="space-y-1.5">
        <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
          Master
        </span>
        <PeakMeter
          left={masterPeak.left}
          orientation="horizontal"
          right={masterPeak.right}
        />
      </div>

      {/* Master Volume */}
      <MidiControlWrapper targetId="mixer:master-volume">
        <div className="flex items-center gap-2">
          <Volume2Icon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
            Vol
          </span>
          <Slider
            className="h-2 flex-1"
            defaultValue={[100]}
            max={100}
            min={0}
            onValueChange={handleMasterVolumeChange}
            step={1}
            value={[masterVolume * 100]}
          />
          <span className="w-9 shrink-0 text-right font-mono text-[10px] text-muted-foreground tabular-nums">
            {Math.round(masterVolume * 100)}%
          </span>
        </div>
      </MidiControlWrapper>

      {/* Headphone Volume */}
      {isCueActive ? (
        <MidiControlWrapper targetId="mixer:headphone-volume">
          <div className="flex items-center gap-2">
            <HeadphonesIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
              Cue
            </span>
            <Slider
              className="h-2 flex-1"
              defaultValue={[100]}
              max={100}
              min={0}
              onValueChange={handleHeadphoneVolumeChange}
              step={1}
              value={[headphoneVolume * 100]}
            />
            <span className="w-9 shrink-0 text-right font-mono text-[10px] text-muted-foreground tabular-nums">
              {Math.round(headphoneVolume * 100)}%
            </span>
          </div>
        </MidiControlWrapper>
      ) : null}
    </div>
  );
}
