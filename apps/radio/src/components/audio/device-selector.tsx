"use client";

import { Button } from "@avoid.quest/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@avoid.quest/ui/components/dialog";
import { Label } from "@avoid.quest/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@avoid.quest/ui/components/select";
import { cn } from "@avoid.quest/ui/lib/utils";
import {
  HeadphonesIcon,
  MicIcon,
  SettingsIcon,
  Volume2Icon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  type AudioDeviceInfo,
  DeviceSource,
  isSinkIdSupported,
} from "@/lib/audio";

type DeviceSelectorProps = {
  className?: string;
  mainOutputId?: string;
  cueOutputId?: string | null;
  inputDeviceId?: string | null;
  onMainOutputChange?: (deviceId: string) => void;
  onCueOutputChange?: (deviceId: string | null) => void;
  onInputDeviceChange?: (deviceId: string | null) => void;
};

/**
 * Audio device selection dialog.
 * Allows selection of:
 * - Audio input device (for external sources)
 * - Main output device (speakers/PA)
 * - CUE/headphone output device
 */
export function DeviceSelector({
  className,
  mainOutputId = "default",
  cueOutputId = null,
  inputDeviceId = null,
  onMainOutputChange,
  onCueOutputChange,
  onInputDeviceChange,
}: DeviceSelectorProps) {
  const [open, setOpen] = useState(false);
  const [inputDevices, setInputDevices] = useState<AudioDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<AudioDeviceInfo[]>([]);
  const [permissionState, setPermissionState] = useState<
    "prompt" | "granted" | "denied" | "error"
  >("prompt");
  const [isLoading, setIsLoading] = useState(false);
  const sinkIdSupported = isSinkIdSupported();

  const loadDevices = useCallback(async () => {
    try {
      const [inputs, outputs] = await Promise.all([
        DeviceSource.getInputDevices(),
        DeviceSource.getOutputDevices(),
      ]);
      setInputDevices(inputs);
      setOutputDevices(outputs);

      // Check if we have real labels (not just fallback "Input/Output xxx")
      // Empty labels indicate permission not granted
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
      console.error("[DeviceSelector] Failed to enumerate devices:", error);
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
      console.error("[DeviceSelector] Permission request failed:", error);
      setPermissionState("error");
    } finally {
      setIsLoading(false);
    }
  }, [loadDevices]);

  // Load devices when dialog opens
  useEffect(() => {
    if (open) {
      loadDevices();
    }
  }, [open, loadDevices]);

  // Listen for device changes
  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.mediaDevices) {
      const handler = () => {
        if (open) {
          loadDevices();
        }
      };
      navigator.mediaDevices.addEventListener("devicechange", handler);
      return () => {
        navigator.mediaDevices.removeEventListener("devicechange", handler);
      };
    }
  }, [open, loadDevices]);

  const handleMainOutputChange = (value: string) => {
    onMainOutputChange?.(value);
  };

  const handleCueOutputChange = (value: string) => {
    onCueOutputChange?.(value === "same" ? null : value);
  };

  const handleInputDeviceChange = (value: string) => {
    onInputDeviceChange?.(value === "none" ? null : value);
  };

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button
          className={cn("h-8 gap-1.5 px-2", className)}
          size="sm"
          variant="ghost"
        >
          <SettingsIcon className="size-4" />
          <span className="hidden sm:inline">Audio</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Audio Device Settings</DialogTitle>
          <DialogDescription>
            Configure input and output devices for DJ mode.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Permission request if needed */}
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

          {/* Input Device Selection */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
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
              Select an external audio source (turntable, CDJ, etc.)
            </p>
          </div>

          {/* Main Output Selection */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Volume2Icon className="size-4" />
              Main Output (PA/Speakers)
            </Label>
            {sinkIdSupported ? (
              <>
                <Select
                  onValueChange={handleMainOutputChange}
                  value={mainOutputId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select output device" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">System Default</SelectItem>
                    {outputDevices
                      .filter((device) => device.deviceId)
                      .map((device) => (
                        <SelectItem
                          key={device.deviceId}
                          value={device.deviceId}
                        >
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
                Output device selection not supported in this browser. Audio
                will play through system default.
              </p>
            )}
          </div>

          {/* CUE/Headphone Output Selection */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
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
                    <SelectItem value="same">
                      Same as Main (Split Cue)
                    </SelectItem>
                    {outputDevices
                      .filter((device) => device.deviceId)
                      .map((device) => (
                        <SelectItem
                          key={device.deviceId}
                          value={device.deviceId}
                        >
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
