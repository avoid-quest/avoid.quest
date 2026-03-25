import { cn } from "@avoid.quest/ui/lib/utils";
import {
  SpectrumDisplay,
  WaveformDisplay,
} from "@/components/audio/visualizations";
import { useDeckContext } from "./deck-context";
import { PeakMeter } from "../shared/peak-meter";
import { useDeckAnalysis } from "@/lib/hooks/use-deck-analysis";

function deckTone(deckSide: "left" | "right") {
  return deckSide === "left"
    ? {
        waveform: "rgba(59, 130, 246, 0.95)",
        border: "border-blue-500/20",
        glow: "shadow-[inset_0_1px_0_rgba(59,130,246,0.15)]",
        spectrum: "blue" as const,
      }
    : {
        waveform: "rgba(236, 72, 153, 0.95)",
        border: "border-pink-500/20",
        glow: "shadow-[inset_0_1px_0_rgba(236,72,153,0.15)]",
        spectrum: "purple" as const,
      };
}

export function DeckVisualizer({ className }: { className?: string }) {
  const { soundId, isPlaying, deckSide, peakLevel } = useDeckContext();
  const analysis = useDeckAnalysis(soundId, Boolean(soundId));
  const tone = deckTone(deckSide);
  const hasSignal = Boolean(
    analysis.waveform?.length || analysis.spectrum?.length || soundId
  );

  return (
    <div
      className={cn(
        "space-y-2 rounded-md border bg-black/30 p-2",
        tone.border,
        tone.glow,
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {deckSide === "left" ? "Deck A Viz" : "Deck B Viz"}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
          {isPlaying ? "live" : hasSignal ? "armed" : "idle"}
        </span>
      </div>

      <div className="space-y-2">
        <WaveformDisplay
          className="h-20 w-full rounded-sm bg-black/20"
          color={tone.waveform}
          fillOpacity={0.22}
          waveform={analysis.waveform}
        />

        <SpectrumDisplay
          barCount={40}
          className="h-16 w-full rounded-sm bg-black/20"
          colorScheme={tone.spectrum}
          spectrum={analysis.spectrum}
        />

        <div className="grid grid-cols-[1fr_auto] items-center gap-2">
          <div className="space-y-1">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
              Levels
            </div>
            <PeakMeter
              compact
              left={analysis.levels.left || peakLevel.left}
              orientation="horizontal"
              right={analysis.levels.right || peakLevel.right}
            />
          </div>
          <div className="min-w-14 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
            {(analysis.levels.peak || Math.max(peakLevel.left, peakLevel.right))
              .toFixed(2)
              .replace(/^0/, "")}
          </div>
        </div>
      </div>
    </div>
  );
}
