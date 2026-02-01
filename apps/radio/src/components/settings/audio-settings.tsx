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
import {
  HeadphonesIcon,
  MicIcon,
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
  setCueOutputDevice,
  setInputDevice,
  setMainOutputDevice,
} from "@/lib/collections";

/**
 * Audio settings panel for the main settings form.
 * Manages input/output device selection with persistence.
 */
export function AudioSettings() {
  const [inputDevices, setInputDevices] = useState<AudioDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<AudioDeviceInfo[]>([]);
  const [permissionState, setPermissionState] = useState<
    "prompt" | "granted" | "denied" | "error"
  >("prompt");
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const sinkIdSupported = isSinkIdSupported();

  // Get current settings
  const audioSettings = getAudioSettings();
  const [mainOutputId, setMainOutputId] = useState(
    audioSettings.mainOutputId ?? "default"
  );
  const [cueOutputId, setCueOutputId] = useState<string | null>(
    audioSettings.cueOutputId
  );
  const [inputDeviceId, setInputDeviceId] = useState<string | null>(
    audioSettings.inputDeviceId
  );

  const loadDevices = useCallback(async () => {
    try {
      const [inputs, outputs] = await Promise.all([
        DeviceSource.getInputDevices(),
        DeviceSource.getOutputDevices(),
      ]);
      setInputDevices(inputs);
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

  const handleMainOutputChange = (value: string) => {
    setMainOutputId(value);
    setMainOutputDevice(value);
  };

  const handleCueOutputChange = (value: string) => {
    const newValue = value === "same" ? null : value;
    setCueOutputId(newValue);
    setCueOutputDevice(newValue);
  };

  const handleInputDeviceChange = (value: string) => {
    const newValue = value === "none" ? null : value;
    setInputDeviceId(newValue);
    setInputDevice(newValue);
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

      {/* Input Device Selection */}
      <div className="space-y-3 rounded-lg border p-4">
        <Label className="flex items-center gap-2 font-medium">
          <MicIcon className="size-4" />
          Audio Input
        </Label>
        <Select
          onValueChange={handleInputDeviceChange}
          value={inputDeviceId ?? "none"}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select input device" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None (Disabled)</SelectItem>
            {inputDevices
              .filter((device) => device.deviceId)
              .map((device) => (
                <SelectItem key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">
          External audio source (turntable, CDJ, audio interface)
        </p>
      </div>

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
