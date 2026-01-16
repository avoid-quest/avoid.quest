import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@workspace/ui/components/accordion";
import { Slider } from "@workspace/ui/components/slider";
import { cn } from "@workspace/ui/lib/utils";
import { PeakMeter } from "./peak-meter";

type ChannelStripProps = {
  volume: number;
  pan: number;
  speed: number;
  channelFilter: number;
  effectsDryWet: number;
  peakLevel?: { left: number; right: number };
  onVolumeChange: (value: number) => void;
  onPanChange: (value: number) => void;
  onSpeedChange: (value: number) => void;
  onChannelFilterChange: (value: number) => void;
  onEffectsDryWetChange: (value: number) => void;
  className?: string;
};

/**
 * Convert linear volume (0-1.585) to dB display (-∞ to +12dB)
 * 1.0 = 0dB, ~3.98 = +12dB (10^(12/20))
 */
function volumeToDb(volume: number): string {
  if (volume <= 0.001) {
    return "-∞";
  }
  const db = 20 * Math.log10(volume);
  return db >= 0 ? `+${db.toFixed(1)}` : db.toFixed(1);
}

/**
 * Format pan value as L/C/R
 */
function formatPan(pan: number): string {
  if (Math.abs(pan) < 0.05) {
    return "C";
  }
  const percent = Math.abs(Math.round(pan * 100));
  return pan < 0 ? `L${percent}` : `R${percent}`;
}

/**
 * Format speed as multiplier
 */
function formatSpeed(speed: number): string {
  return `${speed.toFixed(2)}x`;
}

/**
 * Format channel filter position
 * Negative = lowpass, 0 = off, positive = highpass
 */
function formatChannelFilter(value: number): string {
  if (Math.abs(value) < 0.05) {
    return "OFF";
  }
  return value < 0
    ? `LP ${Math.round(Math.abs(value) * 100)}%`
    : `HP ${Math.round(value * 100)}%`;
}

type ChannelControlProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  formatValue: (value: number) => string;
  /** Tooltip description shown on hover */
  description?: string;
};

function ChannelControl({
  label,
  value,
  min,
  max,
  step,
  onChange,
  formatValue,
  description,
}: ChannelControlProps) {
  return (
    <div className="flex items-center gap-2" title={description}>
      <span className="w-10 shrink-0 text-right text-[10px] text-muted-foreground uppercase tracking-wider">
        {label}
      </span>
      <Slider
        className="flex-1"
        max={max}
        min={min}
        onValueChange={([v]) => onChange(v)}
        step={step}
        value={[value]}
      />
      <span className="w-12 shrink-0 font-mono text-[10px] text-muted-foreground">
        {formatValue(value)}
      </span>
    </div>
  );
}

/**
 * Compact channel strip for mobile/narrow layouts
 */
export function CompactChannelStrip({
  volume,
  pan,
  effectsDryWet,
  peakLevel,
  onVolumeChange,
  onPanChange,
  onEffectsDryWetChange,
  className,
}: Pick<
  ChannelStripProps,
  | "volume"
  | "pan"
  | "effectsDryWet"
  | "peakLevel"
  | "onVolumeChange"
  | "onPanChange"
  | "onEffectsDryWetChange"
  | "className"
>) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <PeakMeter
        className="h-8 w-3"
        leftLevel={peakLevel?.left ?? 0}
        rightLevel={peakLevel?.right ?? 0}
      />

      <div className="flex flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="w-8 text-[9px] text-muted-foreground uppercase">
            Vol
          </span>
          <Slider
            className="flex-1"
            max={1.585}
            min={0}
            onValueChange={([v]) => onVolumeChange(v)}
            step={0.01}
            value={[volume]}
          />
          <span className="w-10 font-mono text-[9px] text-muted-foreground">
            {volumeToDb(volume)}dB
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="w-8 text-[9px] text-muted-foreground uppercase">
            Pan
          </span>
          <Slider
            className="flex-1"
            max={1}
            min={-1}
            onValueChange={([v]) => onPanChange(v)}
            step={0.01}
            value={[pan]}
          />
          <span className="w-10 font-mono text-[9px] text-muted-foreground">
            {formatPan(pan)}
          </span>
        </div>

        <div
          className="flex items-center gap-2"
          title="Deck FX Send: Master dry/wet for entire effects chain"
        >
          <span className="w-8 text-[9px] text-muted-foreground uppercase">
            FX
          </span>
          <Slider
            className="flex-1"
            max={1}
            min={0}
            onValueChange={([v]) => onEffectsDryWetChange(v)}
            step={0.01}
            value={[effectsDryWet]}
          />
          <span className="w-10 font-mono text-[9px] text-muted-foreground">
            {Math.round(effectsDryWet * 100)}%
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Collapsible channel strip that can be expanded/collapsed
 * Shows peak meter and volume in collapsed state
 */
export function CollapsibleChannelStrip({
  volume,
  pan,
  speed,
  channelFilter,
  effectsDryWet,
  peakLevel,
  onVolumeChange,
  onPanChange,
  onSpeedChange,
  onChannelFilterChange,
  onEffectsDryWetChange,
  className,
  defaultExpanded = true,
}: ChannelStripProps & { defaultExpanded?: boolean }) {
  return (
    <Accordion
      className={cn("w-full", className)}
      collapsible
      defaultValue={defaultExpanded ? "channel-strip" : undefined}
      type="single"
    >
      <AccordionItem className="border-none" value="channel-strip">
        <AccordionTrigger className="py-2 hover:no-underline">
          <div className="flex items-center gap-3">
            <PeakMeter
              className="h-6 w-3"
              leftLevel={peakLevel?.left ?? 0}
              rightLevel={peakLevel?.right ?? 0}
            />
            <span className="font-medium text-xs">Channel Strip</span>
            <span className="text-[10px] text-muted-foreground">
              {volumeToDb(volume)}dB
            </span>
          </div>
        </AccordionTrigger>
        <AccordionContent className="pb-0">
          <div className="flex flex-col gap-2 pt-2">
            {/* Volume */}
            <ChannelControl
              formatValue={volumeToDb}
              label="Vol"
              max={1.585}
              min={0}
              onChange={onVolumeChange}
              step={0.01}
              value={volume}
            />

            {/* Pan */}
            <ChannelControl
              formatValue={formatPan}
              label="Pan"
              max={1}
              min={-1}
              onChange={onPanChange}
              step={0.01}
              value={pan}
            />

            {/* Channel Filter */}
            <ChannelControl
              formatValue={formatChannelFilter}
              label="Filter"
              max={1}
              min={-1}
              onChange={onChannelFilterChange}
              step={0.01}
              value={channelFilter}
            />

            {/* Speed */}
            <ChannelControl
              formatValue={formatSpeed}
              label="Speed"
              max={2.0}
              min={0.5}
              onChange={onSpeedChange}
              step={0.01}
              value={speed}
            />

            {/* FX Dry/Wet */}
            <ChannelControl
              description="Deck FX Send: Master dry/wet for entire effects chain. 0% = bypass all effects."
              formatValue={(v) => `${Math.round(v * 100)}%`}
              label="FX"
              max={1}
              min={0}
              onChange={onEffectsDryWetChange}
              step={0.01}
              value={effectsDryWet}
            />
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
