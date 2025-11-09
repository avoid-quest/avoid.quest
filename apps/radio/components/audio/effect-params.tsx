"use client";

import { Label } from "@workspace/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { Slider } from "@workspace/ui/components/slider";
import type {
  BiquadFilterConfig,
  CompressorConfig,
  DelayConfig,
  DistortionConfig,
  EffectConfig,
  PannerConfig,
  ReverbConfig,
} from "@/lib/audio/effects/types";
import { useCallback } from "react";

type EffectParamsProps = {
  effect: EffectConfig;
  isInitialized: boolean;
  onUpdate: (config: Partial<EffectConfig>) => void;
};

const FILTER_TYPES = [
  { value: "lowpass", label: "Low Pass" },
  { value: "highpass", label: "High Pass" },
  { value: "bandpass", label: "Band Pass" },
  { value: "lowshelf", label: "Low Shelf" },
  { value: "highshelf", label: "High Shelf" },
  { value: "peaking", label: "Peaking" },
  { value: "notch", label: "Notch" },
  { value: "allpass", label: "All Pass" },
] as const;

export function EffectParams({
  effect,
  isInitialized,
  onUpdate,
}: EffectParamsProps) {
  const renderParams = () => {
    switch (effect.type) {
      case "biquadFilter":
        return <BiquadFilterParams effect={effect} onUpdate={onUpdate} isInitialized={isInitialized} />;
      case "reverb":
        return <ReverbParams effect={effect} onUpdate={onUpdate} isInitialized={isInitialized} />;
      case "delay":
        return <DelayParams effect={effect} onUpdate={onUpdate} isInitialized={isInitialized} />;
      case "distortion":
        return <DistortionParams effect={effect} onUpdate={onUpdate} isInitialized={isInitialized} />;
      case "compressor":
        return <CompressorParams effect={effect} onUpdate={onUpdate} isInitialized={isInitialized} />;
      case "panner":
        return <PannerParams effect={effect} onUpdate={onUpdate} isInitialized={isInitialized} />;
      default:
        return null;
    }
  };

  return <div className="space-y-4">{renderParams()}</div>;
}

