/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Knob } from "@avoid.quest/ui/components/knob";
import { Slider } from "@avoid.quest/ui/components/slider";
import { HeadphonesIcon } from "lucide-react";
import { MidiControlWrapper } from "@/components/audio/midi-control-wrapper";
import { useMasterPeakLevel } from "@/lib/hooks/use-master-peak-level";
import { formatPercent } from "../shared/format-utils";
import { PeakMeter } from "../shared/peak-meter";

type MixerMasterProps = {
  masterVolume: number;
  headphoneVolume: number;
  isCueActive: boolean;
  onMasterVolumeChange: (volume: number) => void;
  onHeadphoneVolumeChange: (volume: number) => void;
};

/**
 * The master strip between the two channels: cue volume where the channel
 * knobs sit, then the master fader with its meter, in the same rows.
 */
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

  return (
    <div className="row-span-4 grid grid-rows-subgrid justify-items-center">
      <div />
      <div className="flex items-start">
        {isCueActive ? (
          <MidiControlWrapper targetId="mixer:headphone-volume">
            <div className="flex flex-col items-center">
              <Knob
                defaultValue={1}
                format={formatPercent}
                label="cue"
                max={1}
                min={0}
                onChange={onHeadphoneVolumeChange}
                size={36}
                title={`Cue volume: ${formatPercent(headphoneVolume)}`}
                value={headphoneVolume}
              />
              <HeadphonesIcon className="size-3 text-muted-foreground" />
            </div>
          </MidiControlWrapper>
        ) : null}
      </div>
      <MidiControlWrapper targetId="mixer:master-volume">
        <div
          className="flex h-full min-h-0 items-stretch gap-2"
          style={{ touchAction: "none" }}
          title="Master volume. Double-click the handle for 100%."
        >
          <div className="flex h-full min-h-0 flex-col items-center gap-1">
            <span className="font-mono text-[10px] tabular-nums">
              {formatPercent(masterVolume)}
            </span>
            <Slider
              className="min-h-0 flex-1"
              defaultMarkerValue={100}
              defaultValue={[100]}
              max={100}
              min={0}
              onValueChange={handleMasterVolumeChange}
              orientation="vertical"
              step={1}
              value={[masterVolume * 100]}
              variant="fader"
            />
            <span className="font-mono text-[9px] text-muted-foreground uppercase tracking-wider">
              out
            </span>
          </div>
          <div className="flex w-4 py-5">
            <PeakMeter
              className="w-full"
              left={masterPeak.left}
              right={masterPeak.right}
            />
          </div>
        </div>
      </MidiControlWrapper>
      <div />
    </div>
  );
}
