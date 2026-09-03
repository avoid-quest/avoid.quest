// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
import { Slider } from "@avoid.quest/ui/components/slider";
import { MidiControlWrapper } from "@/components/audio/midi-control-wrapper";

type MixerCrossfaderProps = {
  crossfadePosition: number;
  onCrossfadeChange: (position: number) => void;
};

export function MixerCrossfader({
  crossfadePosition,
  onCrossfadeChange,
}: MixerCrossfaderProps) {
  const handleValueChange = ([value]: number[]) =>
    onCrossfadeChange((value ?? 0) / 100);

  return (
    <MidiControlWrapper targetId="mixer:crossfader">
      <div className="flex items-center gap-2.5">
        <span className="shrink-0 font-bold font-mono text-xs">A</span>
        <div className="relative flex-1" style={{ touchAction: "none" }}>
          <Slider
            className="h-3"
            defaultValue={[50]}
            max={100}
            min={0}
            onValueChange={handleValueChange}
            step={1}
            value={[crossfadePosition * 100]}
          />
          {/* Center detent indicator */}
          <div className="pointer-events-none absolute top-1/2 left-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/40" />
        </div>
        <span className="shrink-0 font-bold font-mono text-xs">B</span>
      </div>
    </MidiControlWrapper>
  );
}
