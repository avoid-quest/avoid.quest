"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Label } from "@workspace/ui/components/label";
import { Slider } from "@workspace/ui/components/slider";
import { Toggle } from "@workspace/ui/components/toggle";
import { cn } from "@workspace/ui/lib/utils";
import { useCallback, useEffect, useState } from "react";

export type ReverbConfig = {
  enabled: boolean;
  roomSize: number;
  wet: number;
  dry: number;
  decayTime: number;
};

type ReverbControlProps = {
  className?: string;
  title: string;
  soundId: string | null;
  onReverbChange?: (config: ReverbConfig) => void;
  initialConfig?: Partial<ReverbConfig>;
};

export function ReverbControl({
  className,
  title,
  soundId,
  onReverbChange,
  initialConfig = {},
}: ReverbControlProps) {
  const [config, setConfig] = useState<ReverbConfig>({
    enabled: false,
    roomSize: 0.05,
    wet: 0.3,
    dry: 0.7,
    decayTime: 2.0,
    ...initialConfig,
  });

  const [isInitialized, setIsInitialized] = useState(false);

  // Initialize reverb when soundId changes
  useEffect(() => {
    if (!soundId) {
      setIsInitialized(false);
      return;
    }

    // This will be handled by the parent component that manages the audio
    setIsInitialized(true);
  }, [soundId]);

  const updateConfig = useCallback((newConfig: Partial<ReverbConfig>) => {
    setConfig((prev) => {
      const updated = { ...prev, ...newConfig };
      return updated;
    });
  }, []);

  // Notify parent of config changes (only when initialized)
  useEffect(() => {
    if (isInitialized) {
      onReverbChange?.(config);
    }
  }, [config, onReverbChange, isInitialized]);

  const handleRoomSizeChange = useCallback(
    (value: number[]) => {
      updateConfig({ roomSize: value[0] });
    },
    [updateConfig]
  );

  const handleWetChange = useCallback(
    (value: number[]) => {
      const wet = value[0] ?? 0;
      updateConfig({ wet, dry: 1 - wet });
    },
    [updateConfig]
  );

  const handleDecayTimeChange = useCallback(
    (value: number[]) => {
      updateConfig({ decayTime: value[0] });
    },
    [updateConfig]
  );

  const handleEnabledChange = useCallback(
    (enabled: boolean) => {
      updateConfig({ enabled });
    },
    [updateConfig]
  );

  const formatPercentage = (value: number) => `${Math.round(value * 100)}%`;

  const formatRoomSize = (value: number) => value.toFixed(3);

  const formatTime = (seconds: number) => `${seconds.toFixed(1)}s`;

  return (
    <Card className={cn("w-full", className)}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">{title}</CardTitle>
          <Toggle
            disabled={!isInitialized}
            onPressedChange={handleEnabledChange}
            pressed={config.enabled}
            size="sm"
          >
            {config.enabled ? "ON" : "OFF"}
          </Toggle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Room Size Control */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Room Size</Label>
            <span className="font-mono text-xs">
              {formatRoomSize(config.roomSize)}
            </span>
          </div>
          <Slider
            className="w-full"
            disabled={!(isInitialized && config.enabled)}
            max={0.1}
            min={0.01}
            onValueChange={handleRoomSizeChange}
            step={0.001}
            value={[config.roomSize]}
          />
        </div>

        {/* Wet/Dry Mix Control */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Wet/Dry Mix</Label>
            <span className="font-mono text-xs">
              {formatPercentage(config.wet)} / {formatPercentage(config.dry)}
            </span>
          </div>
          <Slider
            className="w-full"
            disabled={!(isInitialized && config.enabled)}
            max={1}
            min={0}
            onValueChange={handleWetChange}
            step={0.01}
            value={[config.wet]}
          />
        </div>

        {/* Decay Time Control */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Decay Time</Label>
            <span className="font-mono text-xs">
              {formatTime(config.decayTime)}
            </span>
          </div>
          <Slider
            className="w-full"
            disabled={!(isInitialized && config.enabled)}
            max={5}
            min={0.1}
            onValueChange={handleDecayTimeChange}
            step={0.1}
            value={[config.decayTime]}
          />
        </div>

        {/* Status Indicator */}
        {!isInitialized && (
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
