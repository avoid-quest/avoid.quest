import { cn } from "@avoid.quest/ui/lib/utils";
import { useMemo } from "react";
import { useDeckAnalysis } from "@/lib/hooks/use-deck-analysis";
import { useDeckContext } from "./deck-context";
import { PeakMeter } from "../shared/peak-meter";

function deckTone(deckSide: "left" | "right") {
  return deckSide === "left"
    ? {
        accent: "#60a5fa",
        accentSoft: "rgba(96, 165, 250, 0.18)",
        border: "border-blue-500/15",
      }
    : {
        accent: "#f472b6",
        accentSoft: "rgba(244, 114, 182, 0.18)",
        border: "border-pink-500/15",
      };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function formatDbLike(level: number): string {
  if (level <= 0.0001) {
    return "−∞ dB";
  }
  const db = 20 * Math.log10(level);
  return `${db.toFixed(1)} dB`;
}

function WaveformStrip({
  waveform,
  accent,
}: {
  waveform: Float32Array | null;
  accent: string;
}) {
  const bars = useMemo(() => {
    if (!waveform || waveform.length === 0) {
      return [];
    }

    const targetBars = 40;
    const chunkSize = Math.max(1, Math.floor(waveform.length / targetBars));
    const next: number[] = [];

    for (let start = 0; start < waveform.length; start += chunkSize) {
      const end = Math.min(waveform.length, start + chunkSize);
      let peak = 0;
      for (let i = start; i < end; i++) {
        peak = Math.max(peak, Math.abs(waveform[i] ?? 0));
      }
      next.push(clamp01(peak));
    }

    return next.slice(0, targetBars);
  }, [waveform]);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
          Waveform
        </span>
        <span className="font-mono text-[10px] text-muted-foreground/60">
          live window
        </span>
      </div>
      <div className="relative h-12 overflow-hidden rounded-sm border border-white/5 bg-black/25 px-1.5">
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/6" />
        <div className="flex h-full items-center gap-px">
          {bars.length === 0
            ? Array.from({ length: 32 }, (_, i) => (
                <div
                  className="flex-1 rounded-full bg-white/6"
                  key={`empty-${i}`}
                  style={{ height: 4 }}
                />
              ))
            : bars.map((value, index) => {
                const height = Math.max(4, value * 100 * 0.55);
                return (
                  <div className="flex flex-1 justify-center" key={index}>
                    <div
                      className="w-full rounded-full"
                      style={{
                        height,
                        background: accent,
                        opacity: 0.35 + value * 0.65,
                        boxShadow: `0 0 10px ${accent}22`,
                      }}
                    />
                  </div>
                );
              })}
        </div>
      </div>
    </div>
  );
}

function SpectrumStrip({
  spectrum,
  accent,
}: {
  spectrum: Float32Array | null;
  accent: string;
}) {
  const bars = useMemo(() => {
    if (!spectrum || spectrum.length === 0) {
      return [];
    }

    const count = 20;
    const nyquistBins = spectrum.length;
    const minFreq = 30;
    const maxFreq = 16000;
    const sampleRate = 44100;
    const next: number[] = [];

    for (let i = 0; i < count; i++) {
      const t0 = i / count;
      const t1 = (i + 1) / count;
      const f0 = minFreq * (maxFreq / minFreq) ** t0;
      const f1 = minFreq * (maxFreq / minFreq) ** t1;
      const b0 = Math.max(0, Math.floor((f0 / (sampleRate / 2)) * nyquistBins));
      const b1 = Math.max(b0 + 1, Math.floor((f1 / (sampleRate / 2)) * nyquistBins));

      let peak = -100;
      for (let bin = b0; bin < Math.min(b1, nyquistBins); bin++) {
        peak = Math.max(peak, spectrum[bin] ?? -100);
      }

      const normalized = clamp01((peak + 96) / 72);
      next.push(normalized);
    }

    return next;
  }, [spectrum]);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
          Spectrum
        </span>
        <span className="font-mono text-[10px] text-muted-foreground/60">
          low → high
        </span>
      </div>
      <div className="flex h-10 items-end gap-1 overflow-hidden rounded-sm border border-white/5 bg-black/20 px-1.5 py-1.5">
        {bars.length === 0
          ? Array.from({ length: 20 }, (_, i) => (
              <div
                className="flex-1 rounded-sm bg-white/6"
                key={`empty-spec-${i}`}
                style={{ height: 3 }}
              />
            ))
          : bars.map((value, index) => {
              const height = Math.max(3, value * 100);
              return (
                <div
                  className="flex-1 rounded-sm"
                  key={index}
                  style={{
                    height: `${height}%`,
                    background: `linear-gradient(to top, ${accent}cc, ${accent})`,
                    opacity: 0.22 + value * 0.78,
                  }}
                />
              );
            })}
      </div>
    </div>
  );
}

export function DeckVisualizer({ className }: { className?: string }) {
  const { soundId, isPlaying, deckSide, peakLevel } = useDeckContext();
  const analysis = useDeckAnalysis(soundId, Boolean(soundId));
  const tone = deckTone(deckSide);
  const signalPeak = analysis.levels.peak || Math.max(peakLevel.left, peakLevel.right);

  return (
    <div
      className={cn(
        "space-y-2 rounded-md border bg-black/20 px-2 py-2",
        tone.border,
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="h-2 w-2 rounded-full"
            style={{
              background: tone.accent,
              opacity: isPlaying ? 1 : 0.45,
              boxShadow: isPlaying ? `0 0 12px ${tone.accent}` : "none",
            }}
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Signal
          </span>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground/70">
          {formatDbLike(signalPeak)}
        </span>
      </div>

      <WaveformStrip accent={tone.accent} waveform={analysis.waveform} />
      <SpectrumStrip accent={tone.accent} spectrum={analysis.spectrum} />

      <div
        className="grid grid-cols-[1fr_auto] items-center gap-2 rounded-sm border border-white/5 px-2 py-1.5"
        style={{ background: tone.accentSoft }}
      >
        <PeakMeter
          compact
          left={analysis.levels.left || peakLevel.left}
          orientation="horizontal"
          right={analysis.levels.right || peakLevel.right}
        />
        <span className="min-w-14 text-right font-mono text-[10px] tabular-nums text-muted-foreground/85">
          {isPlaying ? "live" : "idle"}
        </span>
      </div>
    </div>
  );
}
