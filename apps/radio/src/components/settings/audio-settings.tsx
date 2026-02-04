"use client";

import { Button } from "@avoid.quest/ui/components/button";
import { Label } from "@avoid.quest/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@avoid.quest/ui/components/select";
import { Slider } from "@avoid.quest/ui/components/slider";
import {
  ClockIcon,
  HeadphonesIcon,
  RefreshCwIcon,
  Volume2Icon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  type AudioDeviceInfo,
  DeviceSource,
  isSinkIdSupported,
} from "@/lib/audio";
import {
  getAudioSettings,
  getDelaySettings,
  setCueOutputDevice,
  setMainOutputDevice,
} from "@/lib/collections";
import {
  applyCueOutputDevice,
  applyMainOutputDevice,
  autoCompensateLatency,
  setCueOutputDelay,
  setMainOutputDelay,
} from "@/lib/dj-actions";

/**
 * Audio settings panel for the main settings form.
 * Manages input/output device selection with persistence.
 */
export function AudioSettings() {
  const [outputDevices, setOutputDevices] = useState<AudioDeviceInfo[]>([]);
  const [permissionState, setPermissionState] = useState<
    "prompt" | "granted" | "denied" | "error"
  >("prompt");
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const sinkIdSupported = isSinkIdSupported();

  // Get current settings
  const audioSettings = getAudioSettings();
  const delaySettings = getDelaySettings();
  const [mainOutputId, setMainOutputId] = useState(
    audioSettings.mainOutputId ?? "default"
  );
  const [cueOutputId, setCueOutputId] = useState<string | null>(
    audioSettings.cueOutputId
  );
  const [mainDelayMs, setMainDelayMsState] = useState(
    delaySettings.mainDelayMs
  );
  const [cueDelayMs, setCueDelayMsState] = useState(delaySettings.cueDelayMs);

  const loadDevices = useCallback(async () => {
    try {
      const [inputs, outputs] = await Promise.all([
        DeviceSource.getInputDevices(),
        DeviceSource.getOutputDevices(),
      ]);
      setOutputDevices(outputs);

      // Check if we have real labels (not just fallback)
      const hasRealLabels = [...inputs, ...outputs].some(
        (d) =>
          d.label &&
          !d.label.startsWith("Input ") &&
          !d.label.startsWith("Output ")
      );
      if (hasRealLabels) {
        setPermissionState("granted");
      }
    } catch (error) {
      console.error("[AudioSettings] Failed to enumerate devices:", error);
    }
  }, []);

  const requestPermission = useCallback(async () => {
    setIsLoading(true);
    try {
      const state = await DeviceSource.requestPermission();
      setPermissionState(state);
      if (state === "granted") {
        await loadDevices();
      }
    } catch (error) {
      console.error("[AudioSettings] Permission request failed:", error);
      setPermissionState("error");
    } finally {
      setIsLoading(false);
    }
  }, [loadDevices]);

  const refreshDevices = useCallback(async () => {
    setIsRefreshing(true);
    await loadDevices();
    setIsRefreshing(false);
  }, [loadDevices]);

  // Load devices on mount
  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  // Listen for device changes
  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.mediaDevices) {
      const handler = () => loadDevices();
      navigator.mediaDevices.addEventListener("devicechange", handler);
      return () => {
        navigator.mediaDevices.removeEventListener("devicechange", handler);
      };
    }
  }, [loadDevices]);

  const handleMainOutputChange = async (value: string) => {
    setMainOutputId(value);
    setMainOutputDevice(value);
    // Apply to audio routing
    await applyMainOutputDevice(value);
  };

  const handleCueOutputChange = async (value: string) => {
    const newValue = value === "same" ? null : value;
    setCueOutputId(newValue);
    setCueOutputDevice(newValue);
    // Apply to audio routing
    await applyCueOutputDevice(newValue);
  };

  const handleMainDelayChange = (value: number) => {
    setMainDelayMsState(value);
    setMainOutputDelay(value);
  };

  const handleCueDelayChange = (value: number) => {
    setCueDelayMsState(value);
    setCueOutputDelay(value);
  };

  return (
    <div className="space-y-6">
      {/* Permission request */}
      {permissionState !== "granted" && (
        <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4">
          <p className="mb-3 text-sm">
            Grant microphone permission to see device names and select audio
            devices.
          </p>
          <Button
            disabled={isLoading}
            onClick={requestPermission}
            size="sm"
            variant="outline"
          >
            {isLoading ? "Requesting..." : "Grant Permission"}
          </Button>
        </div>
      )}

      {/* Refresh button */}
      {permissionState === "granted" && (
        <div className="flex justify-end">
          <Button
            disabled={isRefreshing}
            onClick={refreshDevices}
            size="sm"
            variant="ghost"
          >
            <RefreshCwIcon
              className={`mr-1.5 size-4 ${isRefreshing ? "animate-spin" : ""}`}
            />
            Refresh Devices
          </Button>
        </div>
      )}

      {/* Main Output Selection */}
      <div className="space-y-3 rounded-lg border p-4">
        <Label className="flex items-center gap-2 font-medium">
          <Volume2Icon className="size-4" />
          Main Output (PA/Speakers)
        </Label>
        {sinkIdSupported ? (
          <>
            <Select onValueChange={handleMainOutputChange} value={mainOutputId}>
              <SelectTrigger>
                <SelectValue placeholder="Select output device" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">System Default</SelectItem>
                {outputDevices
                  .filter((device) => device.deviceId)
                  .map((device) => (
                    <SelectItem key={device.deviceId} value={device.deviceId}>
                      {device.label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              Main program output for audience
            </p>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            Output device selection not supported in this browser. Audio will
            play through system default.
          </p>
        )}

        {/* Main Output Delay */}
        <div className="space-y-2 border-t pt-3">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-2 text-sm">
              <ClockIcon className="size-3" />
              Delay
            </Label>
            <div className="flex items-center gap-2">
              <span className="font-mono text-muted-foreground text-xs">
                {mainDelayMs}ms
              </span>
              <Button
                onClick={() => {
                  const detected = autoCompensateLatency();
                  if (detected !== null) {
                    setMainDelayMsState(detected);
                  }
                }}
                size="sm"
                title="Auto-detect system latency"
                variant="outline"
              >
                Auto
              </Button>
            </div>
          </div>
          <Slider
            className="h-2"
            defaultValue={[0]}
            max={500}
            min={0}
            onValueChange={([v]) => handleMainDelayChange(v)}
            step={1}
            value={[mainDelayMs]}
          />
        </div>
      </div>

      {/* CUE/Headphone Output Selection */}
      <div className="space-y-3 rounded-lg border p-4">
        <Label className="flex items-center gap-2 font-medium">
          <HeadphonesIcon className="size-4" />
          CUE/Headphones Output
        </Label>
        {sinkIdSupported ? (
          <>
            <Select
              onValueChange={handleCueOutputChange}
              value={cueOutputId ?? "same"}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select CUE output" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="same">Same as Main (Split Cue)</SelectItem>
                {outputDevices
                  .filter((device) => device.deviceId)
                  .map((device) => (
                    <SelectItem key={device.deviceId} value={device.deviceId}>
                      {device.label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              {cueOutputId
                ? "Separate output for DJ headphones"
                : "Split cue mode: L=CUE, R=MIX in single output"}
            </p>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            CUE output selection not supported. Using split cue mode (L=CUE,
            R=MIX).
          </p>
        )}

        {/* CUE Output Delay */}
        <div className="space-y-2 border-t pt-3">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-2 text-sm">
              <ClockIcon className="size-3" />
              Delay
            </Label>
            <span className="font-mono text-muted-foreground text-xs">
              {cueDelayMs}ms
            </span>
          </div>
          <Slider
            className="h-2"
            defaultValue={[0]}
            max={500}
            min={0}
            onValueChange={([v]) => handleCueDelayChange(v)}
            step={1}
            value={[cueDelayMs]}
          />
        </div>
      </div>

      {/* Browser compatibility note */}
      {!sinkIdSupported && (
        <div className="rounded-lg border border-muted bg-muted/50 p-3">
          <p className="text-muted-foreground text-xs">
            <strong>Note:</strong> Output device selection requires Chrome or
            Edge. Firefox and Safari use the system default output.
          </p>
        </div>
      )}
    </div>
  );
}
