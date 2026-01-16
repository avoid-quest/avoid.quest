import { Slider } from "@workspace/ui/components/slider";
import { cn } from "@workspace/ui/lib/utils";
import { RmsMeter } from "./rms-meter";

type ChannelStripProps = {
  volume: number;
  pan: number;
  speed: number;
  channelFilter: number;
  effectsDryWet: number;
  rmsLevel?: { left: number; right: number };
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

/**
 * Channel Strip Component
 *
 * DJ-style channel strip with:
 * - Volume fader (-∞ to +12dB)
 * - Pan knob (L-R)
 * - Filter knob (bipolar: left=LP, center=off, right=HP)
 * - Speed control (0.5x-2.0x via HTML5 playbackRate)
 * - FX Dry/Wet knob (master for effect chain)
 * - RMS meter (vertical bar)
 */
export function ChannelStrip({
  volume,
  pan,
  speed,
  channelFilter,
  effectsDryWet,
  rmsLevel,
  onVolumeChange,
  onPanChange,
  onSpeedChange,
  onChannelFilterChange,
  onEffectsDryWetChange,
  className,
}: ChannelStripProps) {
  return (
    <div className={cn("flex items-stretch gap-3", className)}>
      {/* RMS Meter */}
      <div className="flex flex-col items-center gap-1">
        <RmsMeter
          className="h-full w-4"
          leftLevel={rmsLevel?.left ?? 0}
          rightLevel={rmsLevel?.right ?? 0}
        />
        <span className="text-[9px] text-muted-foreground uppercase">RMS</span>
      </div>

      {/* Controls */}
      <div className="flex flex-1 flex-col gap-2">
        {/* Volume */}
        <ChannelControl
          formatValue={volumeToDb}
          label="Vol"
          max={1.585} // +4dB
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

        {/* Channel Filter (bipolar: LP ← OFF → HP) */}
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
          formatValue={(v) => `${Math.round(v * 100)}%`}
          label="FX"
          max={1}
          min={0}
          onChange={onEffectsDryWetChange}
          step={0.01}
          value={effectsDryWet}
        />
      </div>
    </div>
  );
}

type ChannelControlProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  formatValue: (value: number) => string;
};

function ChannelControl({
  label,
  value,
  min,
  max,
  step,
  onChange,
  formatValue,
}: ChannelControlProps) {
  return (
    <div className="flex items-center gap-2">
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
  rmsLevel,
  onVolumeChange,
  onPanChange,
  onEffectsDryWetChange,
  className,
}: Pick<
  ChannelStripProps,
  | "volume"
  | "pan"
  | "effectsDryWet"
  | "rmsLevel"
  | "onVolumeChange"
  | "onPanChange"
  | "onEffectsDryWetChange"
  | "className"
>) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <RmsMeter
        className="h-8 w-3"
        leftLevel={rmsLevel?.left ?? 0}
        rightLevel={rmsLevel?.right ?? 0}
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

        <div className="flex items-center gap-2">
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
