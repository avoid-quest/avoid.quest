import { Button } from "@avoid.quest/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@avoid.quest/ui/components/select";
import {
  Loader2Icon,
  MicIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { DevicePermissionState } from "@/lib/audio";
import { getInputDevices, requestInputPermission } from "@/lib/dj-actions";

type DeviceFormProps = {
  onLoad: (deviceId: string, deviceLabel: string) => void;
  onCancel?: () => void;
};

type DeviceOption = {
  deviceId: string;
  label: string;
};

export function DeviceForm({ onLoad, onCancel }: DeviceFormProps) {
  const [devices, setDevices] = useState<DeviceOption[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [permissionState, setPermissionState] =
    useState<DevicePermissionState>("prompt");
  const [error, setError] = useState<string | null>(null);

  const refreshDevices = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const inputDevices = await getInputDevices();
      setDevices(inputDevices);
      // Auto-select first device if none selected
      if (inputDevices.length > 0 && !selectedDeviceId) {
        setSelectedDeviceId(inputDevices[0]?.deviceId ?? null);
      }
    } catch (err) {
      console.error("[DeviceForm] Failed to get devices:", err);
      setError("Failed to enumerate audio devices");
    } finally {
      setIsLoading(false);
    }
  }, [selectedDeviceId]);

  const handleRequestPermission = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const state = await requestInputPermission();
      setPermissionState(state);
      if (state === "granted") {
        await refreshDevices();
      } else if (state === "denied") {
        setError("Microphone permission denied");
      }
    } catch (err) {
      console.error("[DeviceForm] Permission request failed:", err);
      setError("Failed to request microphone permission");
    } finally {
      setIsLoading(false);
    }
  };

  // Initial permission check and device enumeration
  useEffect(() => {
    const checkPermission = async () => {
      try {
        // Check if we already have permission by trying to enumerate devices
        const inputDevices = await getInputDevices();
        if (inputDevices.length > 0 && inputDevices[0]?.label) {
          // Labels are populated = permission granted
          setPermissionState("granted");
          setDevices(inputDevices);
          if (!selectedDeviceId) {
            setSelectedDeviceId(inputDevices[0]?.deviceId ?? null);
          }
        } else {
          // No devices or no labels = need permission
          setPermissionState("prompt");
        }
      } catch {
        setPermissionState("prompt");
      }
    };
    checkPermission();
  }, [selectedDeviceId]);

  const handleLoad = () => {
    if (selectedDeviceId) {
      const device = devices.find((d) => d.deviceId === selectedDeviceId);
      onLoad(selectedDeviceId, device?.label ?? "Audio Input");
    }
  };

  // Permission denied state
  if (permissionState === "denied") {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto p-4">
        <div className="w-full max-w-md space-y-4">
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <MicIcon className="size-5" />
            <h3 className="font-medium text-sm">Audio Input</h3>
          </div>

          <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3">
            <ShieldAlertIcon className="size-5 text-destructive" />
            <div className="flex-1">
              <p className="font-medium text-destructive text-sm">
                Microphone access denied
              </p>
              <p className="text-destructive/80 text-xs">
                Please enable microphone access in your browser settings
              </p>
            </div>
          </div>

          {onCancel && (
            <Button className="w-full" onClick={onCancel} variant="outline">
              Cancel
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Permission prompt state
  if (permissionState === "prompt" || devices.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto p-4">
        <div className="w-full max-w-md space-y-4">
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <MicIcon className="size-5" />
            <h3 className="font-medium text-sm">Audio Input</h3>
          </div>

          <p className="text-center text-muted-foreground text-sm">
            Allow microphone access to use audio input devices
          </p>

          {error && (
            <div className="rounded-md bg-destructive/10 p-3">
              <p className="text-destructive text-sm">{error}</p>
            </div>
          )}

          <div className="flex gap-2">
            {onCancel && (
              <Button
                className="flex-1"
                disabled={isLoading}
                onClick={onCancel}
                variant="outline"
              >
                Cancel
              </Button>
            )}
            <Button
              className="flex-1"
              disabled={isLoading}
              onClick={handleRequestPermission}
            >
              {isLoading ? (
                <Loader2Icon className="mr-2 size-4 animate-spin" />
              ) : (
                <MicIcon className="mr-2 size-4" />
              )}
              Enable Microphone
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Device selection state
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <MicIcon className="size-5" />
          <h3 className="font-medium text-sm">Select Audio Input</h3>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Select
              disabled={isLoading}
              onValueChange={setSelectedDeviceId}
              value={selectedDeviceId ?? undefined}
            >
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Select input device" />
              </SelectTrigger>
              <SelectContent>
                {devices.map((device) => (
                  <SelectItem key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              aria-label="Refresh devices"
              className="size-10 p-0"
              disabled={isLoading}
              onClick={refreshDevices}
              size="sm"
              variant="ghost"
            >
              <RefreshCwIcon
                className={`size-4 ${isLoading ? "animate-spin" : ""}`}
              />
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            Select a microphone or audio interface input
          </p>
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 p-3">
            <p className="text-destructive text-sm">{error}</p>
          </div>
        )}

        <div className="flex gap-2">
          {onCancel && (
            <Button
              className="flex-1"
              disabled={isLoading}
              onClick={onCancel}
              variant="outline"
            >
              Eject
            </Button>
          )}
          <Button
            className="flex-1"
            disabled={isLoading || !selectedDeviceId}
            onClick={handleLoad}
          >
            {isLoading ? (
              <Loader2Icon className="mr-2 size-4 animate-spin" />
            ) : null}
            Load
          </Button>
        </div>
      </div>
    </div>
  );
}
