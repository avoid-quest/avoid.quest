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
  type LucideIcon,
  RefreshCwIcon,
  Volume2Icon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { isSinkIdSupported, useAudioDevices } from "@/lib/audio";
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
  const sinkIdSupported = isSinkIdSupported();

  const {
    outputDevices,
    permissionState,
    isLoading,
    requestPermission,
    refreshDevices,
  } = useAudioDevices();

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

  const handleMainOutputChange = async (value: string) => {
    setMainOutputId(value);
    setMainOutputDevice(value);
    // If the new main device matches the current CUE device, auto-disable CUE
    if (cueOutputId && cueOutputId === value) {
      setCueOutputId(null);
      setCueOutputDevice(null);
      await applyCueOutputDevice(null);
    }
    // Apply to audio routing
    await applyMainOutputDevice(value);
  };

  const handleCueOutputChange = async (value: string) => {
    const newValue = value === "none" ? null : value;
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
    <div className="space-y-4">
      {/* Permission request */}
      {permissionState !== "granted" && (
        <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
          <p className="mb-2 text-xs">
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

      <div className="divide-y">
        <AudioSettingRow icon={Volume2Icon} title="Main output">
          {sinkIdSupported ? (
            <div className="flex min-w-0 gap-2">
              <Select
                onValueChange={handleMainOutputChange}
                value={mainOutputId}
              >
                <SelectTrigger className="min-w-0 flex-1">
                  <SelectValue placeholder="Select output device" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">System Default</SelectItem>
                  {outputDevices
                    .filter(
                      (device) =>
                        device.deviceId && device.deviceId !== "default"
                    )
                    .map((device) => (
                      <SelectItem key={device.deviceId} value={device.deviceId}>
                        {device.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {permissionState === "granted" && (
                <Button
                  aria-label="Refresh audio devices"
                  className="shrink-0"
                  disabled={isLoading}
                  onClick={refreshDevices}
                  size="icon"
                  title="Refresh audio devices"
                  variant="outline"
                >
                  <RefreshCwIcon
                    className={`size-3.5 ${isLoading ? "animate-spin" : ""}`}
                  />
                </Button>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              Output device selection not supported in this browser. Audio will
              play through system default.
            </p>
          )}
        </AudioSettingRow>

        <AudioSettingRow icon={ClockIcon} title="Main delay">
          <div className="flex min-w-0 items-center gap-3">
            <Slider
              className="min-w-24 flex-1"
              defaultValue={[0]}
              max={500}
              min={0}
              onValueChange={([v]) => handleMainDelayChange(v)}
              step={1}
              value={[mainDelayMs]}
            />
            <span className="w-10 text-right font-mono text-[10px] text-muted-foreground tabular-nums">
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
        </AudioSettingRow>

        <AudioSettingRow icon={HeadphonesIcon} title="CUE output">
          {sinkIdSupported ? (
            <Select
              onValueChange={handleCueOutputChange}
              value={cueOutputId ?? "none"}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select CUE output" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None (CUE Disabled)</SelectItem>
                {outputDevices
                  .filter(
                    (device) =>
                      device.deviceId && device.deviceId !== mainOutputId
                  )
                  .map((device) => (
                    <SelectItem key={device.deviceId} value={device.deviceId}>
                      {device.label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-muted-foreground text-sm">
              CUE output requires Chrome or Edge for output device selection.
            </p>
          )}
        </AudioSettingRow>

        {cueOutputId && (
          <AudioSettingRow icon={ClockIcon} title="CUE delay">
            <div className="flex min-w-0 items-center gap-3">
              <Slider
                className="min-w-24 flex-1"
                defaultValue={[0]}
                max={500}
                min={0}
                onValueChange={([v]) => handleCueDelayChange(v)}
                step={1}
                value={[cueDelayMs]}
              />
              <span className="w-10 text-right font-mono text-[10px] text-muted-foreground tabular-nums">
                {cueDelayMs}ms
              </span>
            </div>
          </AudioSettingRow>
        )}
      </div>

      {/* Browser compatibility note */}
      {!sinkIdSupported && (
        <div className="border-t pt-3">
          <p className="text-muted-foreground text-xs">
            <strong>Note:</strong> Output device selection requires Chrome or
            Edge. Firefox and Safari use the system default output.
          </p>
        </div>
      )}
    </div>
  );
}

function AudioSettingRow({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(18rem,28rem)] sm:items-center">
      <Label className="flex items-center gap-2 text-sm">
        <Icon className="size-3.5 text-muted-foreground" />
        {title}
      </Label>
      {children}
    </div>
  );
}
