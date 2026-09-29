// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
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
import { useEffect, useState } from "react";
import { useAudioDevices } from "@/lib/audio";

type DeviceFormProps = {
  onLoad: (deviceId: string, deviceLabel: string) => void;
  onCancel?: () => void;
};

export function DeviceForm({ onLoad, onCancel }: DeviceFormProps) {
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  const {
    inputDevices,
    permissionState,
    isLoading,
    requestPermission,
    refreshDevices,
  } = useAudioDevices();

  // Filter out devices with empty deviceId (browser placeholder entries)
  const validDevices = inputDevices.filter((d) => d.deviceId);

  // Auto-select first device when devices become available
  useEffect(() => {
    if (validDevices.length > 0) {
      setSelectedDeviceId((prev) => prev ?? validDevices[0]?.deviceId ?? null);
    }
  }, [validDevices]);

  const handleLoad = () => {
    if (selectedDeviceId) {
      const device = validDevices.find((d) => d.deviceId === selectedDeviceId);
      onLoad(selectedDeviceId, device?.label ?? "Audio Input");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <MicIcon className="size-5" />
          <h3 className="font-medium text-sm">
            {validDevices.length > 0 ? "Select Audio Input" : "Audio Input"}
          </h3>
        </div>

        {/* Permission banner */}
        {permissionState === "denied" && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3">
            <ShieldAlertIcon className="size-5 shrink-0 text-destructive" />
            <div className="flex-1">
              <p className="font-medium text-destructive text-sm">
                Microphone access denied
              </p>
              <p className="text-destructive/80 text-xs">
                Please enable microphone access in your browser settings
              </p>
            </div>
          </div>
        )}
        {permissionState !== "granted" && permissionState !== "denied" && (
          <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
            <p className="mb-3 text-sm">
              Grant microphone permission to see device names and select audio
              input devices.
            </p>
            <Button
              disabled={isLoading}
              onClick={requestPermission}
              size="sm"
              variant="outline"
            >
              {isLoading ? (
                <Loader2Icon className="mr-2 size-4 animate-spin" />
              ) : (
                <MicIcon className="mr-2 size-4" />
              )}
              {isLoading ? "Requesting..." : "Grant Permission"}
            </Button>
          </div>
        )}

        {/* Device selector (shown when devices are available) */}
        {validDevices.length > 0 && (
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
                  {validDevices.map((device) => (
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
        )}

        <div className="flex gap-2">
          {onCancel ? (
            <Button
              className="flex-1"
              disabled={isLoading}
              onClick={onCancel}
              variant="outline"
            >
              Cancel
            </Button>
          ) : null}
          {validDevices.length > 0 && (
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
          )}
        </div>
      </div>
    </div>
  );
}