function BiquadFilterParams({
  effect,
  onUpdate,
  isInitialized,
}: {
  effect: BiquadFilterConfig;
  onUpdate: (config: Partial<EffectConfig>) => void;
  isInitialized: boolean;
}) {
  const formatFrequency = (freq: number) => {
    if (freq >= 1000) {
      return `${(freq / 1000).toFixed(1)}k Hz`;
    }
    return `${freq.toFixed(0)} Hz`;
  };

  const formatGain = (gain: number) =>
    `${gain > 0 ? "+" : ""}${gain.toFixed(1)} dB`;

  return (
    <>
      <div className="space-y-2">
        <Label className="text-xs">Filter Type</Label>
        <Select
          disabled={!isInitialized}
          onValueChange={(value) =>
            onUpdate({ filterType: value as BiquadFilterConfig["filterType"] })
          }
          value={effect.filterType}
        >
          <SelectTrigger className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILTER_TYPES.map((filter) => (
              <SelectItem key={filter.value} value={filter.value}>
                {filter.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Frequency</Label>
          <span className="font-mono text-xs">
            {formatFrequency(effect.frequency)}
          </span>
        </div>
        <Slider
          className="w-full"
          disabled={!(isInitialized && effect.enabled)}
          max={20000}
          min={20}
          onValueChange={([value]) => onUpdate({ frequency: value })}
          step={1}
          value={[effect.frequency]}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Q (Resonance)</Label>
          <span className="font-mono text-xs">{effect.Q.toFixed(2)}</span>
        </div>
        <Slider
          className="w-full"
          disabled={!(isInitialized && effect.enabled)}
          max={30}
          min={0.1}
          onValueChange={([value]) => onUpdate({ Q: value })}
          step={0.1}
          value={[effect.Q]}
        />
      </div>

      {(effect.filterType === "lowshelf" ||
        effect.filterType === "highshelf" ||
        effect.filterType === "peaking") && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Gain</Label>
            <span className="font-mono text-xs">
              {formatGain(effect.gain)}
            </span>
          </div>
          <Slider
            className="w-full"
            disabled={!(isInitialized && effect.enabled)}
            max={40}
            min={-40}
            onValueChange={([value]) => onUpdate({ gain: value })}
            step={0.1}
            value={[effect.gain]}
          />
        </div>
      )}
    </>
  );
}

function ReverbParams({
  effect,
  onUpdate,
  isInitialized,
}: {
  effect: ReverbConfig;
  onUpdate: (config: Partial<EffectConfig>) => void;
  isInitialized: boolean;
}) {
  const formatPercentage = (value: number) => `${Math.round(value * 100)}%`;

  return (
    <>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Room Size</Label>
          <span className="font-mono text-xs">
            {effect.roomSize.toFixed(3)}
          </span>
        </div>
        <Slider
          className="w-full"
          disabled={!(isInitialized && effect.enabled)}
          max={0.1}
          min={0.01}
          onValueChange={([value]) => onUpdate({ roomSize: value })}
          step={0.001}
          value={[effect.roomSize]}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Wet/Dry Mix</Label>
          <span className="font-mono text-xs">
            {formatPercentage(effect.wet)} / {formatPercentage(effect.dry)}
          </span>
        </div>
        <Slider
          className="w-full"
          disabled={!(isInitialized && effect.enabled)}
          max={1}
          min={0}
          onValueChange={([value]) =>
            onUpdate({ wet: value, dry: 1 - value })
          }
          step={0.01}
          value={[effect.wet]}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Decay Time</Label>
          <span className="font-mono text-xs">
            {effect.decayTime.toFixed(1)}s
          </span>
        </div>
        <Slider
          className="w-full"
          disabled={!(isInitialized && effect.enabled)}
          max={5}
          min={0.1}
          onValueChange={([value]) => onUpdate({ decayTime: value })}
          step={0.1}
          value={[effect.decayTime]}
        />
      </div>
    </>
  );
}

function DelayParams({
  effect,
  onUpdate,
  isInitialized,
}: {
  effect: DelayConfig;
  onUpdate: (config: Partial<EffectConfig>) => void;
  isInitialized: boolean;
}) {
  const formatPercentage = (value: number) => `${Math.round(value * 100)}%`;
  const formatTime = (seconds: number) => `${seconds.toFixed(2)}s`;

  return (
    <>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Delay Time</Label>
          <span className="font-mono text-xs">
            {formatTime(effect.delayTime)}
          </span>
        </div>
        <Slider
          className="w-full"
          disabled={!(isInitialized && effect.enabled)}
          max={1}
          min={0}
          onValueChange={([value]) => onUpdate({ delayTime: value })}
          step={0.01}
          value={[effect.delayTime]}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Feedback</Label>
          <span className="font-mono text-xs">
            {formatPercentage(effect.feedback)}
          </span>
        </div>
        <Slider
          className="w-full"
          disabled={!(isInitialized && effect.enabled)}
          max={0.95}
          min={0}
          onValueChange={([value]) => onUpdate({ feedback: value })}
          step={0.01}
          value={[effect.feedback]}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Wet/Dry Mix</Label>
          <span className="font-mono text-xs">
            {formatPercentage(effect.wet)} / {formatPercentage(effect.dry)}
          </span>
        </div>
        <Slider
          className="w-full"
          disabled={!(isInitialized && effect.enabled)}
          max={1}
          min={0}
          onValueChange={([value]) =>
            onUpdate({ wet: value, dry: 1 - value })
          }
          step={0.01}
          value={[effect.wet]}
        />
      </div>
    </>
  );
}

function DistortionParams({
  effect,
  onUpdate,
  isInitialized,
}: {
  effect: DistortionConfig;
  onUpdate: (config: Partial<EffectConfig>) => void;
  isInitialized: boolean;
}) {
  return (
    <>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Amount</Label>
          <span className="font-mono text-xs">{effect.amount}%</span>
        </div>
        <Slider
          className="w-full"
          disabled={!(isInitialized && effect.enabled)}
          max={100}
          min={0}
          onValueChange={([value]) => onUpdate({ amount: value })}
          step={1}
          value={[effect.amount]}
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Oversample</Label>
        <Select
          disabled={!isInitialized}
          onValueChange={(value) =>
            onUpdate({
              oversample: value as DistortionConfig["oversample"],
            })
          }
          value={effect.oversample}
        >
          <SelectTrigger className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            <SelectItem value="2x">2x</SelectItem>
            <SelectItem value="4x">4x</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </>
  );
}

function CompressorParams({
  effect,
  onUpdate,
  isInitialized,
}: {
  effect: CompressorConfig;
  onUpdate: (config: Partial<EffectConfig>) => void;
  isInitialized: boolean;
}) {
  const formatTime = (seconds: number) => `${(seconds * 1000).toFixed(1)}ms`;

  return (
    <>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Threshold</Label>
          <span className="font-mono text-xs">{effect.threshold.toFixed(1)} dB</span>
        </div>
        <Slider
          className="w-full"
          disabled={!(isInitialized && effect.enabled)}
          max={0}
          min={-100}
          onValueChange={([value]) => onUpdate({ threshold: value })}
          step={1}
          value={[effect.threshold]}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Ratio</Label>
          <span className="font-mono text-xs">{effect.ratio.toFixed(1)}:1</span>
        </div>
        <Slider
          className="w-full"
          disabled={!(isInitialized && effect.enabled)}
          max={20}
          min={1}
          onValueChange={([value]) => onUpdate({ ratio: value })}
          step={0.1}
          value={[effect.ratio]}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Attack</Label>
          <span className="font-mono text-xs">
            {formatTime(effect.attack)}
          </span>
        </div>
        <Slider
          className="w-full"
          disabled={!(isInitialized && effect.enabled)}
          max={1}
          min={0}
          onValueChange={([value]) => onUpdate({ attack: value })}
          step={0.001}
          value={[effect.attack]}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Release</Label>
          <span className="font-mono text-xs">
            {formatTime(effect.release)}
          </span>
        </div>
        <Slider
          className="w-full"
          disabled={!(isInitialized && effect.enabled)}
          max={1}
          min={0}
          onValueChange={([value]) => onUpdate({ release: value })}
          step={0.001}
          value={[effect.release]}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Knee</Label>
          <span className="font-mono text-xs">{effect.knee.toFixed(1)} dB</span>
        </div>
        <Slider
          className="w-full"
          disabled={!(isInitialized && effect.enabled)}
          max={40}
          min={0}
          onValueChange={([value]) => onUpdate({ knee: value })}
          step={1}
          value={[effect.knee]}
        />
      </div>
    </>
  );
}

function PannerParams({
  effect,
  onUpdate,
  isInitialized,
}: {
  effect: PannerConfig;
  onUpdate: (config: Partial<EffectConfig>) => void;
  isInitialized: boolean;
}) {
  const formatPan = (pan: number) => {
    if (pan === 0) return "Center";
    if (pan < 0) return `L ${Math.abs(pan).toFixed(2)}`;
    return `R ${pan.toFixed(2)}`;
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs">Pan</Label>
        <span className="font-mono text-xs">{formatPan(effect.pan)}</span>
      </div>
      <Slider
        className="w-full"
        disabled={!(isInitialized && effect.enabled)}
        max={1}
        min={-1}
        onValueChange={([value]) => onUpdate({ pan: value })}
        step={0.01}
        value={[effect.pan]}
      />
    </div>
  );
}
