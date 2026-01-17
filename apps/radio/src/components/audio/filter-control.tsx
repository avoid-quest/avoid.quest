import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Label } from "@workspace/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { Slider } from "@workspace/ui/components/slider";
import { Toggle } from "@workspace/ui/components/toggle";
import { cn } from "@workspace/ui/lib/utils";
// BiquadFilterNode is a Web Audio API type, not exported by cacophony
import { useCallback, useEffect, useRef, useState } from "react";
import type { FilterConfig, FilterType } from "@/lib/audio";

const MAX_FREQUENCY = 1000;

type FilterControlProps = {
  className?: string;
  title: string;
  soundId: string | null;
  onFilterChange?: (config: FilterConfig) => void;
  initialConfig?: Partial<FilterConfig>;
};

const FILTER_TYPES: {
  value: FilterType;
  label: string;
}[] = [
  { value: "lowpass", label: "Low Pass" },
  { value: "highpass", label: "High Pass" },
  { value: "bandpass", label: "Band Pass" },
  { value: "lowshelf", label: "Low Shelf" },
  { value: "highshelf", label: "High Shelf" },
  { value: "peaking", label: "Peaking" },
  { value: "notch", label: "Notch" },
  { value: "allpass", label: "All Pass" },
];

const FREQUENCY_RANGES = {
  lowpass: { min: 20, max: 20_000, default: 1000 },
  highpass: { min: 20, max: 20_000, default: 1000 },
  bandpass: { min: 20, max: 20_000, default: 1000 },
  lowshelf: { min: 20, max: 2000, default: 500 },
  highshelf: { min: 2000, max: 20_000, default: 5000 },
  peaking: { min: 20, max: 20_000, default: 1000 },
  notch: { min: 20, max: 20_000, default: 1000 },
  allpass: { min: 20, max: 20_000, default: 1000 },
};

const Q_RANGES = {
  lowpass: { min: 0.1, max: 30, default: 1 },
  highpass: { min: 0.1, max: 30, default: 1 },
  bandpass: { min: 0.1, max: 30, default: 1 },
  lowshelf: { min: 0.1, max: 10, default: 1 },
  highshelf: { min: 0.1, max: 10, default: 1 },
  peaking: { min: 0.1, max: 30, default: 1 },
  notch: { min: 0.1, max: 30, default: 1 },
  allpass: { min: 0.1, max: 30, default: 1 },
};

const GAIN_RANGES = {
  lowpass: { min: -40, max: 40, default: 0 },
  highpass: { min: -40, max: 40, default: 0 },
  bandpass: { min: -40, max: 40, default: 0 },
  lowshelf: { min: -40, max: 40, default: 0 },
  highshelf: { min: -40, max: 40, default: 0 },
  peaking: { min: -40, max: 40, default: 0 },
  notch: { min: -40, max: 40, default: 0 },
  allpass: { min: -40, max: 40, default: 0 },
};

export function FilterControl({
  className,
  title,
  soundId,
  onFilterChange,
  initialConfig = {},
}: FilterControlProps) {
  const [config, setConfig] = useState<FilterConfig>({
    type: "lowpass",
    frequency: 1000,
    Q: 1,
    gain: 0,
    enabled: false,
    ...initialConfig,
  });

  const filterRef = useRef<BiquadFilterNode | null>(null);

  // Initialize filter when soundId changes
  useEffect(() => {
    if (!soundId) {
      filterRef.current = null;
      return;
    }

    // This will be handled by the parent component that manages the audio
  }, [soundId]);

  const updateConfig = useCallback((newConfig: Partial<FilterConfig>) => {
    setConfig((prev) => {
      const updated = { ...prev, ...newConfig };
      return updated;
    });
  }, []);

  // Notify parent of config changes
  useEffect(() => {
    onFilterChange?.(config);
  }, [config, onFilterChange]);

  const handleTypeChange = useCallback(
    (type: FilterType) => {
      const freqRange = FREQUENCY_RANGES[type];
      const qRange = Q_RANGES[type];
      const gainRange = GAIN_RANGES[type];

      updateConfig({
        type,
        frequency: freqRange.default,
        Q: qRange.default,
        gain: gainRange.default,
      });
    },
    [updateConfig]
  );

  const handleFrequencyChange = useCallback(
    (value: number[]) => {
      updateConfig({ frequency: value[0] });
    },
    [updateConfig]
  );

  const handleQChange = useCallback(
    (value: number[]) => {
      updateConfig({ Q: value[0] });
    },
    [updateConfig]
  );

  const handleGainChange = useCallback(
    (value: number[]) => {
      updateConfig({ gain: value[0] });
    },
    [updateConfig]
  );

  const handleEnabledChange = useCallback(
    (enabled: boolean) => {
      updateConfig({ enabled });
    },
    [updateConfig]
  );

  const currentFreqRange = FREQUENCY_RANGES[config.type];
  const currentQRange = Q_RANGES[config.type];
  const currentGainRange = GAIN_RANGES[config.type];

  const formatFrequency = (freq: number) => {
    if (freq >= MAX_FREQUENCY) {
      return `${(freq / MAX_FREQUENCY).toFixed(1)}k Hz`;
    }
    return `${freq.toFixed(0)} Hz`;
  };

  const formatGain = (gain: number) =>
    `${gain > 0 ? "+" : ""}${gain.toFixed(1)} dB`;

  return (
    <Card className={cn("w-full", className)}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">{title}</CardTitle>
          <Toggle
            disabled={soundId === null}
            onPressedChange={handleEnabledChange}
            pressed={config.enabled}
            size="sm"
          >
            {config.enabled ? "ON" : "OFF"}
          </Toggle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filter Type Selection */}
        <div className="space-y-2">
          <Label className="text-xs">Filter Type</Label>
          <Select
            disabled={soundId === null}
            onValueChange={handleTypeChange}
            value={config.type}
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

        {/* Frequency Control */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Frequency</Label>
            <span className="font-mono text-xs">
              {formatFrequency(config.frequency)}
            </span>
          </div>
          <Slider
            className="w-full"
            disabled={soundId === null || !config.enabled}
            max={currentFreqRange.max}
            min={currentFreqRange.min}
            onValueChange={handleFrequencyChange}
            step={1}
            value={[config.frequency]}
          />
        </div>

        {/* Q Control */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Q (Resonance)</Label>
            <span className="font-mono text-xs">{config.Q.toFixed(2)}</span>
          </div>
          <Slider
            className="w-full"
            disabled={soundId === null || !config.enabled}
            max={currentQRange.max}
            min={currentQRange.min}
            onValueChange={handleQChange}
            step={0.1}
            value={[config.Q]}
          />
        </div>

        {/* Gain Control (for shelf and peaking filters) */}
        {(config.type === "lowshelf" ||
          config.type === "highshelf" ||
          config.type === "peaking") && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Gain</Label>
              <span className="font-mono text-xs">
                {formatGain(config.gain)}
              </span>
            </div>
            <Slider
              className="w-full"
              disabled={soundId === null || !config.enabled}
              max={currentGainRange.max}
              min={currentGainRange.min}
              onValueChange={handleGainChange}
              step={0.1}
              value={[config.gain]}
            />
          </div>
        )}

        {/* Status Indicator */}
        {soundId === null && (
          <div className="rounded-md bg-muted/50 p-2 text-center">
            <span className="text-muted-foreground text-xs">
              No audio source loaded
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
